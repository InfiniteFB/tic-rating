#!/usr/bin/env python3
"""Minimal Massive API coverage test for the ten PFPA companies."""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


TICKERS = ["COST", "KO", "DELL", "ORCL", "PNC", "WMT", "INTU", "AMZN", "T", "KHC"]
BASE_URL = "https://api.massive.com"
BALANCE_FIELDS = [
    "period_end",
    "filing_date",
    "total_assets",
    "total_liabilities",
    "total_current_liabilities",
    "debt_current",
    "long_term_debt_and_capital_lease_obligations",
    "cash_and_equivalents",
    "total_equity_attributable_to_parent",
]
SUMMARY_FIELDS = [
    "ticker",
    "quarterly_rows",
    "latest_period_end",
    "latest_filing_date",
    "has_total_assets",
    "has_total_liabilities",
    "has_current_liabilities",
    "has_debt_current",
    "has_long_term_debt",
    "has_direct_total_debt",
    "has_computable_total_debt",
    "derived_total_debt_rows",
    "latest_derived_total_debt",
    "has_cash_and_equivalents",
    "has_stockholders_equity",
    "daily_price_rows",
    "price_split_adjusted",
    "has_direct_adjusted_close",
    "derived_adjusted_price_rows",
    "latest_dividend_adjusted_close",
    "dividend_rows",
    "has_dividend_adjustment_factor",
    "has_shares_outstanding",
    "shares_outstanding_field",
    "error_message",
]


class MassiveApiError(RuntimeError):
    pass


class MassiveClient:
    def __init__(self, api_key: str, timeout: float = 30.0, min_interval: float = 12.5):
        self.api_key = api_key
        self.timeout = timeout
        self.min_interval = min_interval
        self._last_request_at: float | None = None

    def get(self, endpoint: str, params: dict[str, Any]) -> Any:
        if self._last_request_at is not None and self.min_interval > 0:
            delay = self.min_interval - (time.monotonic() - self._last_request_at)
            if delay > 0:
                time.sleep(delay)
        query = urlencode({**params, "apiKey": self.api_key})
        request = Request(
            f"{BASE_URL}{endpoint}?{query}",
            headers={"Accept": "application/json", "User-Agent": "pfpa-massive-smoke-test/1.0"},
        )
        try:
            self._last_request_at = time.monotonic()
            with urlopen(request, timeout=self.timeout) as response:
                body = response.read().decode("utf-8")
        except HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise MassiveApiError(f"HTTP {exc.code}: {_error_text(body)}") from exc
        except (URLError, TimeoutError) as exc:
            reason = exc.reason if isinstance(exc, URLError) else exc
            raise MassiveApiError(str(reason)) from exc

        try:
            payload = json.loads(body)
        except json.JSONDecodeError as exc:
            raise MassiveApiError(f"invalid JSON response: {exc}") from exc
        message = _payload_error(payload)
        if message:
            raise MassiveApiError(message)
        return payload


def _payload_error(payload: Any) -> str:
    if not isinstance(payload, dict):
        return ""
    status = str(payload.get("status", "")).upper()
    if status in {"ERROR", "NOT_AUTHORIZED"}:
        return str(payload.get("error") or payload.get("message") or status)
    return str(payload.get("error") or "")


def _error_text(body: str) -> str:
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return " ".join(body.split())[:300] or "empty response"
    return _payload_error(payload) or str(payload.get("message", payload))[:300]


def _rows(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, dict):
        return []
    results = payload.get("results", [])
    if isinstance(results, list):
        return [row for row in results if isinstance(row, dict)]
    if isinstance(results, dict):
        return [results]
    return []


def _present(row: dict[str, Any], field: str) -> bool:
    return field in row and row[field] is not None and row[field] != ""


def _has(payload: Any, field: str) -> bool:
    return any(_present(row, field) for row in _rows(payload))


def derive_total_debt(balance_sheet: Any) -> list[dict[str, Any]]:
    derived = []
    for row in _rows(balance_sheet):
        current = row.get("debt_current")
        long_term = row.get("long_term_debt_and_capital_lease_obligations")
        total = current + long_term if current is not None and long_term is not None else None
        derived.append(
            {
                "period_end": row.get("period_end"),
                "debt_current": current,
                "long_term_debt_and_capital_lease_obligations": long_term,
                "derived_total_debt": total,
            }
        )
    return derived


def _price_date(row: dict[str, Any]) -> str:
    if row.get("date"):
        return str(row["date"])[:10]
    timestamp = row.get("t")
    if timestamp is None:
        return ""
    return datetime.fromtimestamp(float(timestamp) / 1000, tz=timezone.utc).date().isoformat()


def derive_dividend_adjusted_prices(prices: Any, dividends: Any) -> list[dict[str, Any]]:
    factors = sorted(
        (
            (str(row["ex_dividend_date"]), row["historical_adjustment_factor"])
            for row in _rows(dividends)
            if _present(row, "ex_dividend_date")
            and _present(row, "historical_adjustment_factor")
        ),
        key=lambda item: item[0],
    )
    derived = []
    for row in _rows(prices):
        price_date = _price_date(row)
        close = row.get("c")
        if not price_date or close is None:
            continue
        factor = next((factor for ex_date, factor in factors if ex_date > price_date), 1.0)
        derived.append(
            {
                "date": price_date,
                "timestamp": row.get("t"),
                "split_adjusted_close": close,
                "dividend_adjustment_factor": factor,
                "dividend_adjusted_close": close * factor,
            }
        )
    return derived


def endpoint_paths(
    ticker: str, start_date: str, end_date: str
) -> dict[str, tuple[str, dict[str, Any]]]:
    return {
        "balance_sheet": (
            "/stocks/financials/v1/balance-sheets",
            {
                "tickers": ticker,
                "timeframe": "quarterly",
                "limit": 8,
                "sort": "period_end.desc",
            },
        ),
        "prices": (
            f"/v2/aggs/ticker/{ticker}/range/1/day/{start_date}/{end_date}",
            {"adjusted": "true", "sort": "asc", "limit": 50000},
        ),
        "dividends": (
            "/stocks/v1/dividends",
            {
                "ticker": ticker,
                "ex_dividend_date.gte": start_date,
                "ex_dividend_date.lte": end_date,
                "limit": 1000,
                "sort": "ex_dividend_date.desc",
            },
        ),
        "ticker_overview": (f"/v3/reference/tickers/{ticker}", {}),
    }


def build_summary(
    ticker: str, payloads: dict[str, Any], errors: dict[str, str]
) -> dict[str, Any]:
    balance = payloads.get("balance_sheet", {})
    balance_rows = _rows(balance)
    latest = max(balance_rows, key=lambda row: str(row.get("period_end", "")), default={})
    prices = payloads.get("prices", {})
    dividends = payloads.get("dividends", {})
    overview = payloads.get("ticker_overview", {})
    debt_rows = derive_total_debt(balance)
    usable_debt_rows = [row for row in debt_rows if row["derived_total_debt"] is not None]
    latest_debt = max(
        usable_debt_rows, key=lambda row: str(row.get("period_end", "")), default={}
    )
    adjusted_prices = derive_dividend_adjusted_prices(prices, dividends)
    latest_adjusted_price = max(
        adjusted_prices, key=lambda row: str(row.get("date", "")), default={}
    )
    shares_field = next(
        (
            field
            for field in ("weighted_shares_outstanding", "share_class_shares_outstanding")
            if _has(overview, field)
        ),
        "",
    )
    error_message = "; ".join(f"{name}: {message}" for name, message in errors.items())
    return {
        "ticker": ticker,
        "quarterly_rows": len(balance_rows),
        "latest_period_end": latest.get("period_end", ""),
        "latest_filing_date": latest.get("filing_date", ""),
        "has_total_assets": _has(balance, "total_assets"),
        "has_total_liabilities": _has(balance, "total_liabilities"),
        "has_current_liabilities": _has(balance, "total_current_liabilities"),
        "has_debt_current": _has(balance, "debt_current"),
        "has_long_term_debt": _has(balance, "long_term_debt_and_capital_lease_obligations"),
        "has_direct_total_debt": _has(balance, "total_debt"),
        "has_computable_total_debt": _has(balance, "debt_current")
        and _has(balance, "long_term_debt_and_capital_lease_obligations"),
        "derived_total_debt_rows": len(usable_debt_rows),
        "latest_derived_total_debt": latest_debt.get("derived_total_debt", ""),
        "has_cash_and_equivalents": _has(balance, "cash_and_equivalents"),
        "has_stockholders_equity": _has(balance, "total_equity_attributable_to_parent")
        or _has(balance, "total_equity"),
        "daily_price_rows": len(_rows(prices)),
        "price_split_adjusted": bool(prices.get("adjusted")) if isinstance(prices, dict) else False,
        "has_direct_adjusted_close": _has(prices, "adjusted_close") or _has(prices, "adjClose"),
        "derived_adjusted_price_rows": len(adjusted_prices),
        "latest_dividend_adjusted_close": latest_adjusted_price.get(
            "dividend_adjusted_close", ""
        ),
        "dividend_rows": len(_rows(dividends)),
        "has_dividend_adjustment_factor": _has(dividends, "historical_adjustment_factor"),
        "has_shares_outstanding": bool(shares_field),
        "shares_outstanding_field": shares_field,
        "error_message": error_message,
    }


def fetch_ticker(
    ticker: str, client: MassiveClient, start_date: str, end_date: str
) -> tuple[dict[str, Any], dict[str, Any]]:
    requests = endpoint_paths(ticker, start_date, end_date)
    payloads: dict[str, Any] = {}
    errors: dict[str, str] = {}
    for name, (endpoint, params) in requests.items():
        try:
            payloads[name] = client.get(endpoint, params)
        except Exception as exc:  # Each endpoint and ticker must fail independently.
            errors[name] = " ".join(str(exc).split())
            payloads[name] = {}

    summary = build_summary(ticker, payloads, errors)
    derived_total_debt = derive_total_debt(payloads.get("balance_sheet", {}))
    derived_adjusted_prices = derive_dividend_adjusted_prices(
        payloads.get("prices", {}), payloads.get("dividends", {})
    )
    latest = max(
        _rows(payloads.get("balance_sheet", {})),
        key=lambda row: str(row.get("period_end", "")),
        default={},
    )
    raw = {
        "ticker": ticker,
        "requested_date_range": {"from": start_date, "to": end_date},
        "requests": {
            name: {"endpoint": endpoint, "params": params}
            for name, (endpoint, params) in requests.items()
        },
        "responses": payloads,
        "errors": errors,
        "derived": {
            "quarterly_total_debt": derived_total_debt,
            "daily_dividend_adjusted_prices": derived_adjusted_prices,
        },
        "latest_balance_sheet_field_presence": {
            field: _present(latest, field) for field in BALANCE_FIELDS
        },
        "notes": {
            "total_debt": "No documented direct field; computable only when both debt components exist.",
            "price_adjustment": "Aggregate adjusted=true means split-adjusted, not dividend-adjusted.",
        },
    }
    return summary, raw


def write_outputs(
    output_dir: Path,
    summaries: list[dict[str, Any]],
    raw_samples: dict[str, dict[str, Any]],
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    raw_dir = output_dir / "massive_api_raw_samples"
    raw_dir.mkdir(parents=True, exist_ok=True)
    with (output_dir / "massive_api_test_summary.csv").open(
        "w", newline="", encoding="utf-8"
    ) as handle:
        writer = csv.DictWriter(handle, fieldnames=SUMMARY_FIELDS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(summaries)
    for ticker, sample in raw_samples.items():
        with (raw_dir / f"{ticker}.json").open("w", encoding="utf-8") as handle:
            json.dump(sample, handle, indent=2, ensure_ascii=False)
            handle.write("\n")


def _print_summary(summary: dict[str, Any]) -> None:
    print("\t".join(str(summary.get(field, "")).replace("\t", " ") for field in SUMMARY_FIELDS))


def print_conclusion(summaries: list[dict[str, Any]], raw_samples: dict[str, dict[str, Any]]) -> None:
    total = len(summaries)
    endpoints = ("balance_sheet", "prices", "dividends", "ticker_overview")
    successes = {
        endpoint: sum(endpoint not in raw["errors"] for raw in raw_samples.values())
        for endpoint in endpoints
    }
    print("\nConclusion")
    print(f"{total} tickers tested")
    print("Endpoint successes: " + ", ".join(f"{name} {count}/{total}" for name, count in successes.items()))
    print(f"{sum(row['quarterly_rows'] >= 8 for row in summaries)}/{total} returned 8 quarterly rows")
    print(f"{sum(bool(row['has_computable_total_debt']) for row in summaries)}/{total} have both debt components")
    print(f"{sum(bool(row['daily_price_rows']) for row in summaries)}/{total} have daily prices")
    print(f"{sum(bool(row['has_shares_outstanding']) for row in summaries)}/{total} have latest shares outstanding")
    print(f"{sum(bool(row['has_direct_adjusted_close']) for row in summaries)}/{total} have a direct dividend-adjusted-close field")
    print(f"{sum(bool(row['derived_adjusted_price_rows']) for row in summaries)}/{total} have derived dividend-adjusted prices")
    pnc = next((row for row in summaries if row["ticker"] == "PNC"), None)
    if pnc and pnc["quarterly_rows"]:
        print(
            "PNC debt fields: "
            f"current={pnc['has_debt_current']}, long_term={pnc['has_long_term_debt']}"
        )
    else:
        print("PNC financial field structure could not be tested")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=Path.cwd())
    parser.add_argument("--days", type=int, default=183)
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--min-interval", type=float, default=12.5)
    parser.add_argument("--tickers", nargs="*", default=TICKERS)
    args = parser.parse_args(argv)

    api_key = os.environ.get("MASSIVE_API_KEY", "").strip()
    if not api_key:
        print("MASSIVE_API_KEY is not set", file=sys.stderr)
        return 2
    end = date.today()
    start = end - timedelta(days=args.days)
    client = MassiveClient(api_key, timeout=args.timeout, min_interval=args.min_interval)
    summaries: list[dict[str, Any]] = []
    raw_samples: dict[str, dict[str, Any]] = {}
    print("\t".join(SUMMARY_FIELDS))
    for ticker in args.tickers:
        summary, raw = fetch_ticker(ticker, client, start.isoformat(), end.isoformat())
        summaries.append(summary)
        raw_samples[ticker] = raw
        _print_summary(summary)
    write_outputs(args.output_dir, summaries, raw_samples)
    print_conclusion(summaries, raw_samples)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
