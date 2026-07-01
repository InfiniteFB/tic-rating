#!/usr/bin/env python3
"""Live data pipeline for the KMV rating engine (fills the data gaps).

Reuses the data-access primitives from ``test_massive_api.py`` and adds the
inputs the rating engine needs that the smoke test did not fetch:

  1. A ~1-year daily price window (the smoke test used ~183 calendar days /
     ~125 trading days; the course volatility estimate wants ~250 trading days).
  2. The 1-year Treasury risk-free rate time series (FRED DGS1).
  3. The SOFR overnight rate time series (New York Fed).

Interest-rate strategy
----------------------
Two key-less rate feeds fill the rate gap in the input checklist:

* **1-year Treasury (the model's risk-free rate)** -- FRED series DGS1, free and
  key-less. Massive's Polygon-style ``/fed/v1/treasury-yields`` was probed with a
  working key and returns HTTP 500 on this plan, so it is NOT used.
* **SOFR (optional short rate)** -- overnight, not the model's 1-year input;
  pulled from the New York Fed markets API
  (``markets.newyorkfed.org/api/rates/secured/sofr/search.json``), free / no key.

Both are fetched defensively and fall back to a configurable flat rate when a
feed is unavailable, so the pipeline never hard-fails on a single input. Per the
TiC paper (eq 16) the TiC rating is invariant to r anyway.

Requires ``MASSIVE_API_KEY`` only for the per-ticker market data; both rate
feeds work without a key::

    export MASSIVE_API_KEY=...
    python3 rating_pipeline.py --days 400 --tickers KO WMT
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, timedelta
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

import test_massive_api as massive

# --- 1-year Treasury yield (FRED series DGS1, free / no key) ----------------
# This is the risk-free rate the KMV/TiC model wants (1-year horizon).
# Massive's Polygon-style /fed/v1/treasury-yields was probed with a working key
# and returns HTTP 500 on this plan, so we do NOT use it; FRED DGS1 is the
# authoritative, free, key-less source. Per the TiC paper (eq 16) the TiC rating
# is invariant to r anyway; r only enters DD/EDF via the 2nd-order strike
# discount, so exact sourcing is not critical.
FRED_DGS1_URL = (
    "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS1&cosd={start}&coed={end}"
)

# --- SOFR (New York Fed markets API, free / no key) ------------------------
# Overnight rate; not the model's 1-year input, kept as an optional short rate.
SOFR_URL = "https://markets.newyorkfed.org/api/rates/secured/sofr/search.json"
SOFR_USER_AGENT = "pfpa-rating-pipeline/1.0"

# ~400 calendar days ~= 250+ trading days.
DEFAULT_DAYS = 400
FALLBACK_RATE = 0.045


def fetch_treasury_yields(
    start_date: str, end_date: str, timeout: float = 30.0
) -> tuple[list[dict[str, str | float]], str]:
    """Fetch the daily 1-year Treasury yield (FRED DGS1) as a decimal series.

    Returns (series, note).  ``series`` is [{"date", "rate"}] ascending with rate
    in decimal (e.g. 0.04).  FRED reports percent and blanks non-trading days as
    "."; blanks are skipped and callers forward-fill via :func:`rate_as_of`.
    No API key required.
    """
    url = FRED_DGS1_URL.format(start=start_date, end=end_date)
    try:
        with urlopen(url, timeout=timeout) as response:
            lines = response.read().decode("utf-8").splitlines()
    except (HTTPError, URLError, TimeoutError) as exc:
        reason = getattr(exc, "reason", exc)
        return [], f"FRED DGS1 error: {' '.join(str(reason).split())[:200]}"

    series: list[dict[str, str | float]] = []
    for line in lines[1:]:  # skip header "observation_date,DGS1"
        parts = line.split(",")
        if len(parts) != 2:
            continue
        d, raw = parts[0].strip(), parts[1].strip()
        if not d or raw in ("", "."):  # FRED blanks non-trading days as "."
            continue
        try:
            rate = float(raw)
        except ValueError:
            continue
        if rate > 1.0:  # percent (4.0) -> decimal (0.04)
            rate /= 100.0
        series.append({"date": d[:10], "rate": rate})
    series.sort(key=lambda r: r["date"])
    if not series:
        return [], "FRED DGS1 returned no usable rows"
    return series, f"FRED DGS1 ok ({len(series)} rows)"


def fetch_sofr(
    start_date: str, end_date: str, timeout: float = 30.0
) -> tuple[list[dict[str, str | float]], str]:
    """Fetch the daily SOFR series from the New York Fed markets API.

    Returns (series, note) with the same shape as ``fetch_treasury_yields``:
    ``series`` is a list of {"date", "rate"} with rate in decimal (e.g. 0.0362).
    No API key is required. Any failure returns an empty series and a note so
    the caller falls back to a flat rate instead of hard-failing.
    """
    query = urlencode({"startDate": start_date, "endDate": end_date})
    request = Request(
        f"{SOFR_URL}?{query}",
        headers={"Accept": "application/json", "User-Agent": SOFR_USER_AGENT},
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        return [], f"sofr feed HTTP {exc.code}"
    except (URLError, TimeoutError) as exc:
        reason = exc.reason if isinstance(exc, URLError) else exc
        return [], f"sofr feed error: {' '.join(str(reason).split())[:200]}"
    except json.JSONDecodeError as exc:
        return [], f"sofr feed invalid JSON: {exc}"

    series: list[dict[str, str | float]] = []
    for row in payload.get("refRates", []) if isinstance(payload, dict) else []:
        if not isinstance(row, dict) or str(row.get("type", "")).upper() != "SOFR":
            continue
        d = row.get("effectiveDate")
        pct = row.get("percentRate")
        if d is None or pct is None:
            continue
        rate = float(pct)
        if rate > 1.0:  # percent form (3.62) -> decimal (0.0362)
            rate /= 100.0
        series.append({"date": str(d)[:10], "rate": rate})
    series.sort(key=lambda r: r["date"])
    if not series:
        return [], "sofr feed returned no usable rows"
    return series, f"sofr feed ok ({len(series)} rows)"


def rate_as_of(series: list[dict[str, str | float]], on: str, fallback: float) -> float:
    """Latest yield with date <= ``on``; fallback when the series is empty."""
    chosen = fallback
    for row in series:
        if str(row["date"]) <= on:
            chosen = float(row["rate"])
        else:
            break
    return chosen


def fetch_all(
    tickers: list[str],
    *,
    days: int = DEFAULT_DAYS,
    fallback_rate: float = FALLBACK_RATE,
    output_dir: Path | None = None,
    timeout: float = 30.0,
    min_interval: float = 12.5,
) -> dict[str, dict[str, Any]]:
    api_key = os.environ.get("MASSIVE_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("MASSIVE_API_KEY is not set")

    end = date.today()
    start = end - timedelta(days=days)
    client = massive.MassiveClient(api_key, timeout=timeout, min_interval=min_interval)

    # One rate pull of each kind covers every ticker (both are key-less feeds).
    treasury, treasury_note = fetch_treasury_yields(start.isoformat(), end.isoformat(), timeout=timeout)
    sofr, sofr_note = fetch_sofr(start.isoformat(), end.isoformat(), timeout=timeout)
    print(f"treasury: {treasury_note}", file=sys.stderr)
    print(f"sofr: {sofr_note}", file=sys.stderr)

    samples: dict[str, dict[str, Any]] = {}
    for ticker in tickers:
        _summary, raw = massive.fetch_ticker(ticker, client, start.isoformat(), end.isoformat())
        # Attach both per-day rates onto the derived price rows.
        prices = raw.get("derived", {}).get("daily_dividend_adjusted_prices", [])
        for row in prices:
            on = str(row.get("date", ""))
            row["risk_free_rate_1y"] = rate_as_of(treasury, on, fallback_rate)
            row["sofr"] = rate_as_of(sofr, on, fallback_rate)
        raw["derived"]["risk_free_rate_1y_series"] = treasury
        raw["derived"]["sofr_series"] = sofr
        raw["notes"]["risk_free_rate"] = (
            f"{treasury_note}; flat fallback={fallback_rate} used where series missing"
        )
        raw["notes"]["sofr"] = (
            f"{sofr_note}; flat fallback={fallback_rate} used where series missing"
        )
        raw["requested_date_range"]["days"] = days
        samples[ticker] = raw
        print(
            f"{ticker}: {len(prices)} price rows, "
            f"1y-treasury {'ok' if treasury else f'flat {fallback_rate}'}, "
            f"sofr {'ok' if sofr else f'flat {fallback_rate}'}",
            file=sys.stderr,
        )

    if output_dir is not None:
        output_dir.mkdir(parents=True, exist_ok=True)
        raw_dir = output_dir / "massive_api_raw_samples"
        raw_dir.mkdir(parents=True, exist_ok=True)
        for ticker, sample in samples.items():
            with (raw_dir / f"{ticker}.json").open("w", encoding="utf-8") as handle:
                json.dump(sample, handle, indent=2, ensure_ascii=False)
                handle.write("\n")
    return samples


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tickers", nargs="*", default=massive.TICKERS)
    parser.add_argument("--days", type=int, default=DEFAULT_DAYS)
    parser.add_argument("--fallback-rate", type=float, default=FALLBACK_RATE)
    parser.add_argument("--output-dir", type=Path, default=Path.cwd())
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--min-interval", type=float, default=12.5)
    args = parser.parse_args(argv)
    fetch_all(
        args.tickers,
        days=args.days,
        fallback_rate=args.fallback_rate,
        output_dir=args.output_dir,
        timeout=args.timeout,
        min_interval=args.min_interval,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
