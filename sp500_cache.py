#!/usr/bin/env python3
"""Fetch and cache the whole S&P 500 for the KMV / TiC rating front end.

Two stages, independently re-runnable:

  fetch   — pull the 4 Massive endpoints per constituent, attach the shared
            FRED DGS1 / SOFR series, and write one raw capture per ticker to
            ``<out>/raw/{TICKER}.json``. Resumable: existing captures are
            skipped unless ``--force``. This is the only stage that touches
            the network.

  derive  — re-run the KMV engine over the cached captures, offline, at two
            cutoff dates so every name carries the same two-snapshot shape the
            course workbook uses. Writes the deployable payload:

              <out>/data/index.json          one row per constituent
              <out>/data/series/{TICKER}.json  EM history + per-day paths
              <out>/data/summary.json        counts, including why names failed

The raw captures are ~190 KB each (~95 MB for the index) and are a
regenerable intermediate — they stay out of git. ``data/`` is the part worth
deploying: ~0.4 MB for the index, ~13 KB per series file.

Usage::

    python3 sp500_cache.py fetch                 # ~10 min, 8 workers
    python3 sp500_cache.py derive
    python3 sp500_cache.py fetch --tickers KO WMT --force
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import re
import sys
import threading
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import rating_pipeline as rp
import test_massive_api as massive
import ttc_conversion
from kmv_engine import _attach_rating, rate_company
from rating_inputs import build_inputs

WIKI_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
DEFAULT_OUT = Path("sp500_cache")
DEFAULT_DAYS = 400          # calendar days of price history to request
DEFAULT_WINDOW = 150        # trading days the engine calibrates on (matches the workbook)
DEFAULT_PRIOR = "2026-01-02"  # the workbook's earlier snapshot date
DEFAULT_WORKERS = 8
FALLBACK_RATE = 0.045

# Measured on a paid key: 8 concurrent calls return in ~2 s with no 429s and no
# rate-limit headers. Kept configurable so a throttled key can drop to 1 worker.


# ─────────────────────────────── constituents ────────────────────────────────

def fetch_constituents(timeout: float = 30.0) -> list[dict[str, str]]:
    """Scrape the current S&P 500 list (symbol, name, GICS sector) off Wikipedia."""
    request = urllib.request.Request(WIKI_URL, headers={"User-Agent": "pfpa-sp500/1.0"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        html = response.read().decode("utf-8")

    try:
        table = html.split('id="constituents"', 1)[1].split("</table>", 1)[0]
    except IndexError:
        raise SystemExit("could not find the constituents table — Wikipedia markup changed")

    def text(cell: str) -> str:
        return (
            re.sub(r"<[^>]+>", "", cell)
            .replace("&amp;", "&")
            .replace("&#39;", "'")
            .strip()
        )

    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", table, re.S):
        cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
        if len(cells) < 4:
            continue
        symbol, name, sector = text(cells[0]), text(cells[1]), text(cells[2])
        if not re.fullmatch(r"[A-Z][A-Z.\-]{0,6}", symbol) or symbol in seen:
            continue
        seen.add(symbol)
        out.append({"ticker": symbol, "name": name, "sector": sector})
    if len(out) < 400:
        raise SystemExit(f"only parsed {len(out)} constituents — refusing to run on a partial list")
    return out


# ───────────────────────────────── fetch stage ───────────────────────────────

def _rate_limited(raw: dict[str, Any]) -> bool:
    """The documented free-tier symptom: prices swallowed while metadata arrived."""
    prices = raw.get("derived", {}).get("daily_dividend_adjusted_prices", [])
    if prices:
        return False
    responses = raw.get("responses", {})
    has_meta = bool(_rows(responses.get("balance_sheet")) or responses.get("ticker_overview"))
    return has_meta


def _rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, dict):
        results = payload.get("results")
        if isinstance(results, list):
            return [r for r in results if isinstance(r, dict)]
        if isinstance(results, dict):
            return [results]
    return []


def _retry(label: str, attempt_fn, *, ok, attempts: int = 4, delay: float = 1.5):
    """Retry ``attempt_fn`` until ``ok(result)``. Transient TLS resets are the
    dominant failure mode under concurrency (SSL UNEXPECTED_EOF), and they clear
    on the next try — so a plain backoff beats any smarter handling here."""
    result = None
    for i in range(attempts):
        try:
            result = attempt_fn()
            if ok(result):
                return result, i
        except Exception:
            if i == attempts - 1:
                raise
        time.sleep(delay * (i + 1))
    return result, attempts - 1


def fetch_stage(
    constituents: list[dict[str, str]],
    out_dir: Path,
    *,
    days: int = DEFAULT_DAYS,
    workers: int = DEFAULT_WORKERS,
    timeout: float = 30.0,
    min_interval: float = 0.0,
    force: bool = False,
    retries: int = 3,
) -> dict[str, str]:
    api_key = os.environ.get("MASSIVE_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("MASSIVE_API_KEY is not set")

    raw_dir = out_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    end = date.today()
    start = end - timedelta(days=days)
    iso_start, iso_end = start.isoformat(), end.isoformat()

    # Both rate feeds are key-less and shared by every ticker — pull once, but
    # insist on a real series: silently falling back to a flat rate would apply
    # to all 503 names at once.
    (treasury, treasury_note), _ = _retry(
        "FRED DGS1",
        lambda: rp.fetch_treasury_yields(iso_start, iso_end, timeout=timeout),
        ok=lambda r: bool(r[0]),
    )
    (sofr, sofr_note), _ = _retry(
        "SOFR",
        lambda: rp.fetch_sofr(iso_start, iso_end, timeout=timeout),
        ok=lambda r: bool(r[0]),
    )
    print(f"treasury: {treasury_note}", file=sys.stderr)
    print(f"sofr:     {sofr_note}", file=sys.stderr)
    if not treasury:
        raise SystemExit(
            "refusing to run: FRED DGS1 unavailable, every ticker would silently "
            f"fall back to a flat {FALLBACK_RATE} risk-free rate"
        )

    todo = [c for c in constituents if force or not (raw_dir / f"{c['ticker']}.json").exists()]
    skipped = len(constituents) - len(todo)
    print(
        f"fetch: {len(todo)} to pull, {skipped} already cached, {workers} workers",
        file=sys.stderr,
    )

    local = threading.local()
    lock = threading.Lock()
    done = {"n": 0}
    status: dict[str, str] = {}

    def client() -> massive.MassiveClient:
        if not hasattr(local, "client"):
            local.client = massive.MassiveClient(api_key, timeout=timeout, min_interval=min_interval)
        return local.client

    def one(entry: dict[str, str]) -> tuple[str, str]:
        ticker = entry["ticker"]

        def attempt() -> dict[str, Any]:
            _summary, raw = massive.fetch_ticker(ticker, client(), iso_start, iso_end)
            return raw

        # A clean capture has no per-endpoint errors and non-empty prices.
        # fetch_ticker isolates endpoint failures into raw["errors"] rather than
        # raising, so inspect that instead of relying on exceptions.
        def clean(raw: dict[str, Any]) -> bool:
            return not raw.get("errors") and not _rate_limited(raw)

        try:
            raw, used = _retry(ticker, attempt, ok=clean, attempts=retries + 1, delay=2.0)
        except Exception as exc:  # a single ticker must never kill the batch
            return ticker, f"fetch failed: {' '.join(str(exc).split())[:160]}"
        if raw is None:
            return ticker, "fetch failed: no response"

        prices = raw.get("derived", {}).get("daily_dividend_adjusted_prices", [])
        for row in prices:
            on = str(row.get("date", ""))
            row["risk_free_rate_1y"] = rp.rate_as_of(treasury, on, FALLBACK_RATE)
            row["sofr"] = rp.rate_as_of(sofr, on, FALLBACK_RATE)
        raw.setdefault("derived", {})["risk_free_rate_1y_series"] = treasury
        raw["derived"]["sofr_series"] = sofr
        raw.setdefault("notes", {})["risk_free_rate"] = (
            f"{treasury_note}; flat fallback={FALLBACK_RATE} where the series is missing"
        )
        raw["notes"]["sofr"] = f"{sofr_note}; flat fallback={FALLBACK_RATE} where the series is missing"
        raw.setdefault("requested_date_range", {})["days"] = days
        raw["constituent"] = entry

        # atomic write, so an interrupted run never leaves a half-written capture
        tmp = raw_dir / f".{ticker}.json.tmp"
        with tmp.open("w", encoding="utf-8") as handle:
            json.dump(raw, handle, ensure_ascii=False)
        tmp.replace(raw_dir / f"{ticker}.json")

        note = f"{len(prices)} price rows, {len(_rows(raw['responses'].get('balance_sheet')))} quarters"
        if used:
            note += f", {used} retr{'y' if used == 1 else 'ies'}"
        if raw.get("errors"):
            note += f", UNRESOLVED endpoint errors: {sorted(raw['errors'])}"
        return ticker, note

    t0 = time.monotonic()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(one, c): c["ticker"] for c in todo}
        for future in as_completed(futures):
            ticker = futures[future]
            try:
                ticker, note = future.result()
            except Exception as exc:
                note = f"worker crashed: {exc}"
            with lock:
                done["n"] += 1
                status[ticker] = note
                print(f"[{done['n']:3d}/{len(todo)}] {ticker:6} {note}", file=sys.stderr, flush=True)

    elapsed = time.monotonic() - t0
    print(
        f"fetch done: {len(todo)} tickers in {elapsed/60:.1f} min "
        f"({elapsed/max(len(todo),1):.1f} s/ticker)",
        file=sys.stderr,
    )
    return status


# ──────────────────────────────── derive stage ───────────────────────────────

def _sig(value: Any, digits: int = 7) -> Any:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    try:
        return float(f"%.{digits}g" % value)
    except (ValueError, OverflowError):
        return None


def _truncated(sample: dict[str, Any], cutoff: str) -> dict[str, Any]:
    """A shallow view of the capture with prices ending on or before ``cutoff``."""
    derived = dict(sample.get("derived", {}))
    derived["daily_dividend_adjusted_prices"] = [
        row
        for row in derived.get("daily_dividend_adjusted_prices", [])
        if str(row.get("date", "")) <= cutoff
    ]
    return {**sample, "derived": derived}


def _ohlc(sample: dict[str, Any]) -> dict[str, Any] | None:
    """Daily bars for the candlestick view, straight off the cached aggregates.

    These are the raw split-adjusted bars (``adjusted=true``); the model itself
    calibrates on dividend-adjusted closes, so this close can sit a little away
    from the ``equity`` path in the same payload. The UI says so rather than
    quietly reconciling the two.
    """
    rows = _rows(sample.get("responses", {}).get("prices"))
    if len(rows) < 2:
        return None
    dates, o, h, l, c, v = [], [], [], [], [], []
    for row in rows:
        stamp = row.get("t")
        if stamp is None or row.get("c") is None:
            continue
        dates.append(datetime.fromtimestamp(stamp / 1000, tz=timezone.utc).date().isoformat())
        o.append(_sig(row.get("o"), 6))
        h.append(_sig(row.get("h"), 6))
        l.append(_sig(row.get("l"), 6))
        c.append(_sig(row.get("c"), 6))
        v.append(round((row.get("v") or 0) / 1e3))     # thousands of shares
    if len(dates) < 2:
        return None
    return {"dates": dates, "o": o, "h": h, "l": l, "c": c, "v": v}


def _metrics_at(result: Any, days: list[Any], idx: int) -> Any:
    """Re-evaluate the rating metrics at day ``idx`` using the SAME calibration.

    The workbook carries one AssetVol / AssetRet / StockVol per company, not one
    per snapshot: the professor calibrates once and then evaluates both dates
    against that single fit, so only A, D and E move between snapshots.
    Re-calibrating on the earlier window instead makes R_A drift, and since
    mu = ln(A/D)/|R_A| and CCM = σ²/(ln(A/D)·|R_A|), both explode — KO's mu came
    out at 211 years against the workbook's 6.6 before this was fixed.
    """
    snap = copy.copy(result)          # shares sigma_a / r_a, gets its own metrics
    snap.assets = result.assets[: idx + 1]   # _attach_rating reads assets[-1]
    _attach_rating(snap, days[idx])
    return snap


def _snapshot(snap: Any, day: Any, shares: float | None) -> dict[str, Any]:
    """The workbook's snapshot fields for one evaluated day.

    Field names mirror the workbook, so the front end needs no translation layer.
    The TTC half of the chain lives in ttc_conversion, not on EMResult — the two
    are composed here exactly as app/pipeline.py composes them for the live API.
    """
    result = snap
    sp = ttc_conversion.convert_fh_to_sp(result.ccm, result.mu, result.pd_fh)
    last = day
    return {
        "date": last.date,
        "asset": _sig(result.asset_latest / 1e3, 6),      # thousands of USD, as in the workbook
        "marketCap": _sig(result.equity_latest / 1e3, 6),
        "price": _sig(last.equity / shares, 6) if shares else None,
        "mu": _sig(result.mu),
        "ccm": _sig(result.ccm),
        "rs": _sig(result.risk_score),                    # RS = 100 · TiC
        "fpPd": _sig(result.pd_fh),
        "alpha": _sig(sp["alpha"]),
        "spCcm": _sig(sp["ccm_star"]),
        "spPd": _sig(sp["sp_ttc_pd"]),
        "spRating": sp["sp_letter_fine"],
        "dd": _sig(result.dd),
        "edf": _sig(result.pit_pd),                       # EDF = Phi(-DD)
        "outlook": sp["outlook"],                         # "+" / "-", professor's convention
        # carried for the conversion chain the UI draws, not in the workbook grid
        "rsSp": _sig(sp["rs_sp"]),
        "tic": _sig(result.tic),
        "creditOutlook": _sig(sp["credit_outlook"]),
    }


def derive_stage(
    out_dir: Path,
    *,
    window: int = DEFAULT_WINDOW,
    prior: str = DEFAULT_PRIOR,
    current: str | None = None,
    data_out: Path | None = None,
) -> dict[str, Any]:
    raw_dir = out_dir / "raw"
    # the deployable payload can be written straight into the web root
    data_dir = data_out or (out_dir / "data")
    series_dir = data_dir / "series"
    series_dir.mkdir(parents=True, exist_ok=True)

    cutoff_now = current or date.today().isoformat()
    files = sorted(raw_dir.glob("*.json"))
    if not files:
        raise SystemExit(f"no captures in {raw_dir} — run the fetch stage first")

    index: list[dict[str, Any]] = []
    reasons: dict[str, int] = {}
    rated = 0

    for path in files:
        sample = json.loads(path.read_text(encoding="utf-8"))
        ticker = sample.get("ticker", path.stem)
        entry = sample.get("constituent", {})
        row: dict[str, Any] = {
            "ticker": ticker,
            "name": entry.get("name") or ticker,
            "sector": entry.get("sector"),
            "asof": cutoff_now,
            "window": window,
        }

        def fail(reason: str) -> None:
            row["unrateable_reason"] = reason
            reasons[reason] = reasons.get(reason, 0) + 1
            index.append(row)

        # One calibration per company, on the window ending at the current
        # cutoff — the workbook's structure. Both snapshots reuse it.
        bundle = build_inputs(_truncated(sample, cutoff_now), window=window)
        if bundle.unrateable_reason:
            fail(bundle.unrateable_reason)
            continue
        try:
            engine = rate_company(bundle.days)
        except Exception as exc:
            fail(f"compute failed: {type(exc).__name__}: {exc}")
            continue

        days = bundle.days
        shares = bundle.shares or None
        # the prior snapshot is the last day at or before the prior cutoff
        prior_idx = next((i for i in range(len(days) - 1, -1, -1) if days[i].date <= prior), None)
        try:
            now = _snapshot(_metrics_at(engine, days, len(days) - 1), days[-1], shares)
            before = (
                _snapshot(_metrics_at(engine, days, prior_idx), days[prior_idx], shares)
                if prior_idx is not None
                else {"date": prior, "unrateable_reason": "prior date precedes the calibration window"}
            )
        except Exception as exc:
            fail(f"conversion failed: {type(exc).__name__}: {exc}")
            continue

        row.update(
            {
                "quote": _sig(days[-1].equity / shares, 6) if shares else None,
                "assetVol": _sig(engine.sigma_a),
                "assetRet": _sig(engine.r_a),
                "stockVol": _sig(engine.sigma_e),
                "snaps": [now, before],
            }
        )
        index.append(row)
        rated += 1

        series_dir.joinpath(f"{ticker}.json").write_text(
            json.dumps(
                {
                    "iterations": engine.iterations,
                    "converged": bool(engine.converged),
                    "sigmaA": _sig(engine.sigma_a),
                    "sigmaE": _sig(getattr(engine, "sigma_e", None)),
                    "rA": _sig(getattr(engine, "r_a", None)),
                    "sigmaHistory": [_sig(v) for v in engine.sigma_history],
                    "dates": [d.date for d in bundle.days],
                    "equity": [_sig(d.equity / 1e3, 6) for d in bundle.days],
                    "asset": [_sig(a / 1e3, 6) for a in engine.assets],
                    "debt": [_sig(d.debt / 1e3, 6) for d in bundle.days],
                    # daily bars for the candlestick view (split-adjusted, raw)
                    "ohlc": _ohlc(sample),
                },
                separators=(",", ":"),
            ),
            encoding="utf-8",
        )

    index.sort(key=lambda r: r["ticker"])
    data_dir.joinpath("index.json").write_text(
        json.dumps(index, separators=(",", ":"), ensure_ascii=False), encoding="utf-8"
    )
    # The prior snapshot can fail on its own while the company still rates, and
    # that failure is invisible unless counted here: --prior has to land inside
    # the --window calibration span, so shortening the window silently strips
    # every comparison. At window=150 the prior sits on trading day 8 of 150 —
    # anything under ~143 loses it for the whole index.
    no_prior = [r for r in index if "snaps" in r and "unrateable_reason" in r["snaps"][1]]
    summary = {
        "generated_for": {"current": cutoff_now, "prior": prior, "window": window},
        "constituents": len(index),
        "rated": rated,
        "unrateable": len(index) - rated,
        "reasons": dict(sorted(reasons.items(), key=lambda kv: -kv[1])),
        "without_prior_snapshot": len(no_prior),
        "without_prior_tickers": [r["ticker"] for r in no_prior][:20],
    }
    if rated and len(no_prior) > rated * 0.1:
        print(
            f"WARNING: {len(no_prior)}/{rated} names lost their prior snapshot — "
            f"--prior {prior} falls outside a {window}-day calibration window",
            file=sys.stderr,
        )
    data_dir.joinpath("summary.json").write_text(
        json.dumps(summary, indent=1, ensure_ascii=False), encoding="utf-8"
    )
    print(json.dumps(summary, indent=1, ensure_ascii=False), file=sys.stderr)
    return summary


# ────────────────────────────────────  cli  ──────────────────────────────────

def _load_env(path: Path = Path(".env")) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        if "=" not in line or line.strip().startswith("#"):
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("stage", choices=["fetch", "derive", "all", "constituents"])
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--tickers", nargs="*", default=None, help="restrict to these symbols")
    parser.add_argument("--limit", type=int, default=None, help="first N constituents only")
    parser.add_argument("--days", type=int, default=DEFAULT_DAYS)
    parser.add_argument("--window", type=int, default=DEFAULT_WINDOW)
    parser.add_argument("--prior", default=DEFAULT_PRIOR)
    parser.add_argument("--current", default=None, help="current snapshot cutoff (default: today)")
    parser.add_argument("--data-out", type=Path, default=None,
                        help="write the deployable payload here instead of <out>/data (e.g. web/data)")
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS)
    parser.add_argument("--min-interval", type=float, default=0.0, help="per-worker throttle, seconds")
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--force", action="store_true", help="re-fetch tickers that are already cached")
    args = parser.parse_args(argv)

    _load_env()
    args.out.mkdir(parents=True, exist_ok=True)

    if args.stage in ("constituents", "fetch", "all"):
        listing = args.out / "constituents.json"
        if listing.exists() and args.stage != "constituents":
            constituents = json.loads(listing.read_text(encoding="utf-8"))
            print(f"constituents: {len(constituents)} from cache", file=sys.stderr)
        else:
            constituents = fetch_constituents(timeout=args.timeout)
            listing.write_text(
                json.dumps(constituents, indent=1, ensure_ascii=False), encoding="utf-8"
            )
            print(f"constituents: {len(constituents)} scraped → {listing}", file=sys.stderr)
        if args.stage == "constituents":
            return 0
        if args.tickers:
            wanted = {t.upper() for t in args.tickers}
            constituents = [c for c in constituents if c["ticker"] in wanted]
        if args.limit:
            constituents = constituents[: args.limit]

    if args.stage in ("fetch", "all"):
        fetch_stage(
            constituents,
            args.out,
            days=args.days,
            workers=args.workers,
            timeout=args.timeout,
            min_interval=args.min_interval,
            force=args.force,
        )

    if args.stage in ("derive", "all"):
        derive_stage(args.out, window=args.window, prior=args.prior, current=args.current,
                     data_out=args.data_out)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
