import json
from pathlib import Path
from unittest.mock import patch
import rating_inputs, kmv_engine, ttc_conversion
from app import serialize
from app import pipeline

SAMPLE = Path("massive_api_raw_samples/KO.json")

def _rate_ko():
    sample = json.loads(SAMPLE.read_text())
    bundle = rating_inputs.build_inputs(sample, rate=0.045, horizon_days=365.0, st_debt_fallback="strict")
    result = kmv_engine.rate_company(bundle.days)
    sp = ttc_conversion.convert_fh_to_sp(result.ccm, result.mu, result.pd_fh)
    return sample, bundle, result, sp

def test_source_dict_has_expected_sections():
    sample, *_ = _rate_ko()
    src = serialize.source_dict(sample)
    assert "shares_outstanding" in src
    assert isinstance(src["prices"], list) and src["prices"]
    assert "risk_free_rate_1y_series" in src
    assert "balance_sheet" in src

def test_intermediate_dict_exposes_day_inputs_and_em():
    _, bundle, result, _ = _rate_ko()
    inter = serialize.intermediate_dict(bundle, result)
    row = inter["day_inputs"][0]
    assert {"date", "equity", "debt", "rate", "tau"} <= set(row)
    assert inter["em"]["iterations"] >= 1
    assert len(inter["em"]["sigma_history"]) >= 1
    assert len(inter["assets"]) == len(bundle.days)
    for k in ("dd", "pit_pd", "pd_fh", "tic", "risk_score", "ccm", "mu"):
        assert k in inter["metrics"]

def test_result_dict_carries_sp_conversion():
    *_, result, sp = _rate_ko()
    out = serialize.result_dict(result, sp)
    assert out["sp_letter"] == sp["sp_letter"]
    assert "credit_outlook" in out
    assert out["unrateable_reason"] is None
    assert out["compute_error"] is None

def test_json_serializable():
    sample, bundle, result, sp = _rate_ko()
    payload = {
        "source": serialize.source_dict(sample),
        "intermediate": serialize.intermediate_dict(bundle, result),
        "result": serialize.result_dict(result, sp),
    }
    json.dumps(payload)  # must not raise

def test_no_infinity_or_nan_tokens_in_json():
    # inf/nan in raw inputs must not leak into the serialized JSON as the
    # illegal `Infinity` / `NaN` tokens that json.dumps emits by default.
    sample = json.loads(SAMPLE.read_text())
    sample.setdefault("derived", {}).setdefault("risk_free_rate_1y_series", [])
    sample["derived"]["risk_free_rate_1y_series"] = [
        {"date": "2025-05-27", "rate": float("inf")},
        {"date": "2025-05-28", "rate": float("nan")},
    ]
    sample["derived"].setdefault("sofr_series", [])
    sample["derived"]["sofr_series"] = [{"date": "2025-05-27", "rate": float("inf")}]
    src = serialize.source_dict(sample)
    assert src["risk_free_rate_1y_series"][0]["rate"] is None
    assert src["risk_free_rate_1y_series"][1]["rate"] is None
    assert src["sofr_series"][0]["rate"] is None
    text = json.dumps(src)
    assert "Infinity" not in text
    assert "NaN" not in text

def test_intermediate_dict_handles_none_result():
    _, bundle, *_ = _rate_ko()
    inter = serialize.intermediate_dict(bundle, None)
    assert inter["day_inputs"]
    assert inter["assets"] == []
    assert inter["em"] == {}
    assert inter["metrics"] == {}
    json.dumps(inter)

def test_result_dict_handles_none_result():
    out = serialize.result_dict(None, None, unrateable_reason="no shares outstanding")
    assert out["unrateable_reason"] == "no shares outstanding"
    assert out["sp_letter"] is None
    assert out["compute_error"] is None
    out2 = serialize.result_dict(None, None, compute_error="ValueError: boom")
    assert out2["compute_error"] == "ValueError: boom"
    assert out2["unrateable_reason"] is None
    json.dumps(out); json.dumps(out2)


def _fake_fetch_all(sample_name):
    def _inner(tickers, **kw):
        s = json.loads(Path(f"massive_api_raw_samples/{sample_name}.json").read_text())
        return {tickers[0]: s}
    return _inner

def test_rate_ticker_happy_path():
    with patch("app.pipeline.fetch_all", _fake_fetch_all("KO")):
        out = pipeline.rate_ticker("KO", days=400, st_debt_fallback="strict",
                                   horizon_days=365.0, fallback_rate=0.045)
    assert out["result"]["sp_letter"]
    assert out["result"]["unrateable_reason"] is None
    assert out["intermediate"]["em"]["iterations"] >= 1

def test_rate_ticker_unrateable_returns_reason_not_crash():
    with patch("app.pipeline.fetch_all", _fake_fetch_all("COST")):
        out = pipeline.rate_ticker("COST", days=400, st_debt_fallback="strict",
                                   horizon_days=365.0, fallback_rate=0.045)
    assert out["result"]["unrateable_reason"]
    assert out["result"]["sp_letter"] is None
    assert out["source"]

def test_rate_ticker_caliber_switch_makes_cost_rateable():
    with patch("app.pipeline.fetch_all", _fake_fetch_all("COST")):
        out = pipeline.rate_ticker("COST", days=400, st_debt_fallback="zero",
                                   horizon_days=365.0, fallback_rate=0.045)
    assert out["result"]["unrateable_reason"] is None
    assert out["result"]["sp_letter"]

def test_rate_ticker_empty_prices_flagged_ratelimit():
    calls = {"n": 0}
    def _empty(tickers, **kw):
        calls["n"] += 1
        s = json.loads(Path("massive_api_raw_samples/KO.json").read_text())
        s["derived"]["daily_dividend_adjusted_prices"] = []
        return {tickers[0]: s}
    with patch("app.pipeline.time.sleep"), patch("app.pipeline.fetch_all", _empty):
        out = pipeline.rate_ticker("KO", days=400, st_debt_fallback="strict",
                                   horizon_days=365.0, fallback_rate=0.045)
    assert calls["n"] == 2
    assert any("rate" in w.lower() for w in out["meta"]["warnings"])

def test_rate_ticker_not_found_raises():
    def _empty(tickers, **kw): return {tickers[0]: {}}
    with patch("app.pipeline.fetch_all", _empty):
        try:
            pipeline.rate_ticker("ZZZZ", days=400, st_debt_fallback="strict",
                                 horizon_days=365.0, fallback_rate=0.045)
            assert False, "expected NotFound"
        except pipeline.NotFound:
            pass

def test_rate_ticker_compute_error_returns_partial():
    with patch("app.pipeline.fetch_all", _fake_fetch_all("KO")), \
         patch("app.pipeline.kmv_engine.rate_company", side_effect=RuntimeError("boom")):
        out = pipeline.rate_ticker("KO", days=400, st_debt_fallback="strict",
                                   horizon_days=365.0, fallback_rate=0.045)
    assert out["result"]["compute_error"] and "boom" in out["result"]["compute_error"]
    assert out["result"]["partial"] is True
    assert out["result"]["unrateable_reason"] is None
    assert out["intermediate"]["day_inputs"]        # inputs still shown
    json.dumps(out)                                 # still JSON-safe
