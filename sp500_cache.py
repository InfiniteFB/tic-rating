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
import urllib.parse
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
DEFAULT_DAYS = 760          # calendar days requested from Massive; the feed caps at ~501 bars
DEFAULT_QUARTERS = 45       # ~11 years of balance sheets — every priced day needs one at or before it

# Massive's price feed refuses anything older than ~2 years (HTTP 403 on a purely
# historical window, every granularity anchored to today). Fundamentals are not
# capped the same way, so the deep price history comes from Yahoo's chart API —
# key-less, 10 years of daily bars, and its adjclose matches Massive's
# dividend-adjusted close to within 0.0001% on the 501-day overlap (measured on
# KO), so mixing the two sources introduces no reconciliation drift.
YAHOO_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range={range}&interval=1d"
YAHOO_RANGE = "10y"
DEFAULT_WINDOW = 150        # trading days the engine calibrates on (matches the workbook)
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


def fetch_yahoo(ticker: str, timeout: float = 45.0) -> dict[str, Any]:
    """Ten years of daily bars from Yahoo's chart API, as parallel arrays.

    Dotted share classes trade as hyphenated symbols there (BRK.B → BRK-B).
    Days where Yahoo reports a null close (halts, partial rows) are dropped so
    every array stays aligned.
    """
    symbol = ticker.replace(".", "-")
    url = YAHOO_URL.format(symbol=urllib.parse.quote(symbol), range=YAHOO_RANGE)
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (pfpa-research)"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        payload = json.loads(response.read().decode("utf-8"))

    result = (payload.get("chart", {}).get("result") or [None])[0]
    if not result:
        raise ValueError(f"yahoo returned no result for {symbol}: {str(payload)[:160]}")
    stamps = result.get("timestamp") or []
    quote = (result.get("indicators", {}).get("quote") or [{}])[0]
    adj = (result.get("indicators", {}).get("adjclose") or [{}])[0].get("adjclose") or []

    out: dict[str, list[Any]] = {k: [] for k in ("date", "o", "h", "l", "c", "adj", "v")}
    for i, ts in enumerate(stamps):
        close = (quote.get("close") or [None] * len(stamps))[i]
        if close is None:
            continue
        out["date"].append(datetime.fromtimestamp(ts, timezone.utc).date().isoformat())
        for key, field in (("o", "open"), ("h", "high"), ("l", "low"), ("v", "volume")):
            value = (quote.get(field) or [None] * len(stamps))[i]
            out[key].append(round(value, 4) if isinstance(value, float) else value)
        out["c"].append(round(close, 4))
        a = adj[i] if i < len(adj) else None
        out["adj"].append(round(a, 6) if isinstance(a, (int, float)) else close)
    if len(out["date"]) < 100:
        raise ValueError(f"yahoo returned only {len(out['date'])} usable bars for {symbol}")
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
    quarters: int = DEFAULT_QUARTERS,
) -> dict[str, str]:
    api_key = os.environ.get("MASSIVE_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("MASSIVE_API_KEY is not set")

    raw_dir = out_dir / "raw"
    raw_dir.mkdir(parents=True, exist_ok=True)

    end = date.today()
    start = end - timedelta(days=days)
    iso_start, iso_end = start.isoformat(), end.isoformat()
    # the risk-free series has to cover the deep Yahoo history, not just the
    # Massive price window
    deep_start = (end - timedelta(days=3800)).isoformat()

    # Both rate feeds are key-less and shared by every ticker — pull once, but
    # insist on a real series: silently falling back to a flat rate would apply
    # to all 503 names at once.
    (treasury, treasury_note), _ = _retry(
        "FRED DGS1",
        lambda: rp.fetch_treasury_yields(deep_start, iso_end, timeout=timeout),
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
            _summary, raw = massive.fetch_ticker(ticker, client(), iso_start, iso_end, quarters)
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

        # the deep price history, from Yahoo (see the note at YAHOO_URL)
        try:
            raw["yahoo"], _ = _retry(
                f"{ticker} yahoo", lambda: fetch_yahoo(ticker, timeout=timeout),
                ok=lambda y: bool(y and y.get("date")), attempts=retries + 1, delay=2.0,
            )
        except Exception as exc:
            raw["yahoo"] = None
            raw.setdefault("errors", {})["yahoo"] = " ".join(str(exc).split())[:160]

        # quarterly share counts — buybacks move the count enough over a decade
        # that yesterday's shares × a 2016 price is not a 2016 market cap
        try:
            income, _ = _retry(
                f"{ticker} income",
                lambda: client().get(
                    "/stocks/financials/v1/income-statements",
                    {"tickers": ticker, "timeframe": "quarterly",
                     "limit": quarters, "sort": "period_end.desc"},
                ),
                ok=lambda p: bool(_rows(p)), attempts=retries + 1, delay=2.0,
            )
            raw["responses"]["income_statement"] = income
        except Exception as exc:
            raw.setdefault("errors", {})["income_statement"] = " ".join(str(exc).split())[:160]

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

        yahoo_bars = len((raw.get("yahoo") or {}).get("date", []))
        note = (
            f"{len(prices)} massive rows, {yahoo_bars} yahoo bars, "
            f"{len(_rows(raw['responses'].get('balance_sheet')))} quarters, "
            f"{len(_rows(raw['responses'].get('income_statement')))} income stmts"
        )
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

WINDOWS = (90, 150, 250)     # calibration windows offered as a methodology knob
DETAIL_DAYS = 501            # daily-resolution tail (matches the Massive window)
WEEK_STEP = 5                # trading days per point in the deep-history grid


def _sig(value: Any, digits: int = 7) -> Any:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    try:
        return float(f"%.{digits}g" % value)
    except (ValueError, OverflowError):
        return None


def _metrics_at(result: Any, days: list[Any], idx: int) -> Any:
    """Re-evaluate the rating metrics at day ``idx`` of an existing fit."""
    snap = copy.copy(result)                 # shares sigma_a / r_a, own metrics
    snap.assets = result.assets[: idx + 1]   # _attach_rating reads assets[-1]
    _attach_rating(snap, days[idx])
    return snap


def _snapshot(result: Any, day: Any) -> dict[str, Any]:
    """The workbook's fields for one evaluated day. Composed exactly as
    app/pipeline.py composes them for the live API; ``price`` is filled by the
    caller from the actual close, since equity ÷ today's shares is not a price
    once the share count is allowed to move quarter by quarter."""
    sp = ttc_conversion.convert_fh_to_sp(result.ccm, result.mu, result.pd_fh)
    return {
        "date": day.date,
        "asset": _sig(result.asset_latest / 1e3, 6),   # thousands of USD
        "marketCap": _sig(result.equity_latest / 1e3, 6),
        "price": None,
        "mu": _sig(result.mu),
        "ccm": _sig(result.ccm),
        "rs": _sig(result.risk_score),                 # first-passage scale
        "rsSp": _sig(sp["rs_sp"]),                     # the score Table 8 is read with
        "fpPd": _sig(result.pd_fh),
        "alpha": _sig(sp["alpha"]),
        "spCcm": _sig(sp["ccm_star"]),
        "spPd": _sig(sp["sp_ttc_pd"]),
        "spRating": sp["sp_letter_fine"],
        "dd": _sig(result.dd),
        "edf": _sig(result.pit_pd),
        "outlook": sp["outlook"],
    }


def _filled_rates(dates: list[str], series: list[dict[str, Any]]) -> list[float]:
    """Forward-filled risk-free rate per date — one pointer walk, both sorted."""
    out: list[float] = []
    i, current = 0, FALLBACK_RATE
    for day in dates:
        while i < len(series) and str(series[i]["date"]) <= day:
            current = float(series[i]["rate"])
            i += 1
        out.append(current)
    return out


def _deep_price_rows(sample: dict[str, Any]) -> list[dict[str, Any]] | None:
    """The ten-year price series as build_inputs expects it: Yahoo's adjclose is
    the dividend-adjusted close (verified within 0.0001% of Massive's on the
    overlap), with the FRED rate forward-filled per day."""
    yahoo = sample.get("yahoo")
    if not yahoo or not yahoo.get("date"):
        return None
    rates = _filled_rates(yahoo["date"], sample.get("derived", {}).get("risk_free_rate_1y_series", []))
    return [
        {"date": d, "dividend_adjusted_close": adj, "risk_free_rate_1y": r}
        for d, adj, r in zip(yahoo["date"], yahoo["adj"], rates)
    ]


def _weekly(yahoo: dict[str, Any]) -> dict[str, Any]:
    """Weekly bars for the long price view: one bar per ISO week."""
    dates, o, h, l, c, v = [], [], [], [], [], []
    week = None
    for i, day in enumerate(yahoo["date"]):
        iso = date.fromisoformat(day).isocalendar()[:2]
        if iso != week:
            week = iso
            dates.append(day)
            o.append(yahoo["o"][i]); h.append(yahoo["h"][i]); l.append(yahoo["l"][i])
            c.append(yahoo["c"][i]); v.append(0)
        else:
            dates[-1] = day
            hi, lo = yahoo["h"][i], yahoo["l"][i]
            if hi is not None and (h[-1] is None or hi > h[-1]): h[-1] = hi
            if lo is not None and (l[-1] is None or lo < l[-1]): l[-1] = lo
            c[-1] = yahoo["c"][i]
        v[-1] += round((yahoo["v"][i] or 0) / 1e3)
    return {"dates": dates, "o": o, "h": h, "l": l, "c": c, "v": v}


def _legal_name(sample: dict[str, Any]) -> str | None:
    results = sample.get("responses", {}).get("ticker_overview", {}).get("results")
    if isinstance(results, dict):
        name = results.get("name")
        return str(name) if name else None
    return None


def _derive_one(job: tuple[str, str, int, str]) -> tuple[str, dict[str, Any] | None, str | None, str]:
    """Worker: one capture → (ticker, index row | None, unrateable reason, series path).

    Module-level and argument-picklable so it runs under ProcessPoolExecutor —
    the full-index derive is ~90 core-minutes and embarrassingly parallel.
    """
    raw_path, series_dir, detail_window, cutoff = job
    sample = json.loads(Path(raw_path).read_text(encoding="utf-8"))
    ticker = sample.get("ticker", Path(raw_path).stem)
    entry = sample.get("constituent", {})
    row: dict[str, Any] = {
        "ticker": ticker,
        "name": entry.get("name") or ticker,
        "legalName": _legal_name(sample) or entry.get("name") or ticker,
        "sector": entry.get("sector"),
        "asof": cutoff,
        "window": detail_window,
    }

    deep = _deep_price_rows(sample)
    source = "yahoo 10y"
    if deep is None:
        source = "massive 2y (no yahoo capture)"
        deep = [r for r in sample.get("derived", {}).get("daily_dividend_adjusted_prices", [])]
    deep = [r for r in deep if str(r.get("date", "")) <= cutoff]
    deep_sample = {**sample, "derived": {**sample.get("derived", {}), "daily_dividend_adjusted_prices": deep}}

    bundle = build_inputs(deep_sample, window=None)
    if bundle.unrateable_reason:
        return ticker, None, bundle.unrateable_reason, source
    days = bundle.days
    if len(days) < detail_window:
        return ticker, None, f"fewer than {detail_window} priced days available", source

    close_by_date = {r["date"]: r["dividend_adjusted_close"] for r in deep}

    def fit_at(idx: int, window: int) -> dict[str, Any] | None:
        slice_ = days[idx - window + 1 : idx + 1]
        try:
            engine = rate_company(slice_)
            snap = _snapshot(_metrics_at(engine, slice_, len(slice_) - 1), slice_[-1])
        except Exception:
            return None
        snap["price"] = _sig(close_by_date.get(slice_[-1].date), 6)
        snap["assetVol"] = _sig(engine.sigma_a)
        snap["assetRet"] = _sig(engine.r_a)
        snap["stockVol"] = _sig(engine.sigma_e)
        snap["_engine"] = engine
        return snap

    # ── daily detail, last DETAIL_DAYS, at the default window ──
    first = detail_window - 1
    detail_idx = list(range(max(first, len(days) - DETAIL_DAYS), len(days)))
    detail = []
    for i in detail_idx:
        snap = fit_at(i, detail_window)
        if snap is not None:
            detail.append((i, snap))
    if not detail:
        return ticker, None, "no day in the detail range would calibrate", source

    path_keys = ("spRating", "dd", "spPd", "fpPd", "edf", "rs", "rsSp", "ccm", "mu",
                 "alpha", "spCcm", "outlook", "price", "assetVol", "assetRet", "stockVol")
    idxs = [i for i, _ in detail]
    snaps = [s for _, s in detail]
    series_out: dict[str, Any] = {
        "window": detail_window,
        "windows": list(WINDOWS),
        "priceSource": source,
        "dates": [days[i].date for i in idxs],
        "asset": [_sig(s["asset"], 6) for s in snaps],
        "equity": [_sig(days[i].equity / 1e3, 6) for i in idxs],
        "debt": [_sig(days[i].debt / 1e3, 6) for i in idxs],
        "rate": [_sig(days[i].rate, 5) for i in idxs],
        "path": {k: [s[k] for s in snaps] for k in path_keys},
    }

    # ── the deep history: a weekly grid per window, whole span ──
    history: dict[str, Any] = {}
    grid_cache: dict[int, list[int]] = {}
    for window in WINDOWS:
        start = window - 1
        if start >= len(days):
            continue
        grid = list(range(start, len(days), WEEK_STEP))
        if grid[-1] != len(days) - 1:
            grid.append(len(days) - 1)
        grid_cache[window] = grid
    if grid_cache:
        # one shared date axis: the union is just the densest grid's dates
        for window, grid in grid_cache.items():
            fits = [(i, fit_at(i, window)) for i in grid]
            fits = [(i, s) for i, s in fits if s is not None]
            history[str(window)] = {
                "dates": [days[i].date for i, _ in fits],
                "spRating": [s["spRating"] for _, s in fits],
                "dd": [s["dd"] for _, s in fits],
            }
    series_out["history"] = history

    # ── the latest full snapshot per window, for the methodology toggle ──
    latest: dict[str, Any] = {}
    for window in WINDOWS:
        if window - 1 >= len(days):
            continue
        snap = fit_at(len(days) - 1, window)
        if snap is None:
            continue
        engine = snap.pop("_engine")
        snap["iterations"] = engine.iterations
        snap["converged"] = bool(engine.converged)
        latest[str(window)] = snap
    series_out["latest"] = latest

    # calibration block for the default window (existing UI reads these names)
    default_engine = snaps[-1]["_engine"]
    series_out.update(
        {
            "iterations": default_engine.iterations,
            "converged": bool(default_engine.converged),
            "sigmaA": _sig(default_engine.sigma_a),
            "sigmaE": _sig(default_engine.sigma_e),
            "rA": _sig(default_engine.r_a),
            "sigmaHistory": [_sig(v) for v in default_engine.sigma_history],
        }
    )
    for s in snaps:
        s.pop("_engine", None)

    # ── the filings behind the default point, verbatim — provenance ──
    q_shares = {str(r.get("period_end", ""))[:10]: r.get("basic_shares_outstanding")
                for r in _rows(sample.get("responses", {}).get("income_statement"))}
    series_out["quarters"] = [
        {
            "periodEnd": str(r.get("period_end", ""))[:10],
            "filed": str(r.get("filing_date", ""))[:10] or None,
            "debtCurrent": _sig((r.get("debt_current") or 0) / 1e3, 6) if r.get("debt_current") is not None else None,
            "longTermDebt": _sig((r.get("long_term_debt_and_capital_lease_obligations") or 0) / 1e3, 6)
                if r.get("long_term_debt_and_capital_lease_obligations") is not None else None,
            "totalLiabilities": _sig((r.get("total_liabilities") or 0) / 1e3, 6)
                if r.get("total_liabilities") is not None else None,
            "totalCurrentLiabilities": _sig((r.get("total_current_liabilities") or 0) / 1e3, 6)
                if r.get("total_current_liabilities") is not None else None,
            "shares": q_shares.get(str(r.get("period_end", ""))[:10]),
        }
        for r in sorted(_rows(sample.get("responses", {}).get("balance_sheet")),
                        key=lambda r: str(r.get("period_end", "")))
    ]

    # ── price bars: daily tail plus a weekly series for the long view ──
    yahoo = sample.get("yahoo")
    if yahoo and yahoo.get("date"):
        tail = slice(max(0, len(yahoo["date"]) - DETAIL_DAYS), None)
        series_out["ohlc"] = {
            "dates": yahoo["date"][tail],
            "o": yahoo["o"][tail], "h": yahoo["h"][tail], "l": yahoo["l"][tail],
            "c": yahoo["c"][tail],
            "v": [round((x or 0) / 1e3) for x in yahoo["v"][tail]],
        }
        series_out["ohlcW"] = _weekly(yahoo)

    # ── the index row: latest snapshot, and one window earlier for the move ──
    last_snap = dict(snaps[-1])
    prior_snap = dict(snaps[-1 - detail_window]) if len(snaps) > detail_window else None
    row.update(
        {
            "quote": last_snap.get("price"),
            "assetVol": series_out["sigmaA"],
            "assetRet": series_out["rA"],
            "stockVol": series_out["sigmaE"],
            "snaps": [last_snap, prior_snap] if prior_snap else [last_snap],
        }
    )

    out_path = Path(series_dir) / f"{ticker}.json"
    tmp = out_path.with_name(f".{ticker}.json.tmp")
    tmp.write_text(json.dumps(series_out, separators=(",", ":")), encoding="utf-8")
    tmp.replace(out_path)
    return ticker, row, None, source


def derive_stage(
    out_dir: Path,
    *,
    window: int = DEFAULT_WINDOW,
    current: str | None = None,
    data_out: Path | None = None,
    workers: int | None = None,
    tickers: list[str] | None = None,
) -> dict[str, Any]:
    raw_dir = out_dir / "raw"
    data_dir = data_out or (out_dir / "data")
    series_dir = data_dir / "series"
    series_dir.mkdir(parents=True, exist_ok=True)

    cutoff = current or date.today().isoformat()
    files = sorted(raw_dir.glob("*.json"))
    if tickers:
        wanted = {t.upper() for t in tickers}
        files = [f for f in files if f.stem.upper() in wanted]
    if not files:
        raise SystemExit(f"no captures in {raw_dir} — run the fetch stage first")

    jobs = [(str(p), str(series_dir), window, cutoff) for p in files]
    index: list[dict[str, Any]] = []
    reasons: dict[str, int] = {}
    sources: dict[str, int] = {}
    t0 = time.monotonic()

    from concurrent.futures import ProcessPoolExecutor

    n_workers = workers or max(1, (os.cpu_count() or 4) - 2)
    with ProcessPoolExecutor(max_workers=n_workers) as pool:
        for k, (ticker, row, reason, source) in enumerate(pool.map(_derive_one, jobs), 1):
            sources[source] = sources.get(source, 0) + 1
            if row is None:
                entry = json.loads(Path(raw_dir / f"{ticker}.json").read_text())["constituent"]
                index.append({"ticker": ticker, "name": entry.get("name") or ticker,
                              "legalName": entry.get("name") or ticker,
                              "sector": entry.get("sector"), "asof": cutoff,
                              "window": window, "unrateable_reason": reason})
                reasons[reason] = reasons.get(reason, 0) + 1
            else:
                index.append(row)
            if k % 50 == 0 or k == len(jobs):
                print(f"derive [{k}/{len(jobs)}] {time.monotonic()-t0:.0f}s", file=sys.stderr, flush=True)

    index.sort(key=lambda r: r["ticker"])
    data_dir.joinpath("index.json").write_text(
        json.dumps(index, separators=(",", ":"), ensure_ascii=False), encoding="utf-8"
    )
    rated = sum(1 for r in index if "snaps" in r)
    summary = {
        "generated_for": {"current": cutoff, "window": window,
                          "windows": list(WINDOWS), "detail_days": DETAIL_DAYS},
        "constituents": len(index),
        "rated": rated,
        "unrateable": len(index) - rated,
        "reasons": dict(sorted(reasons.items(), key=lambda kv: -kv[1])),
        "price_sources": sources,
    }
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
        derive_stage(args.out, window=args.window, current=args.current,
                     data_out=args.data_out, workers=args.workers, tickers=args.tickers)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
