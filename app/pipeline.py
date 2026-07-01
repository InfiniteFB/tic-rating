"""Orchestrate the KMV rating pipeline for a single ticker.

Wires together the data-fetch layer (``rating_pipeline.fetch_all``), the
input-assembly layer (``rating_inputs.build_inputs``), the credit-assessment
engine (``kmv_engine.rate_company`` / ``ttc_conversion.convert_fh_to_sp``),
and the JSON serialization layer (``app.serialize``) into a single call
suitable for an API route: :func:`rate_ticker`.

Handles three failure modes without crashing:

* **Unrateable inputs** (e.g. no usable default-point schedule) -- reported
  via ``result.unrateable_reason``, no rating is attempted.
* **Rate limiting** on the upstream data provider -- detected when the price
  series comes back empty but other responses are present; retried once with
  a short backoff and surfaced as a warning if still empty.
* **Compute errors** in the rating engine itself -- caught and reported via
  ``result.compute_error`` so the caller still gets source/intermediate data.

``fetch_all`` and ``time`` are imported directly into this module's namespace
(rather than via ``rating_pipeline.fetch_all`` / ``time.sleep`` at call time)
so tests can patch ``app.pipeline.fetch_all`` and ``app.pipeline.time.sleep``.
"""

from __future__ import annotations

import time
from typing import Any

from rating_pipeline import fetch_all

import rating_inputs
import kmv_engine
import ttc_conversion
from app import serialize


class RateLimited(Exception):
    """Raised when the upstream data provider appears to be rate-limiting us."""


class NotFound(Exception):
    """Raised when the ticker is invalid or the provider has no data for it."""


def _has_signal(sample: dict[str, Any]) -> bool:
    """True if ``sample.responses`` has any of the fields we depend on."""
    responses = (sample or {}).get("responses", {}) or {}
    return bool(responses.get("ticker_overview")) or bool(responses.get("balance_sheet"))


def _fetch_one(
    ticker: str,
    *,
    days: int,
    fallback_rate: float,
    retries: int = 1,
) -> tuple[dict[str, Any], list[str]]:
    """Fetch the raw sample for ``ticker``, retrying once on apparent rate-limiting.

    Returns (sample, warnings). Raises :class:`NotFound` if the provider has
    no data at all for the ticker (empty ``responses``).
    """
    warnings: list[str] = []
    attempts = retries + 1
    sample: dict[str, Any] = {}
    for attempt in range(attempts):
        result = fetch_all([ticker], days=days, fallback_rate=fallback_rate)
        sample = result.get(ticker, {}) or {}
        prices = ((sample.get("derived", {}) or {}).get("daily_dividend_adjusted_prices") or [])
        if prices:
            return sample, warnings
        if not _has_signal(sample):
            raise NotFound(f"No data found for ticker '{ticker}'")
        # Empty prices but other responses present looks like rate limiting.
        if attempt < attempts - 1:
            warnings.append("Price data came back empty; possible rate limiting, retrying.")
            time.sleep(2)
            continue
        warnings.append("Price data still empty after retry; possible rate limiting.")
    return sample, warnings


def rate_ticker(
    ticker: str,
    *,
    days: int,
    st_debt_fallback: str,
    horizon_days: float,
    fallback_rate: float,
) -> dict[str, Any]:
    """Fetch, assemble, rate, and serialize a single ticker end-to-end."""
    t0 = time.time()
    ticker = (ticker or "").strip().upper()
    if not ticker or any(ch.isspace() for ch in ticker):
        raise NotFound("Ticker must be a non-empty string with no whitespace")

    meta: dict[str, Any] = {"warnings": [], "timings": {}}

    sample, warnings = _fetch_one(ticker, days=days, fallback_rate=fallback_rate)
    meta["warnings"].extend(warnings)

    bundle = rating_inputs.build_inputs(
        sample,
        rate=fallback_rate,
        horizon_days=horizon_days,
        st_debt_fallback=st_debt_fallback,
    )
    source = serialize.source_dict(sample)

    if bundle.unrateable_reason:
        meta["timings"]["total_s"] = round(time.time() - t0, 2)
        return {
            "ticker": ticker,
            "source": source,
            "intermediate": serialize.intermediate_dict(bundle, None),
            "result": serialize.result_dict(None, None, unrateable_reason=bundle.unrateable_reason),
            "meta": meta,
        }

    try:
        result = kmv_engine.rate_company(bundle.days)
        sp = ttc_conversion.convert_fh_to_sp(result.ccm, result.mu, result.pd_fh)
        res = serialize.result_dict(result, sp)
        inter = serialize.intermediate_dict(bundle, result)
    except Exception as exc:
        res = serialize.result_dict(None, None, compute_error=f"{type(exc).__name__}: {exc}")
        inter = serialize.intermediate_dict(bundle, None)
        meta["warnings"].append("Rating computation failed; showing inputs only.")

    meta["timings"]["total_s"] = round(time.time() - t0, 2)
    return {
        "ticker": ticker,
        "source": source,
        "intermediate": inter,
        "result": res,
        "meta": meta,
    }
