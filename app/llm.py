"""LLM narration for the KMV rating dashboard.

Two interchangeable provider channels, selected by ``LLM_PROVIDER``:

- ``openai``: OpenAI's Chat Completions API via the official ``openai``
  SDK -- configured by ``OPENAI_API_KEY`` / ``OPENAI_BASE_URL`` /
  ``OPENAI_MODEL`` (defaults: the official endpoint, ``gpt-5.6-luna``) and
  ``OPENAI_REASONING_EFFORT``.
- ``anthropic`` (default): any Anthropic-Messages-compatible endpoint via
  the official ``anthropic`` SDK -- configured by ``LLM_API_KEY`` /
  ``LLM_BASE_URL`` / ``LLM_MODEL`` (defaults: MiniMax's compatibility
  endpoint, ``MiniMax-M3``).

Either channel turns a rated payload (see ``app.pipeline.rate_ticker``)
into two plain-English sections: a methodology explainer and a per-ticker
result analysis. Every public function degrades gracefully -- network or
API failures never raise, they just come back as an "error" field with
empty text -- since this is a narration add-on, not a computation the
dashboard depends on.
"""

from __future__ import annotations

import os
import re
from typing import Any

import anthropic
import openai

DEFAULT_PROVIDER = "anthropic"
DEFAULT_ANTHROPIC_BASE_URL = "https://api.minimaxi.com/anthropic"
DEFAULT_ANTHROPIC_MODEL = "MiniMax-M3"
DEFAULT_OPENAI_MODEL = "gpt-5.6-luna"

# Reasoning models bill their thinking against this budget, so it has to cover
# the reasoning *and* the visible answer -- at 1200 a hard prompt spends the
# whole allowance thinking and returns nothing at all.
DEFAULT_MAX_TOKENS = 4000
# "low" is the right default for narration: the facts arrive pre-computed, so
# extended deliberation only starves the answer. Set to "default" to send no
# reasoning_effort at all and inherit the model's own choice.
DEFAULT_REASONING_EFFORT = "low"

_client: anthropic.Anthropic | None = None
_openai_client: openai.OpenAI | None = None


def _provider() -> str:
    """The configured channel name, lowercased; validated at dispatch time."""
    return (os.environ.get("LLM_PROVIDER") or DEFAULT_PROVIDER).strip().lower()


def _api_key() -> str | None:
    return os.environ.get("LLM_API_KEY")


def _base_url() -> str:
    return os.environ.get("LLM_BASE_URL") or DEFAULT_ANTHROPIC_BASE_URL


def _model() -> str:
    if _provider() == "openai":
        return os.environ.get("OPENAI_MODEL") or DEFAULT_OPENAI_MODEL
    return os.environ.get("LLM_MODEL") or DEFAULT_ANTHROPIC_MODEL


def _max_tokens() -> int:
    try:
        return int(os.environ.get("LLM_MAX_TOKENS") or DEFAULT_MAX_TOKENS)
    except ValueError:
        return DEFAULT_MAX_TOKENS


def _reasoning_effort() -> str | None:
    """Effort level for the OpenAI channel; None means send no such field."""
    effort = (os.environ.get("OPENAI_REASONING_EFFORT") or DEFAULT_REASONING_EFFORT).strip()
    return None if effort.lower() in ("", "default", "none") else effort


def _get_client() -> anthropic.Anthropic:
    """Construct (and cache) the Anthropic SDK client pointed at MiniMax.

    Kept as its own function so tests can ``patch("app.llm._get_client")``
    without touching the real SDK or network.
    """
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=_api_key(), base_url=_base_url())
    return _client


def _get_openai_client() -> openai.OpenAI:
    """Construct (and cache) the OpenAI SDK client.

    Same patch-point contract as ``_get_client``: tests replace this to
    avoid the real SDK and network. A missing ``OPENAI_API_KEY`` makes the
    constructor raise, which the callers' catch-all turns into an "error"
    field rather than a crash.
    """
    global _openai_client
    if _openai_client is None:
        _openai_client = openai.OpenAI(
            api_key=os.environ.get("OPENAI_API_KEY"),
            base_url=os.environ.get("OPENAI_BASE_URL") or None,
        )
    return _openai_client


def _get(d: Any, *keys: str, default: Any = None) -> Any:
    """Best-effort nested dict lookup that tolerates missing/None containers."""
    cur = d
    for key in keys:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(key)
    return default if cur is None else cur


def _fmt(x: Any) -> str:
    """Render a metric value for prompt injection; None becomes 'N/A'."""
    if x is None:
        return "N/A"
    if isinstance(x, float):
        return f"{x:.6g}"
    return str(x)


SYSTEM_PROMPT = """\
You are a credit-risk methodology explainer for a KMV/Merton structural
credit model dashboard. The model treats a firm's equity as a call option on
its assets (strike = the default point, i.e. short-term debt plus a fraction
of long-term debt). It reverse-engineers unobservable asset value and asset
volatility from observed equity value and equity volatility via an
iterative Expectation-Maximization (EM) procedure applied to a daily series
of equity/debt/rate observations.

Key quantities, all computed once EM converges:
- Distance-to-default (DD): how many standard deviations of asset value
  separate the firm's assets from its default point at the horizon.
- Point-in-time expected default frequency / probability of default
  (PIT PD / EDF): EDF = Phi(-DD), the standard-normal CDF evaluated at
  -DD, i.e. the probability assets end below the default point.
- First-passage probability of default (PD_FH): the probability assets
  cross the default point at any point before the horizon (not just at the
  horizon), computed from a first-passage-time formula; always >= PIT PD.
- TiC (time-invariant coefficient): TiC = sigma^2 / ln^2(A/D), i.e. asset
  return variance scaled by the squared log leverage distance between asset
  value A and default point D. RiskScore = 100 * TiC is a rescaled, more
  practically usable version of the same quantity.
- CCM and mu: intermediate calibration terms used to map the point-in-time
  first-passage PD into a through-the-cycle (TTC) S&P-style rating via the
  ttc_conversion step (sp_letter, sp_ttc_pd, credit_outlook).

Known caveat you must always mention explicitly: the TiC formula's absolute
scale does not reconcile cleanly with the worked numerical examples in the
original course materials -- TiC/TTC numbers can look inconsistent in
isolation. RiskScore (100 * TiC) is the practical, usable scale for
comparison and ranking; treat raw TiC as a diagnostic intermediate, not a
number to sanity-check against a textbook example.

You must also flag a structural limitation of this model class: for large,
low-volatility, high-market-cap issuers, equity value is often enormous
relative to the default point, which mechanically pushes DD very high and
PIT PD toward zero -- so the model is systematically biased toward
optimistic (e.g. AAA) ratings for such names regardless of qualitative
credit concerns. Analysts should treat the output as one input, not a
verdict.

Write in English. Be precise, concise, and grounded only in the numbers
given to you -- never invent data not present in the input.
"""


def build_prompt(payload: dict[str, Any]) -> tuple[str, str]:
    """Build the (system, user) prompt pair for a rated ticker payload.

    Pulls values from ``payload["result"]`` and
    ``payload["intermediate"]["metrics"]``, tolerating missing fields.
    """
    payload = payload or {}
    ticker = payload.get("ticker") or "UNKNOWN"
    result = payload.get("result") or {}
    metrics = _get(payload, "intermediate", "metrics", default={}) or {}

    sp_letter = result.get("sp_letter")
    sp_ttc_pd = result.get("sp_ttc_pd")
    credit_outlook = result.get("credit_outlook")

    dd = metrics.get("dd")
    pit_pd = metrics.get("pit_pd")
    pd_fh = metrics.get("pd_fh")
    tic = metrics.get("tic")
    risk_score = metrics.get("risk_score")
    ccm = metrics.get("ccm")
    mu = metrics.get("mu")

    user = f"""\
Ticker: {ticker}
S&P-style through-the-cycle rating letter (sp_letter): {_fmt(sp_letter)}
S&P TTC probability of default (sp_ttc_pd): {_fmt(sp_ttc_pd)}
Credit outlook (credit_outlook): {_fmt(credit_outlook)}

Model intermediate metrics:
- Distance-to-default (DD): {_fmt(dd)}
- Point-in-time probability of default / EDF (pit_pd): {_fmt(pit_pd)}
- First-passage probability of default (pd_fh): {_fmt(pd_fh)}
- TiC (time-invariant coefficient): {_fmt(tic)}
- RiskScore (100 * TiC): {_fmt(risk_score)}
- CCM: {_fmt(ccm)}
- mu: {_fmt(mu)}

Write your response as exactly two sections, using these literal headings:

### CALIBER EXPLANATION
Explain, one by one, what each metric above means and what it evaluates to
for {ticker} specifically (substitute the actual numbers given above into
your explanation). Explicitly state that TiC's absolute scale is known to
be inconsistent with the course-material worked examples, and that
RiskScore (100 * TiC) is the practical, usable scale for comparison.

### RESULT ANALYSIS
Give your credit judgment on {ticker} given sp_letter={_fmt(sp_letter)} and
the metrics above, and discuss the model's limitations -- in particular
that this structural model tends to be systematically optimistic for
large-market-cap, low-volatility issuers because equity value so far
exceeds the default point that DD becomes very large and PD collapses
toward zero, which can push the rating toward AAA regardless of
qualitative credit concerns.
"""
    return SYSTEM_PROMPT, user


def _extract_text(message: Any) -> str:
    """Concatenate the text of every text-type content block in a response."""
    parts: list[str] = []
    content = getattr(message, "content", None)
    content = content if isinstance(content, list) else []
    for block in content:
        if getattr(block, "type", None) == "text":
            parts.append(getattr(block, "text", "") or "")
    return "".join(parts)


def _user_messages(text: str) -> list[dict[str, Any]]:
    """Wrap a plain string into the Anthropic Messages ``messages`` shape."""
    return [{"role": "user", "content": [{"type": "text", "text": text}]}]


def _chat_anthropic(system: str, user: str) -> str:
    message = _get_client().messages.create(
        model=_model(),
        max_tokens=_max_tokens(),
        system=system,
        messages=_user_messages(user),
    )
    return _extract_text(message)


def _chat_openai(system: str, user: str) -> str:
    # GPT-5-era models only accept max_completion_tokens, not max_tokens.
    kwargs: dict[str, Any] = {}
    if effort := _reasoning_effort():
        kwargs["reasoning_effort"] = effort
    completion = _get_openai_client().chat.completions.create(
        model=_model(),
        max_completion_tokens=_max_tokens(),
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        **kwargs,
    )
    choice = completion.choices[0]
    text = choice.message.content or ""
    if not text and getattr(choice, "finish_reason", None) == "length":
        # A reasoning model can spend the entire budget thinking and return an
        # empty answer. Say so loudly -- silently handing back "" reads
        # downstream as a model that had nothing to say.
        raise RuntimeError(
            f"{_model()} exhausted its {_max_tokens()}-token budget on reasoning "
            "and returned no text; raise LLM_MAX_TOKENS or lower "
            "OPENAI_REASONING_EFFORT"
        )
    return text


def _chat(system: str, user: str) -> str:
    provider = _provider()
    if provider == "openai":
        return _chat_openai(system, user)
    if provider == "anthropic":
        return _chat_anthropic(system, user)
    raise ValueError(
        f"unknown LLM_PROVIDER {provider!r}; use 'openai' or 'anthropic'"
    )


_CALIBER_RE = re.compile(r"###\s*CALIBER EXPLANATION\s*", re.IGNORECASE)
_RESULT_RE = re.compile(r"###\s*RESULT ANALYSIS\s*", re.IGNORECASE)


def _split_sections(text: str) -> tuple[str, str]:
    """Split LLM output into (caliber_explanation, result_analysis).

    Tolerant of missing headings, extra whitespace, and case differences.
    If both headings are absent, or only one section can be identified,
    the entire text is placed in result_analysis and caliber_explanation
    is left empty.
    """
    text = text or ""
    caliber_match = _CALIBER_RE.search(text)
    result_match = _RESULT_RE.search(text)

    if caliber_match and result_match:
        if caliber_match.start() < result_match.start():
            caliber = text[caliber_match.end():result_match.start()]
            result = text[result_match.end():]
        else:
            result = text[result_match.end():caliber_match.start()]
            caliber = text[caliber_match.end():]
        return caliber.strip(), result.strip()

    if caliber_match and not result_match:
        return text[caliber_match.end():].strip(), ""

    if result_match and not caliber_match:
        return "", text[result_match.end():].strip()

    return "", text.strip()


def explain(payload: dict[str, Any]) -> dict[str, Any]:
    """Produce the two narration sections for a rated ticker payload.

    Never raises: any exception (network, API, parsing) is caught and
    reported via the ``error`` field with both text fields left empty.
    """
    model = _model()
    try:
        system, user = build_prompt(payload)
        text = _chat(system, user)
        caliber, result = _split_sections(text)
        return {
            "caliber_explanation": caliber,
            "result_analysis": result,
            "model": model,
            "error": None,
        }
    except Exception as exc:  # noqa: BLE001 - narration must never crash the caller
        return {
            "caliber_explanation": "",
            "result_analysis": "",
            "model": model,
            "error": str(exc),
        }


def health() -> dict[str, Any]:
    """Probe the configured LLM endpoint with a minimal request. Never raises."""
    provider = _provider()
    try:
        if provider == "openai":
            # Reasoning models may spend the whole budget thinking; 16 tokens
            # keeps the probe cheap while leaving room for a non-empty reply.
            _get_openai_client().chat.completions.create(
                model=_model(),
                max_completion_tokens=16,
                messages=[{"role": "user", "content": "ping"}],
            )
        elif provider == "anthropic":
            _get_client().messages.create(
                model=_model(),
                max_tokens=4,
                system="ping",
                messages=_user_messages("ping"),
            )
        else:
            raise ValueError(
                f"unknown LLM_PROVIDER {provider!r}; use 'openai' or 'anthropic'"
            )
        return {"reachable": True, "detail": "ok"}
    except Exception as exc:  # noqa: BLE001 - health probe must never crash the caller
        return {"reachable": False, "detail": str(exc)}
