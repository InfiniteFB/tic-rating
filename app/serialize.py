"""Serialize engine objects (rating_inputs / kmv_engine / ttc_conversion) into
JSON-safe plain dicts for the rating dashboard API.

Pure functions, no IO. Every function tolerates missing/optional data (raw
Massive API samples vary in field presence) and every float passes through
:func:`_num`. This avoids emitting the illegal ``Infinity`` / ``NaN`` tokens
that ``json.dumps`` produces by default (which break strict JSON parsers and
the frontend); ``tic`` in particular can be inf for extremely safe credits.
"""

from __future__ import annotations

import math
from typing import Any


def _num(x: Any) -> float | None:
    """Coerce to float; None/bool/inf/nan/unconvertible become None (JSON-safe).

    ``bool`` is rejected explicitly (it is an ``int`` subclass) so a flag like
    ``converged`` accidentally routed here yields None rather than 1.0/0.0.
    """
    if x is None or isinstance(x, bool):
        return None
    try:
        val = float(x)
    except (TypeError, ValueError):
        return None
    if math.isinf(val) or math.isnan(val):
        return None
    return val


def _rows(payload: Any) -> list[dict[str, Any]]:
    """Mirror rating_inputs._rows: unwrap a Massive-style {"results": [...]}"""
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
            if val is not None:
                return _num(val)
    return None


def _rate_series(rows: Any) -> list[dict[str, Any]]:
    """Sanitize a [{date, rate}, ...] series so every ``rate`` is JSON-safe."""
    out: list[dict[str, Any]] = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        out.append({"date": row.get("date"), "rate": _num(row.get("rate"))})
    return out


def source_dict(sample: dict[str, Any]) -> dict[str, Any]:
    """Raw-input view of a Massive sample: shares, balance sheet, prices, rates."""
    sample = sample or {}
    responses = sample.get("responses", {}) or {}
    derived = sample.get("derived", {}) or {}

    balance_sheet = []
    for row in _rows(responses.get("balance_sheet", {})):
        balance_sheet.append(
            {
                "period_end": row.get("period_end"),
                "debt_current": _num(row.get("debt_current")),
                "long_term_debt_and_capital_lease_obligations": _num(
                    row.get("long_term_debt_and_capital_lease_obligations")
                ),
                "total_current_liabilities": _num(row.get("total_current_liabilities")),
            }
        )

    prices = []
    for row in derived.get("daily_dividend_adjusted_prices", []) or []:
        if not isinstance(row, dict):
            continue
        prices.append(
            {
                "date": row.get("date"),
                "dividend_adjusted_close": _num(row.get("dividend_adjusted_close")),
                "risk_free_rate_1y": _num(row.get("risk_free_rate_1y")),
                "sofr": _num(row.get("sofr")),
            }
        )

    return {
        "ticker": sample.get("ticker"),
        "shares_outstanding": _shares_outstanding(responses.get("ticker_overview", {})),
        "balance_sheet": balance_sheet,
        "prices": prices,
        "risk_free_rate_1y_series": _rate_series(derived.get("risk_free_rate_1y_series")),
        "sofr_series": _rate_series(derived.get("sofr_series")),
        "notes": sample.get("notes", {}) or {},
    }


def _default_points(bundle: Any) -> list[dict[str, Any]]:
    """Per-quarter default-point schedule implied by bundle.days.

    Collapses consecutive trading days that share the same as-of default point
    into one row (the first day the quarter's debt level took effect), so two
    quarters with an identical debt level still surface as separate dated rows.
    A run boundary is a *change* in debt vs. the previous day, which matches the
    step-function shape of the per-quarter default point.
    """
    points: list[dict[str, Any]] = []
    prev_debt: float | None = None
    started = False
    for day in getattr(bundle, "days", []) or []:
        debt = _num(getattr(day, "debt", None))
        if debt is None:
            continue
        if not started or debt != prev_debt:
            points.append({"date": getattr(day, "date", None), "debt": debt})
            prev_debt = debt
            started = True
    return points


def intermediate_dict(bundle: Any, result: Any) -> dict[str, Any]:
    """Mid-pipeline view: per-day KMV inputs plus (if available) EM outputs."""
    day_inputs = [
        {
            "date": getattr(day, "date", None),
            "equity": _num(getattr(day, "equity", None)),
            "debt": _num(getattr(day, "debt", None)),
            "rate": _num(getattr(day, "rate", None)),
            "tau": _num(getattr(day, "tau", None)),
        }
        for day in getattr(bundle, "days", []) or []
    ]

    out: dict[str, Any] = {
        "day_inputs": day_inputs,
        "default_points": _default_points(bundle),
        "em": {},
        "assets": [],
        "metrics": {},
    }

    if result is None:
        return out

    out["em"] = {
        "iterations": result.iterations,
        "converged": result.converged,
        "sigma_history": [_num(v) for v in result.sigma_history],
        "sigma_a": _num(result.sigma_a),
        "sigma_e": _num(result.sigma_e),
        "eta_a": _num(result.eta_a),
        "r_a": _num(result.r_a),
    }
    out["assets"] = [_num(v) for v in result.assets]
    out["metrics"] = {
        "dd": _num(result.dd),
        "pit_pd": _num(result.pit_pd),
        "pd_fh": _num(result.pd_fh),
        "tic": _num(result.tic),
        "risk_score": _num(result.risk_score),
        "ccm": _num(result.ccm),
        "mu": _num(result.mu),
        "asset_latest": _num(result.asset_latest),
        "equity_latest": _num(result.equity_latest),
        "debt_latest": _num(result.debt_latest),
        "tau_latest": _num(result.tau_latest),
    }
    return out


def result_dict(
    result: Any,
    sp: dict[str, Any] | None,
    *,
    unrateable_reason: str | None = None,
    compute_error: str | None = None,
) -> dict[str, Any]:
    """Final rating view: S&P TTC conversion outputs plus status flags."""
    sp = sp or {}
    out: dict[str, Any] = {
        "ccm_star": _num(sp.get("ccm_star")),
        "alpha": _num(sp.get("alpha")),
        "rs_sp": _num(sp.get("rs_sp")),
        "sp_letter": sp.get("sp_letter"),
        "sp_letter_fine": sp.get("sp_letter_fine"),
        "sp_ttc_pd": _num(sp.get("sp_ttc_pd")),
        "credit_outlook": _num(sp.get("credit_outlook")),
        "outlook": sp.get("outlook"),  # "+" / "-", professor's convention

        "unrateable_reason": unrateable_reason or None,
        "compute_error": compute_error or None,
        "partial": bool(compute_error),
    }
    return out
