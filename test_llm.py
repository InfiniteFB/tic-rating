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


def test_split_sections_case_insensitive_headings():
    text = "### caliber explanation\nDD is the caliber.\n### result analysis\nKO safe."
    caliber, result = llm._split_sections(text)
    assert caliber == "DD is the caliber."
    assert result == "KO safe."


def test_split_sections_only_result_heading():
    text = "### RESULT ANALYSIS\nOnly the analysis is here."
    caliber, result = llm._split_sections(text)
    assert caliber == ""
    assert result == "Only the analysis is here."


def test_split_sections_only_caliber_heading():
    text = "### CALIBER EXPLANATION\nOnly the caliber is here."
    caliber, result = llm._split_sections(text)
    assert caliber == "Only the caliber is here."
    assert result == ""


def test_split_sections_reversed_order():
    text = ("### RESULT ANALYSIS\nKO is safe.\n"
            "### CALIBER EXPLANATION\nDD measures distance.")
    caliber, result = llm._split_sections(text)
    assert caliber == "DD measures distance."
    assert result == "KO is safe."


def test_split_sections_ignores_unrelated_hashes():
    text = ("### CALIBER EXPLANATION\nDD explained.\n### Note: read carefully.\n"
            "### RESULT ANALYSIS\nKO analysis here.")
    caliber, result = llm._split_sections(text)
    # The unrelated "### Note" heading must not split content or get dropped;
    # it stays attached to the caliber section it appears within.
    assert "DD explained." in caliber
    assert "### Note: read carefully." in caliber
    assert result == "KO analysis here."


def test_split_sections_no_headings_all_to_result():
    text = "Just some free-form narration with no headings at all."
    caliber, result = llm._split_sections(text)
    assert caliber == ""
    assert result == "Just some free-form narration with no headings at all."
