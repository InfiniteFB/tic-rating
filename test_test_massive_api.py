import csv
from datetime import datetime, timezone
import json
import tempfile
import unittest
from pathlib import Path

import test_massive_api as massive


class FakeClient:
    def __init__(self, responses=None, failures=None):
        self.responses = responses or {}
        self.failures = failures or {}
        self.calls = []

    def get(self, endpoint, params):
        self.calls.append((endpoint, params))
        if endpoint in self.failures:
            raise RuntimeError(self.failures[endpoint])
        return self.responses.get(endpoint, {})


class MassiveApiSmokeTestTests(unittest.TestCase):
    def test_total_debt_is_derived_only_when_both_components_are_present(self):
        balance_sheet = {
            "results": [
                {
                    "period_end": "2026-03-31",
                    "debt_current": 5,
                    "long_term_debt_and_capital_lease_obligations": 25,
                },
                {"period_end": "2025-12-31", "debt_current": 4},
            ]
        }

        derived = massive.derive_total_debt(balance_sheet)

        self.assertEqual(derived[0]["derived_total_debt"], 30)
        self.assertIsNone(derived[1]["derived_total_debt"])

    def test_dividend_adjustment_uses_first_future_cumulative_factor(self):
        def timestamp(day):
            return int(datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp() * 1000)

        prices = {
            "adjusted": True,
            "results": [
                {"t": timestamp("2026-01-01"), "c": 100.0},
                {"t": timestamp("2026-02-01"), "c": 100.0},
                {"t": timestamp("2026-06-01"), "c": 100.0},
            ],
        }
        dividends = {
            "results": [
                {"ex_dividend_date": "2026-05-01", "historical_adjustment_factor": 0.998551},
                {"ex_dividend_date": "2026-01-30", "historical_adjustment_factor": 0.997189},
            ]
        }

        derived = massive.derive_dividend_adjusted_prices(prices, dividends)

        self.assertEqual([row["dividend_adjustment_factor"] for row in derived], [0.997189, 0.998551, 1.0])
        self.assertAlmostEqual(derived[0]["dividend_adjusted_close"], 99.7189)
        self.assertAlmostEqual(derived[1]["dividend_adjusted_close"], 99.8551)
        self.assertAlmostEqual(derived[2]["dividend_adjusted_close"], 100.0)

    def test_delayed_status_with_results_is_a_valid_free_tier_response(self):
        payload = {"status": "DELAYED", "adjusted": True, "results": [{"c": 10.0}]}

        self.assertEqual(massive._payload_error(payload), "")

    def test_summary_detects_massive_fields_without_claiming_direct_total_debt(self):
        payloads = {
            "balance_sheet": {
                "results": [
                    {
                        "period_end": "2026-03-31",
                        "filing_date": "2026-05-01",
                        "total_assets": 100,
                        "total_liabilities": 70,
                        "total_current_liabilities": 20,
                        "debt_current": 5,
                        "long_term_debt_and_capital_lease_obligations": 25,
                        "cash_and_equivalents": 10,
                        "total_equity_attributable_to_parent": 30,
                    }
                ]
            },
            "prices": {"adjusted": True, "results": [{"t": 1, "c": 10.0}]},
            "dividends": {
                "results": [
                    {
                        "ex_dividend_date": "2026-02-01",
                        "cash_amount": 0.5,
                        "historical_adjustment_factor": 0.99,
                    }
                ]
            },
            "ticker_overview": {
                "results": {"ticker": "TEST", "weighted_shares_outstanding": 1000}
            },
        }

        summary = massive.build_summary("TEST", payloads, {})

        self.assertEqual(summary["quarterly_rows"], 1)
        self.assertTrue(summary["has_debt_current"])
        self.assertTrue(summary["has_long_term_debt"])
        self.assertFalse(summary["has_direct_total_debt"])
        self.assertTrue(summary["has_computable_total_debt"])
        self.assertTrue(summary["price_split_adjusted"])
        self.assertFalse(summary["has_direct_adjusted_close"])
        self.assertTrue(summary["has_dividend_adjustment_factor"])
        self.assertTrue(summary["has_shares_outstanding"])
        self.assertEqual(summary["derived_total_debt_rows"], 1)
        self.assertEqual(summary["latest_derived_total_debt"], 30)
        self.assertEqual(summary["derived_adjusted_price_rows"], 1)

    def test_failed_financials_do_not_stop_other_endpoint_calls(self):
        endpoints = massive.endpoint_paths("TEST", "2026-01-01", "2026-06-30")
        balance_path = endpoints["balance_sheet"][0]
        client = FakeClient(
            responses={
                endpoints["prices"][0]: {"adjusted": True, "results": [{"c": 1}]},
                endpoints["dividends"][0]: {"results": []},
                endpoints["ticker_overview"][0]: {
                    "results": {"weighted_shares_outstanding": 10}
                },
            },
            failures={balance_path: "NOT_AUTHORIZED"},
        )

        summary, raw = massive.fetch_ticker(
            "TEST", client, "2026-01-01", "2026-06-30"
        )

        self.assertEqual(len(client.calls), 4)
        self.assertEqual(summary["daily_price_rows"], 1)
        self.assertTrue(summary["has_shares_outstanding"])
        self.assertIn("balance_sheet: NOT_AUTHORIZED", summary["error_message"])
        self.assertIn("balance_sheet", raw["errors"])
        self.assertNotIn("apikey", json.dumps(raw).lower())

    def test_write_outputs_creates_expected_csv_and_raw_json(self):
        summary = {field: "" for field in massive.SUMMARY_FIELDS}
        summary["ticker"] = "TEST"
        raw = {"ticker": "TEST", "responses": {}, "errors": {}}

        with tempfile.TemporaryDirectory() as temp_dir:
            massive.write_outputs(Path(temp_dir), [summary], {"TEST": raw})
            csv_path = Path(temp_dir) / "massive_api_test_summary.csv"
            json_path = Path(temp_dir) / "massive_api_raw_samples" / "TEST.json"
            self.assertTrue(csv_path.exists())
            self.assertTrue(json_path.exists())
            with csv_path.open(newline="", encoding="utf-8") as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual(rows[0]["ticker"], "TEST")


if __name__ == "__main__":
    unittest.main()
