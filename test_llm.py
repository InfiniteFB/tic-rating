import os
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
    with patch("app.llm._provider", return_value="anthropic"), \
         patch("app.llm._get_client", return_value=fake_client):
        out = llm.explain({"ticker": "KO", "result": {"sp_letter": "AAA"},
                           "intermediate": {"metrics": {}}})
    assert out["error"] is None
    assert "DD measures" in out["caliber_explanation"]
    assert "KO looks safe" in out["result_analysis"]


def test_explain_degrades_on_error():
    fake_client = MagicMock()
    fake_client.messages.create.side_effect = Exception("connection refused")
    with patch("app.llm._provider", return_value="anthropic"), \
         patch("app.llm._get_client", return_value=fake_client):
        out = llm.explain({"ticker": "KO", "result": {"sp_letter": "AAA"},
                           "intermediate": {"metrics": {}}})
    assert out["error"]
    assert out["caliber_explanation"] == "" and out["result_analysis"] == ""


def test_health_probe_returns_bool():
    fake_client = MagicMock()
    fake_client.messages.create.side_effect = Exception("no route")
    with patch("app.llm._provider", return_value="anthropic"), \
         patch("app.llm._get_client", return_value=fake_client):
        h = llm.health()
    assert h["reachable"] is False and h["detail"]


def _fake_completion(text):
    return SimpleNamespace(
        choices=[SimpleNamespace(message=SimpleNamespace(content=text))])


def test_explain_openai_channel_success():
    body = "### CALIBER EXPLANATION\nDD measures ...\n### RESULT ANALYSIS\nKO looks safe."
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _fake_completion(body)
    with patch("app.llm._provider", return_value="openai"), \
         patch("app.llm._get_openai_client", return_value=fake_client):
        out = llm.explain({"ticker": "KO", "result": {"sp_letter": "AAA"},
                           "intermediate": {"metrics": {}}})
    assert out["error"] is None
    assert "DD measures" in out["caliber_explanation"]
    assert "KO looks safe" in out["result_analysis"]
    kwargs = fake_client.chat.completions.create.call_args.kwargs
    assert "max_completion_tokens" in kwargs and "max_tokens" not in kwargs


def test_explain_openai_channel_degrades_on_error():
    fake_client = MagicMock()
    fake_client.chat.completions.create.side_effect = Exception("quota exceeded")
    with patch("app.llm._provider", return_value="openai"), \
         patch("app.llm._get_openai_client", return_value=fake_client):
        out = llm.explain({"ticker": "KO", "result": {"sp_letter": "AAA"},
                           "intermediate": {"metrics": {}}})
    assert out["error"]
    assert out["caliber_explanation"] == "" and out["result_analysis"] == ""


def test_health_openai_channel():
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _fake_completion("pong")
    with patch("app.llm._provider", return_value="openai"), \
         patch("app.llm._get_openai_client", return_value=fake_client):
        h = llm.health()
    assert h["reachable"] is True


def test_unknown_provider_degrades_not_crashes():
    with patch("app.llm._provider", return_value="wat"):
        out = llm.explain({"ticker": "KO", "result": {}, "intermediate": {}})
        h = llm.health()
    assert "LLM_PROVIDER" in out["error"]
    assert h["reachable"] is False and "LLM_PROVIDER" in h["detail"]


def test_model_follows_provider():
    env = {"OPENAI_MODEL": "gpt-x", "LLM_MODEL": "mm-x", "DEEPSEEK_MODEL": "ds-x"}
    with patch.dict(os.environ, env):
        with patch("app.llm._provider", return_value="openai"):
            assert llm._model() == "gpt-x"
        with patch("app.llm._provider", return_value="anthropic"):
            assert llm._model() == "mm-x"
        with patch("app.llm._provider", return_value="deepseek"):
            assert llm._model() == "ds-x"


def test_channel_defaults_without_any_env():
    with patch.dict(os.environ, {}, clear=True):
        with patch("app.llm._provider", return_value="deepseek"):
            assert llm._model() == "deepseek-v4-flash"
            assert llm._reasoning_effort() == "none"
        with patch("app.llm._provider", return_value="openai"):
            assert llm._model() == "gpt-5.6-luna"
            assert llm._reasoning_effort() == "low"
        with patch("app.llm._provider", return_value="anthropic"):
            assert llm._model() == "MiniMax-M3"
            assert llm._reasoning_effort() is None


def test_reasoning_effort_none_is_sent_not_swallowed():
    """The regression: treating "none" as "send nothing" silently left
    DeepSeek v4 thinking -- 8354 reasoning tokens and 78s instead of 5."""
    fake_client = MagicMock()
    fake_client.chat.completions.create.return_value = _fake_completion("### RESULT ANALYSIS\nB.")
    with patch.dict(os.environ, {}, clear=True), \
         patch("app.llm._provider", return_value="deepseek"), \
         patch("app.llm._get_openai_client", return_value=fake_client):
        llm.explain({"ticker": "KO", "result": {}, "intermediate": {}})
    assert fake_client.chat.completions.create.call_args.kwargs["reasoning_effort"] == "none"

    # "default" is the sentinel meaning inherit the model's own choice
    with patch.dict(os.environ, {"LLM_REASONING_EFFORT": "default"}, clear=True), \
         patch("app.llm._provider", return_value="deepseek"), \
         patch("app.llm._get_openai_client", return_value=fake_client):
        llm.explain({"ticker": "KO", "result": {}, "intermediate": {}})
    assert "reasoning_effort" not in fake_client.chat.completions.create.call_args.kwargs


def test_deepseek_uses_its_own_credentials_and_endpoint():
    env = {"DEEPSEEK_API_KEY": "ds-key", "OPENAI_API_KEY": "oai-key"}
    with patch.dict(os.environ, env, clear=True), \
         patch("app.llm._provider", return_value="deepseek"), \
         patch("openai.OpenAI") as fake_ctor:
        llm._openai_client = None
        llm._openai_client_provider = None
        llm._get_openai_client()
    kwargs = fake_ctor.call_args.kwargs
    assert kwargs["api_key"] == "ds-key"
    assert kwargs["base_url"] == "https://api.deepseek.com/v1"
    llm._openai_client = None
    llm._openai_client_provider = None


def test_unknown_provider_lists_every_known_channel():
    with patch("app.llm._provider", return_value="wat"):
        out = llm.explain({"ticker": "KO", "result": {}, "intermediate": {}})
    assert "LLM_PROVIDER" in out["error"]
    for known in ("deepseek", "openai", "anthropic"):
        assert known in out["error"]


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
