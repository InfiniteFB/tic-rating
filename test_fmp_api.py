#!/usr/bin/env python3
"""Minimal FMP coverage test for the ten PFPA companies."""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from collections import Counter
from datetime import date
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


TICKERS = ["COST", "KO", "DELL", "ORCL", "PNC", "WMT", "INTU", "AMZN", "T", "KHC"]
BASE_URL = "https://financialmodelingprep.com/stable"
CRITICAL_BALANCE_FIELDS = [
    "date",
    "reportedDate",
    "totalAssets",
    "totalLiabilities",
    "currentLiabilities",
    "shortTermDebt",
    "longTermDebt",
    "totalDebt",
    "cashAndCashEquivalents",
    "totalStockholdersEquity",
    "numberOfShares",
]
SUMMARY_FIELDS = [
    "ticker",
    "quarterly_rows",
    "latest_fiscal_date",
    "latest_reported_date",
    "has_total_debt",
    "has_short_term_debt",
    "has_long_term_debt",
    "has_shares_outstanding",
    "daily_price_rows",
    "has_adjusted_close",
    "dividend_rows",
    "error_message",
]

ENDPOINTS = {
    "balance_sheet": "balance-sheet-statement",
    "prices": "historical-price-eod/dividend-adjusted",
    "dividends": "dividends",
    "profile": "profile",
    "shares_float": "shares-float",
}


class FmpApiError(RuntimeError):
    pass


class FmpClient:
    def __init__(self, api_key: str, timeout: float = 30.0):
        self.api_key = api_key
        self.timeout = timeout

    def get(self, endpoint: str, params: dict[str, Any]) -> Any:
        query = urlencode({**params, "apikey": self.api_key})
        request = Request(
            f"{BASE_URL}/{endpoint}?{query}",
            headers={"Accept": "application/json", "User-Agent": "pfpa-fmp-smoke-test/1.0"},
        )
        try:
            with urlopen(request, timeout=self.timeout) as response:
                body = response.read().decode("utf-8")
        except HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise FmpApiError(f"HTTP {exc.code}: {_error_text(body)}") from exc
        except (URLError, TimeoutError) as exc:
            raise FmpApiError(str(exc.reason if isinstance(exc, URLError) else exc)) from exc

        try:
            payload = json.loads(body)
        except json.JSONDecodeError as exc:
            raise FmpApiError(f"invalid JSON response: {exc}") from exc

        message = _payload_error(payload)
        if message:
            raise FmpApiError(message)
        return payload


def _error_text(body: str) -> str:
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return " ".join(body.split())[:300] or "empty response"
    return _payload_error(payload) or str(payload)[:300]


def _payload_error(payload: Any) -> str:
    if not isinstance(payload, dict):
        return ""
    for key in ("Error Message", "error", "message"):
        value = payload.get(key)
        if value:
            return str(value)
    return ""


def _rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if isinstance(payload, dict):
        for key in ("historical", "data"):
            nested = payload.get(key)
            if isinstance(nested, list):
                return [row for row in nested if isinstance(row, dict)]
        if payload and not _payload_error(payload):
            return [payload]
    return []


def _present(row: dict[str, Any], field: str) -> bool:
    return field in row and row[field] is not None and row[field] != ""


def _latest_balance_row(payload: Any) -> dict[str, Any]:
    rows = _rows(payload)
    return max(rows, key=lambda row: str(row.get("date", "")), default={})


def _has_any_field(payloads: list[Any], fields: tuple[str, ...]) -> bool:
    return any(_present(row, field) for payload in payloads for row in _rows(payload) for field in fields)


def _date_filtered_rows(payload: Any, start_date: str | None, end_date: str | None) -> list[dict[str, Any]]:
    rows = _rows(payload)
    if not start_date or not end_date:
        return rows
    return [row for row in rows if start_date <= str(row.get("date", "")) <= end_date]


def build_summary(
    ticker: str,
    payloads: dict[str, Any],
    errors: dict[str, str],
    warnings: dict[str, str] | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> dict[str, Any]:
    balance_rows = _rows(payloads.get("balance_sheet", []))
    price_rows = _date_filtered_rows(payloads.get("prices", []), start_date, end_date)
    dividend_rows = _date_filtered_rows(payloads.get("dividends", []), start_date, end_date)
    latest = _latest_balance_row(balance_rows)

    # The selected price endpoint is explicitly dividend-adjusted, so its `close`
    # is an adjusted close even when FMP does not name the field `adjClose`.
    has_adjusted_close = _has_any_field(
        [price_rows], ("adjClose", "adjustedClose", "close")
    )
    has_shares = _has_any_field(
        [
            balance_rows,
            payloads.get("profile", []),
            payloads.get("shares_float", []),
        ],
        ("numberOfShares", "sharesOutstanding", "outstandingShares"),
    )
    notices = {**errors, **(warnings or {})}
    error_message = "; ".join(f"{name}: {message}" for name, message in notices.items())

    return {
        "ticker": ticker,
        "quarterly_rows": len(balance_rows),
        "latest_fiscal_date": latest.get("date", ""),
        "latest_reported_date": latest.get("reportedDate", ""),
        "has_total_debt": _has_any_field([balance_rows], ("totalDebt",)),
        "has_short_term_debt": _has_any_field([balance_rows], ("shortTermDebt",)),
        "has_long_term_debt": _has_any_field([balance_rows], ("longTermDebt",)),
        "has_shares_outstanding": has_shares,
        "daily_price_rows": len(price_rows),
        "has_adjusted_close": has_adjusted_close,
        "dividend_rows": len(dividend_rows),
        "error_message": error_message,
    }


def _request_params(ticker: str, start_date: str, end_date: str) -> dict[str, dict[str, Any]]:
    return {
        "balance_sheet": {"symbol": ticker, "period": "quarter", "limit": 8},
        "prices": {"symbol": ticker, "from": start_date, "to": end_date},
        "dividends": {"symbol": ticker, "from": start_date, "to": end_date},
        "profile": {"symbol": ticker},
        "shares_float": {"symbol": ticker},
    }


def fetch_ticker(
    ticker: str, client: FmpClient, start_date: str, end_date: str
) -> tuple[dict[str, Any], dict[str, Any]]:
    params_by_name = _request_params(ticker, start_date, end_date)
    payloads: dict[str, Any] = {}
    errors: dict[str, str] = {}
    warnings: dict[str, str] = {}

    for name, endpoint in ENDPOINTS.items():
        try:
            payloads[name] = client.get(endpoint, params_by_name[name])
        except Exception as exc:  # One failed endpoint must not stop this ticker or the run.
            message = " ".join(str(exc).split())
            if name == "balance_sheet" and "limit" in message.lower() and "5" in message:
                fallback_params = {**params_by_name[name], "limit": 5}
                try:
                    payloads[name] = client.get(endpoint, fallback_params)
                    warnings["balance_sheet_limit"] = (
                        "8-quarter request unavailable under this subscription; fetched limit=5 for field inspection"
                    )
                except Exception as fallback_exc:
                    errors[name] = f"{message}; limit=5 retry: {' '.join(str(fallback_exc).split())}"
                    payloads[name] = []
            else:
                errors[name] = message
                payloads[name] = []

    summary = build_summary(
        ticker,
        payloads,
        errors,
        warnings=warnings,
        start_date=start_date,
        end_date=end_date,
    )
    latest = _latest_balance_row(payloads.get("balance_sheet", []))
    field_presence = {field: _present(latest, field) for field in CRITICAL_BALANCE_FIELDS}
    adjusted_close_field = next(
        (
            field
            for field in ("adjClose", "adjustedClose", "close")
            if _has_any_field([payloads.get("prices", [])], (field,))
        ),
        None,
    )
    raw = {
        "ticker": ticker,
        "requested_date_range": {"from": start_date, "to": end_date},
        "requests": {
            name: {"endpoint": f"/stable/{ENDPOINTS[name]}", "params": params}
            for name, params in params_by_name.items()
        },
        "responses": payloads,
        "errors": errors,
        "warnings": warnings,
        "latest_balance_sheet_critical_field_presence": field_presence,
        "adjusted_close_source_field": adjusted_close_field,
        "shares_outstanding_source_fields": sorted(
            {
                field
                for payload in (
                    payloads.get("balance_sheet", []),
                    payloads.get("profile", []),
                    payloads.get("shares_float", []),
                )
                for row in _rows(payload)
                for field in ("numberOfShares", "sharesOutstanding", "outstandingShares")
                if _present(row, field)
            }
        ),
    }
    return summary, raw


def write_outputs(
    output_dir: Path,
    summaries: list[dict[str, Any]],
    raw_samples: dict[str, dict[str, Any]],
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    raw_dir = output_dir / "fmp_api_raw_samples"
    raw_dir.mkdir(parents=True, exist_ok=True)

    with (output_dir / "fmp_api_test_summary.csv").open(
        "w", newline="", encoding="utf-8"
    ) as handle:
        writer = csv.DictWriter(handle, fieldnames=SUMMARY_FIELDS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(summaries)

    for ticker, sample in raw_samples.items():
        with (raw_dir / f"{ticker}.json").open("w", encoding="utf-8") as handle:
            json.dump(sample, handle, indent=2, ensure_ascii=False)
            handle.write("\n")


def _subtract_years(value: date, years: int) -> date:
    try:
        return value.replace(year=value.year - years)
    except ValueError:  # February 29
        return value.replace(year=value.year - years, day=28)


def _pnc_differs(raw_samples: dict[str, dict[str, Any]]) -> tuple[bool, list[str]]:
    presence_by_ticker = {
        ticker: sample["latest_balance_sheet_critical_field_presence"]
        for ticker, sample in raw_samples.items()
    }
    ordinary = [
        tuple(fields[field] for field in CRITICAL_BALANCE_FIELDS)
        for ticker, fields in presence_by_ticker.items()
        if ticker != "PNC"
    ]
    if "PNC" not in presence_by_ticker or not ordinary:
        return False, []
    common_signature = Counter(ordinary).most_common(1)[0][0]
    pnc_signature = tuple(presence_by_ticker["PNC"][field] for field in CRITICAL_BALANCE_FIELDS)
    differing_fields = [
        field
        for field, expected, actual in zip(CRITICAL_BALANCE_FIELDS, common_signature, pnc_signature)
        if expected != actual
    ]
    return bool(differing_fields), differing_fields


def print_conclusion(
    summaries: list[dict[str, Any]], raw_samples: dict[str, dict[str, Any]]
) -> None:
    total = len(summaries)
    usable_debt = sum(
        bool(row["has_total_debt"] or (row["has_short_term_debt"] and row["has_long_term_debt"]))
        for row in summaries
    )
    adjusted_prices = sum(bool(row["has_adjusted_close"]) for row in summaries)
    shares = sum(bool(row["has_shares_outstanding"]) for row in summaries)
    kmv_ready = sum(
        bool(
            row["has_adjusted_close"]
            and row["has_shares_outstanding"]
            and (row["has_total_debt"] or (row["has_short_term_debt"] and row["has_long_term_debt"]))
        )
        for row in summaries
    )
    endpoint_successes = {
        name: sum(name not in sample["errors"] for sample in raw_samples.values())
        for name in ENDPOINTS
    }
    missing_counts = Counter(
        field
        for sample in raw_samples.values()
        for field, present in sample["latest_balance_sheet_critical_field_presence"].items()
        if not present
    )
    pnc_special, pnc_fields = _pnc_differs(raw_samples)
    pnc_balance_unavailable = "balance_sheet" in raw_samples.get("PNC", {}).get("errors", {})
    eight_quarters = sum(
        row["quarterly_rows"] >= 8 and "balance_sheet_limit" not in raw_samples[row["ticker"]]["warnings"]
        for row in summaries
    )

    print("\nConclusion")
    print(f"{total} tickers tested")
    print(f"{eight_quarters}/{total} returned the requested 8 quarterly balance sheets")
    print(f"{usable_debt}/{total} have usable quarterly debt fields")
    print(f"{adjusted_prices}/{total} have daily adjusted prices")
    print(f"{shares}/{total} have usable shares outstanding")
    print(
        "Endpoint successes: "
        + ", ".join(f"{name} {count}/{total}" for name, count in endpoint_successes.items())
    )
    print(
        "Missing latest-quarter critical fields: "
        + (", ".join(f"{field}({count})" for field, count in missing_counts.items()) or "none")
    )
    if pnc_balance_unavailable:
        print("PNC field structure cannot be compared; balance-sheet access was blocked")
    elif pnc_special:
        print(f"PNC requires special handling; differing fields: {', '.join(pnc_fields)}")
    else:
        print("PNC does not show a distinct critical-field pattern in this sample")
    print(f"{kmv_ready}/{total} have the minimum price + shares + debt inputs for later KMV construction")


def _print_summary_header() -> None:
    print("\t".join(SUMMARY_FIELDS))


def _print_summary_row(summary: dict[str, Any]) -> None:
    values = [str(summary.get(field, "")).replace("\t", " ").replace("\n", " ") for field in SUMMARY_FIELDS]
    print("\t".join(values))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, default=Path.cwd())
    parser.add_argument("--timeout", type=float, default=30.0)
    args = parser.parse_args(argv)

    api_key = os.environ.get("FMP_API_KEY", "").strip()
    if not api_key:
        print("FMP_API_KEY is not set. Export it and rerun: python test_fmp_api.py", file=sys.stderr)
        return 2

    end = date.today()
    start = _subtract_years(end, 2)
    client = FmpClient(api_key, timeout=args.timeout)
    summaries: list[dict[str, Any]] = []
    raw_samples: dict[str, dict[str, Any]] = {}

    _print_summary_header()
    for ticker in TICKERS:
        summary, raw = fetch_ticker(ticker, client, start.isoformat(), end.isoformat())
        summaries.append(summary)
        raw_samples[ticker] = raw
        _print_summary_row(summary)

    write_outputs(args.output_dir, summaries, raw_samples)
    print_conclusion(summaries, raw_samples)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
