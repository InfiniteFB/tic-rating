import csv
import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path

import test_fmp_api as fmp


class FakeClient:
    def __init__(self, responses=None, failures=None):
        self.responses = responses or {}
        self.failures = failures or {}
        self.calls = []

    def get(self, endpoint, params):
        self.calls.append((endpoint, params))
        if endpoint in self.failures:
            raise RuntimeError(self.failures[endpoint])
        return self.responses.get(endpoint, [])


class LimitAwareClient(FakeClient):
    def get(self, endpoint, params):
        self.calls.append((endpoint, params))
        if endpoint == "balance-sheet-statement" and params["limit"] == 8:
            raise RuntimeError("The values for 'limit' must be between 0 and 5")
        if endpoint == "balance-sheet-statement":
            return [{"date": "2026-03-31", "totalDebt": 10}]
        return self.responses.get(endpoint, [])


class FmpApiTestScriptTests(unittest.TestCase):
    def test_build_summary_uses_latest_quarter_and_detects_requested_fields(self):
        payloads = {
            "balance_sheet": [
                {
                    "date": "2026-03-31",
                    "reportedDate": "2026-05-01",
                    "totalDebt": 10,
                    "shortTermDebt": 2,
                    "longTermDebt": 8,
                    "numberOfShares": 100,
                },
                {"date": "2025-12-31"},
            ],
            "prices": [{"date": "2026-06-26", "close": 50.0}],
            "dividends": [{"date": "2026-05-01", "dividend": 0.5}],
            "profile": [],
            "shares_float": [],
        }

        summary = fmp.build_summary("TEST", payloads, {})

        self.assertEqual(summary["quarterly_rows"], 2)
        self.assertEqual(summary["latest_fiscal_date"], "2026-03-31")
        self.assertEqual(summary["latest_reported_date"], "2026-05-01")
        self.assertTrue(summary["has_total_debt"])
        self.assertTrue(summary["has_short_term_debt"])
        self.assertTrue(summary["has_long_term_debt"])
        self.assertTrue(summary["has_shares_outstanding"])
        self.assertEqual(summary["daily_price_rows"], 1)
        self.assertTrue(summary["has_adjusted_close"])
        self.assertEqual(summary["dividend_rows"], 1)
        self.assertEqual(summary["error_message"], "")

    def test_one_endpoint_failure_is_recorded_and_other_endpoints_continue(self):
        client = FakeClient(
            responses={
                "historical-price-eod/dividend-adjusted": [{"date": "2026-01-02", "close": 1}],
                "dividends": [],
                "profile": [{"symbol": "TEST"}],
                "shares-float": [{"outstandingShares": 12}],
            },
            failures={"balance-sheet-statement": "plan does not allow this endpoint"},
        )

        summary, raw = fmp.fetch_ticker(
            "TEST", client, start_date="2024-06-28", end_date="2026-06-28"
        )

        self.assertEqual(len(client.calls), 5)
        self.assertIn("balance_sheet: plan does not allow this endpoint", summary["error_message"])
        self.assertEqual(summary["daily_price_rows"], 1)
        self.assertTrue(summary["has_shares_outstanding"])
        self.assertIn("balance_sheet", raw["errors"])
        self.assertNotIn("apikey", json.dumps(raw).lower())

    def test_balance_limit_subscription_error_retries_with_five_and_keeps_warning(self):
        client = LimitAwareClient()

        summary, raw = fmp.fetch_ticker(
            "TEST", client, start_date="2024-06-28", end_date="2026-06-28"
        )

        balance_calls = [params for endpoint, params in client.calls if endpoint == "balance-sheet-statement"]
        self.assertEqual([call["limit"] for call in balance_calls], [8, 5])
        self.assertEqual(summary["quarterly_rows"], 1)
        self.assertTrue(summary["has_total_debt"])
        self.assertIn("8-quarter request unavailable", summary["error_message"])
        self.assertNotIn("balance_sheet", raw["errors"])
        self.assertIn("balance_sheet_limit", raw["warnings"])

    def test_summary_counts_only_rows_inside_requested_two_year_window(self):
        payloads = {
            "balance_sheet": [],
            "prices": [
                {"date": "2026-06-01", "close": 10},
                {"date": "2023-06-01", "close": 5},
            ],
            "dividends": [
                {"date": "2025-01-01", "dividend": 1},
                {"date": "2020-01-01", "dividend": 1},
            ],
            "profile": [],
            "shares_float": [],
        }

        summary = fmp.build_summary(
            "TEST", payloads, {}, start_date="2024-06-28", end_date="2026-06-28"
        )

        self.assertEqual(summary["daily_price_rows"], 1)
        self.assertEqual(summary["dividend_rows"], 1)

    def test_pnc_access_error_is_reported_as_unavailable_not_a_field_difference(self):
        raw_samples = {
            "COST": {
                "errors": {},
                "warnings": {},
                "latest_balance_sheet_critical_field_presence": {
                    field: True for field in fmp.CRITICAL_BALANCE_FIELDS
                },
            },
            "PNC": {
                "errors": {"balance_sheet": "HTTP 402 subscription restriction"},
                "warnings": {},
                "latest_balance_sheet_critical_field_presence": {
                    field: False for field in fmp.CRITICAL_BALANCE_FIELDS
                },
            },
        }
        summaries = [
            {
                "ticker": ticker,
                "quarterly_rows": 1 if ticker == "COST" else 0,
                "has_total_debt": ticker == "COST",
                "has_short_term_debt": ticker == "COST",
                "has_long_term_debt": ticker == "COST",
                "has_shares_outstanding": True,
                "has_adjusted_close": ticker == "COST",
            }
            for ticker in ("COST", "PNC")
        ]

        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            fmp.print_conclusion(summaries, raw_samples)

        self.assertIn("PNC field structure cannot be compared", output.getvalue())
        self.assertNotIn("PNC requires special handling", output.getvalue())

    def test_write_outputs_creates_csv_and_one_raw_json_per_ticker(self):
        summary = {field: "" for field in fmp.SUMMARY_FIELDS}
        summary.update({"ticker": "TEST", "quarterly_rows": 0})
        raw = {"ticker": "TEST", "responses": {}, "errors": {}}

        with tempfile.TemporaryDirectory() as temp_dir:
            fmp.write_outputs(Path(temp_dir), [summary], {"TEST": raw})

            csv_path = Path(temp_dir) / "fmp_api_test_summary.csv"
            raw_path = Path(temp_dir) / "fmp_api_raw_samples" / "TEST.json"
            self.assertTrue(csv_path.exists())
            self.assertTrue(raw_path.exists())
            with csv_path.open(newline="", encoding="utf-8") as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual(rows[0]["ticker"], "TEST")


if __name__ == "__main__":
    unittest.main()
