#!/usr/bin/env python3
"""Assemble KMV model inputs from Massive raw sample JSON and rate companies.

Bridges the data-access component (``test_massive_api.py`` raw samples) to the
credit-assessment component (``kmv_engine.py``):

  * Equity series  E_t = dividend_adjusted_close_t * shares_outstanding
  * Default point  D    = total_liabilities (per quarter) -- the professor's
                          finalized convention (answer workbook 2026-07-27);
                          ``--debt-basis kmv`` restores debt_current + 0.5 * LTD
  * Risk-free rate r    = the per-day 1y rate attached to each price row by
                          rating_pipeline.py (FRED DGS1); ``--rate`` flat value
                          is only a fallback for legacy samples without it
  * Time-to-maturity tau ~= 1 - (price_date - quarter_end)/365, clamped to (0,1]
  * Estimation window   = the last ``--window`` trading days (default 150)

Run against the existing samples::

    python3 rating_inputs.py                 # all tickers in massive_api_raw_samples/
    python3 rating_inputs.py --tickers KO WMT --rate 0.045
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import ttc_conversion as ttc
from kmv_engine import DayInput, EMResult, rate_company

CALENDAR_DAYS = 365.0
DEFAULT_RATE = 0.045          # flat 1y risk-free fallback (matches the MSFT slide)
DEFAULT_HORIZON_DAYS = 365.0  # debt assumed to mature 1y after each quarter-end
MIN_TAU = 1.0 / CALENDAR_DAYS  # keep tau strictly positive
DEFAULT_WINDOW = 150          # estimation window in trading days (answer workbook)


@dataclass
class InputBundle:
    ticker: str
    days: list[DayInput]
    shares: float | None
    unrateable_reason: str = ""


def _iso(d: str) -> date:
    return date.fromisoformat(d[:10])


def _rows(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        return []
    results = payload.get("results", [])
    if isinstance(results, list):
        return [r for r in results if isinstance(r, dict)]
    if isinstance(results, dict):
        return [results]
    return []


def _shares_outstanding(overview: Any) -> float | None:
    for row in _rows(overview):
        for field in ("weighted_shares_outstanding", "share_class_shares_outstanding"):
            val = row.get(field)
            if val:
                return float(val)
    return None


def _default_points(
    balance: Any,
    st_debt_fallback: str = "strict",
    debt_basis: str = "total_liabilities",
) -> list[tuple[date, float]]:
    """Per-quarter default point, (period_end, D) sorted ascending.

    ``debt_basis`` selects the finalized convention:

    * ``"total_liabilities"`` (default) -- D = total_liabilities.  This is the
      professor's finalized choice (answer workbook 2026-07-27): unambiguous
      across issuers (no short-vs-long classification issues, works for banks)
      and the only convention under which the first-passage PIT PDs reach the
      10-70% range his TiC theory expects.
    * ``"kmv"`` -- classic KMV: D = debt_current + 0.5 * long_term debt.
      Handling of a missing ``debt_current`` (e.g. COST/AMZN report no separate
      short-term financing-debt line) follows ``st_debt_fallback``:
      ``"strict"`` skip the quarter / ``"zero"`` treat as 0 /
      ``"curliab"`` use total_current_liabilities (overstated).
    """
    points: list[tuple[date, float]] = []
    for row in _rows(balance):
        pe = row.get("period_end")
        if not pe:
            continue
        if debt_basis == "total_liabilities":
            tl = row.get("total_liabilities")
            if tl is None:
                continue
            points.append((_iso(pe), float(tl)))
            continue
        long_term = row.get("long_term_debt_and_capital_lease_obligations")
        if long_term is None:
            continue
        current = row.get("debt_current")
        if current is None:
            if st_debt_fallback == "zero":
                current = 0.0
            elif st_debt_fallback == "curliab":
                current = row.get("total_current_liabilities")
            if current is None:  # strict, or curliab with no current liabilities
                continue
        points.append((_iso(pe), float(current) + 0.5 * float(long_term)))
    points.sort(key=lambda t: t[0])
    return points


def _as_of(points: list[tuple[date, float]], on: date) -> tuple[date, float] | None:
    """Latest (period_end, D) with period_end <= ``on`` (no look-ahead)."""
    chosen: tuple[date, float] | None = None
    for pe, d in points:
        if pe <= on:
            chosen = (pe, d)
        else:
            break
    return chosen


def build_inputs(
    sample: dict[str, Any],
    *,
    rate: float = DEFAULT_RATE,
    horizon_days: float = DEFAULT_HORIZON_DAYS,
    st_debt_fallback: str = "strict",
    debt_basis: str = "total_liabilities",
    window: int | None = DEFAULT_WINDOW,
) -> InputBundle:
    ticker = sample.get("ticker", "?")
    responses = sample.get("responses", {})
    derived = sample.get("derived", {})
    shares = _shares_outstanding(responses.get("ticker_overview", {}))
    prices = derived.get("daily_dividend_adjusted_prices", [])
    points = _default_points(responses.get("balance_sheet", {}), st_debt_fallback, debt_basis)

    if shares is None:
        return InputBundle(ticker, [], shares, "no shares outstanding")
    if not points:
        reason = (
            "no quarter reports total_liabilities"
            if debt_basis == "total_liabilities"
            else "no quarter has both debt components (debt_current + long_term)"
        )
        return InputBundle(ticker, [], shares, reason)
    if not prices:
        return InputBundle(ticker, [], shares, "no daily prices")

    days: list[DayInput] = []
    for row in prices:
        pdate = row.get("date")
        close = row.get("dividend_adjusted_close")
        if not pdate or close is None:
            continue
        on = _iso(pdate)
        asof = _as_of(points, on)
        if asof is None:
            continue  # price predates the earliest available quarter
        quarter_end, debt = asof
        elapsed = (on - quarter_end).days
        tau = max(MIN_TAU, 1.0 - elapsed / horizon_days)
        # Prefer the per-day 1y risk-free rate attached by rating_pipeline.py
        # (FRED DGS1); fall back to the flat rate for legacy samples.
        row_rate = row.get("risk_free_rate_1y")
        day_rate = float(row_rate) if row_rate is not None else rate
        days.append(
            DayInput(
                date=pdate,
                equity=float(close) * shares,
                debt=debt,
                rate=day_rate,
                tau=tau,
            )
        )

    if window is not None and window > 0:
        days = days[-window:]
    if len(days) < 2:
        return InputBundle(ticker, days, shares, "fewer than 2 usable trading days")
    return InputBundle(ticker, days, shares)


def load_sample(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def rate_from_sample(
    path: Path,
    *,
    rate: float = DEFAULT_RATE,
    st_debt_fallback: str = "strict",
    debt_basis: str = "total_liabilities",
    window: int | None = DEFAULT_WINDOW,
) -> tuple[InputBundle, EMResult | None]:
    bundle = build_inputs(
        load_sample(path),
        rate=rate,
        st_debt_fallback=st_debt_fallback,
        debt_basis=debt_basis,
        window=window,
    )
    if bundle.unrateable_reason:
        return bundle, None
    return bundle, rate_company(bundle.days)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples-dir", type=Path, default=Path("massive_api_raw_samples"))
    parser.add_argument("--tickers", nargs="*", default=None)
    parser.add_argument("--rate", type=float, default=DEFAULT_RATE, help="flat 1y risk-free rate")
    parser.add_argument(
        "--st-debt-fallback",
        choices=("strict", "zero", "curliab"),
        default="strict",
        help="(kmv basis only) how to handle a missing debt_current: strict=skip "
        "(UNRATEABLE), zero=treat short-term debt as 0, curliab=use total current liabilities",
    )
    parser.add_argument(
        "--debt-basis",
        choices=("total_liabilities", "kmv"),
        default="total_liabilities",
        help="default point: total_liabilities (professor's finalized convention) "
        "or kmv (debt_current + 0.5 * long-term)",
    )
    parser.add_argument(
        "--window",
        type=int,
        default=DEFAULT_WINDOW,
        help="estimation window in trading days (0 = use all days)",
    )
    args = parser.parse_args(argv)

    if args.tickers:
        paths = [args.samples_dir / f"{t}.json" for t in args.tickers]
    else:
        paths = sorted(args.samples_dir.glob("*.json"))

    header = (
        f"{'ticker':<6} {'days':>4} {'sigma_A':>8} {'R_A':>8} {'DD':>7} "
        f"{'EDF':>9} {'PIT_PD':>9} {'RiskScore':>9} {'S&P':>6} {'TTC_PD':>8} {'Otk':>3}  status"
    )
    print(header)
    print("-" * len(header))
    for path in paths:
        if not path.exists():
            print(f"{path.stem:<6}  MISSING FILE")
            continue
        bundle, result = rate_from_sample(
            path,
            rate=args.rate,
            st_debt_fallback=args.st_debt_fallback,
            debt_basis=args.debt_basis,
            window=args.window or None,
        )
        if result is None:
            print(
                f"{bundle.ticker:<6} {len(bundle.days):>4} {'':>8} {'':>8} {'':>7} "
                f"{'':>9} {'':>9} {'':>9} {'':>6} {'':>8} {'':>3}  UNRATEABLE: {bundle.unrateable_reason}"
            )
            continue
        # PIT (first-passage) -> S&P TTC conversion (paper Section 5.3).
        sp = ttc.convert_fh_to_sp(result.ccm, result.mu, result.pd_fh)
        conv = "" if result.converged else " (max_iter)"
        print(
            f"{bundle.ticker:<6} {len(bundle.days):>4} "
            f"{result.sigma_a:>8.4f} {result.r_a:>8.4f} {result.dd:>7.3f} "
            f"{result.pit_pd:>9.5%} {result.pd_fh:>9.5%} {result.risk_score:>9.3f} "
            f"{sp['sp_letter_fine']:>6} {sp['sp_ttc_pd']:>8.4%} {sp['outlook']:>3}"
            f"  it={result.iterations}{conv}"
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
