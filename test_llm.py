from types import SimpleNamespace
from unittest.mock import patch, MagicMock
from app import llm


def _fake_msg(text):
    return SimpleNamespace(content=[SimpleNamespace(type="text", text=text)])


def test_build_prompt_includes_values():
    payload = {"ticker": "KO",
               "result": {"sp_letter": "AAA", "sp_ttc_pd": 0.0002, "credit_outlook": -0.0001},
               "intermediate": {"metrics": {"dd": 8.1, "pit_pd": 1e-9, "pd_fh": 2e-9,
                                            "tic": 0.01, "risk_score": 1.0, "ccm": 0.5, "mu": 20.0}}}
    system, user = llm.build_prompt(payload)
    text = system + " " + user
    assert "KO" in text and "AAA" in text
    assert "TiC" in text and "8.1" in text
    assert "distance-to-default" in text.lower() or "DD" in text


def test_explain_splits_two_sections_on_success():
    body = "### CALIBER EXPLANATION\nDD measures ...\n### RESULT ANALYSIS\nKO looks safe."
    fake_client = MagicMock()
    fake_client.messages.create.return_value = _fake_msg(body)
    with patch("app.llm._get_client", return_value=fake_client):
        out = llm.explain({"ticker": "KO", "result": {"sp_letter": "AAA"},
                           "intermediate": {"metrics": {}}})
    assert out["error"] is None
    assert "DD measures" in out["caliber_explanation"]
    assert "KO looks safe" in out["result_analysis"]


def test_explain_degrades_on_error():
    fake_client = MagicMock()
    fake_client.messages.create.side_effect = Exception("connection refused")
    with patch("app.llm._get_client", return_value=fake_client):
        out = llm.explain({"ticker": "KO", "result": {"sp_letter": "AAA"},
                           "intermediate": {"metrics": {}}})
    assert out["error"]
    assert out["caliber_explanation"] == "" and out["result_analysis"] == ""


def test_health_probe_returns_bool():
    fake_client = MagicMock()
    fake_client.messages.create.side_effect = Exception("no route")
    with patch("app.llm._get_client", return_value=fake_client):
        h = llm.health()
    assert h["reachable"] is False and h["detail"]
