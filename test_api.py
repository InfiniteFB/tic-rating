import json
import os
from pathlib import Path
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from app.main import app, load_dotenv

client = TestClient(app)


def _fake_fetch(name):
    def _inner(tickers, **kw):
        return {tickers[0]: json.loads(Path(f"massive_api_raw_samples/{name}.json").read_text())}
    return _inner


def test_health_ok():
    fake_client = MagicMock()
    fake_client.messages.create.side_effect = Exception("no endpoint")
    with patch("app.llm._provider", return_value="anthropic"), \
         patch("app.llm._get_client", return_value=fake_client):
        r = client.get("/api/health")
    assert r.status_code == 200
    assert "massive_key" in r.json() and "llm" in r.json()


def test_rate_happy_path():
    with patch("app.pipeline.fetch_all", _fake_fetch("KO")):
        r = client.post("/api/rate", json={"ticker": "KO"})
    assert r.status_code == 200
    body = r.json()
    assert body["result"]["sp_letter"]
    assert body["intermediate"]["day_inputs"]


def _fake_fetch_no_liabilities(name):
    """Sample with every balance-sheet liability field stripped -> unrateable
    under both the total_liabilities default and the strict kmv basis."""
    def _inner(tickers, **kw):
        sample = json.loads(Path(f"massive_api_raw_samples/{name}.json").read_text())
        for row in sample["responses"]["balance_sheet"].get("results", []):
            row.pop("total_liabilities", None)
            row.pop("debt_current", None)
            row.pop("long_term_debt_and_capital_lease_obligations", None)
        return {tickers[0]: sample}
    return _inner


def test_rate_unrateable_is_200_with_reason():
    with patch("app.pipeline.fetch_all", _fake_fetch_no_liabilities("COST")):
        r = client.post("/api/rate", json={"ticker": "COST", "st_debt_fallback": "strict"})
    assert r.status_code == 200
    assert r.json()["result"]["unrateable_reason"]


def test_rate_not_found_returns_4xx_json():
    def _empty(tickers, **kw): return {tickers[0]: {}}
    with patch("app.pipeline.fetch_all", _empty):
        r = client.post("/api/rate", json={"ticker": "ZZZZ"})
    assert r.status_code == 404
    assert "detail" in r.json() or "error" in r.json()


def test_unexpected_error_becomes_500_json_not_html():
    # Deeper than the fetch layer: fetch failures now fall back to the local
    # archive, so exercise the global handler via the rating step instead.
    with patch("app.main.pipeline.rate_ticker", side_effect=RuntimeError("boom")):
        r = client.post("/api/rate", json={"ticker": "KO"})
    assert r.status_code == 500
    assert r.headers["content-type"].startswith("application/json")
    assert "error" in r.json()


def test_fetch_failure_falls_back_to_cached_sample():
    # Expired API key / network down -> newest local archive keeps KO rateable.
    with patch("app.pipeline.fetch_all", side_effect=RuntimeError("key expired")):
        r = client.post("/api/rate", json={"ticker": "KO"})
    assert r.status_code == 200
    body = r.json()
    assert body["result"]["sp_letter"]
    assert any("cached sample" in w for w in body["meta"]["warnings"])


def test_fetch_failure_without_archive_is_404():
    with patch("app.pipeline.fetch_all", side_effect=RuntimeError("key expired")):
        r = client.post("/api/rate", json={"ticker": "ZZZZ"})
    assert r.status_code == 404


def test_explain_endpoint_degrades():
    fake_client = MagicMock()
    fake_client.messages.create.side_effect = Exception("no endpoint")
    with patch("app.llm._provider", return_value="anthropic"), \
         patch("app.llm._get_client", return_value=fake_client):
        r = client.post("/api/explain", json={"ticker": "KO", "result": {"sp_letter": "AAA"},
                                              "intermediate": {"metrics": {}}})
    assert r.status_code == 200
    assert r.json()["error"]


def test_index_served():
    r = client.get("/")
    assert r.status_code == 200 and "text/html" in r.headers["content-type"]


def test_load_dotenv_handles_utf8_bom(tmp_path):
    env_file = tmp_path / ".env"
    # Write with a UTF-8 BOM prefix so the first key would be corrupted
    # (﻿FOO_BOMTEST) if the loader read it as plain utf-8.
    env_file.write_text("﻿FOO_BOMTEST=bar\n", encoding="utf-8")
    try:
        load_dotenv(env_file)
        assert os.environ.get("FOO_BOMTEST") == "bar"
    finally:
        os.environ.pop("FOO_BOMTEST", None)
