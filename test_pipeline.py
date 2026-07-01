import json
from pathlib import Path
import rating_inputs, kmv_engine, ttc_conversion
from app import serialize

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
