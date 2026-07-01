# KMV Credit-Rating Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a single-page English web dashboard that takes a stock ticker, fetches its data live, runs the existing KMV/Merton rating engine, displays source + all intermediate data + the rating, and uses an LLM to explain the methodology and analyze the result — with graceful error capture throughout.

**Architecture:** A FastAPI backend acts as an *orchestration + serialization* layer over the already-verified, stdlib-only engine (`rating_pipeline` → `rating_inputs` → `kmv_engine` → `ttc_conversion`); it never re-implements or alters any formula. A static vanilla-JS SPA (served by FastAPI) renders four sections (Source / Intermediate / Rating / AI) and calls `/api/rate` and `/api/explain`. Every layer degrades to structured JSON instead of crashing.

**Tech Stack:** Python 3.11+ stdlib engine (unchanged), FastAPI + uvicorn (only new runtime deps), pytest + httpx `TestClient` (test deps), vanilla HTML/CSS/JS + Chart.js via CDN (no build step).

**Spec:** `docs/superpowers/specs/2026-07-01-kmv-rating-dashboard-design.md`

---

## File Structure

| File | Responsibility |
|---|---|
| `requirements.txt` | fastapi, uvicorn[standard], pytest, httpx (test) |
| `.env.example` / `.env` | `MASSIVE_API_KEY`, `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` |
| `app/__init__.py` | package marker |
| `app/models.py` | pydantic request/response models |
| `app/serialize.py` | pure functions: engine objects → JSON-safe dicts (source / intermediate / result) |
| `app/pipeline.py` | orchestration: ticker + knobs → structured payload; failure handling (unrateable vs compute_error); Massive rate-limit retry |
| `app/llm.py` | OpenAI-compatible chat client, health probe, prompt builders |
| `app/main.py` | FastAPI app, routes, static mount, global exception handler, env loading |
| `app/static/index.html` | dashboard markup (4 sections) |
| `app/static/styles.css` | styling |
| `app/static/app.js` | fetch calls, rendering, charts, error banners |
| `test_api.py` | TestClient tests: happy path (Massive mocked to offline sample) + each error fallback |
| `test_pipeline.py` | pipeline/serialize unit tests against offline samples |

**Design boundary:** `serialize.py` is pure (no I/O) and independently testable. `pipeline.py` owns all orchestration + failure branching. `llm.py` is fully decoupled — an LLM outage never touches the rating path.

---

## Notes for the implementer (read once)

- **Never edit** `kmv_engine.py`, `ttc_conversion.py`, `rating_inputs.py`, `rating_pipeline.py`, or `test_massive_api.py`. Results must stay identical to the 22 existing unit tests. Run `python3 -m pytest test_kmv_engine.py test_ttc_conversion.py -q` after your changes to confirm they stay green.
- Engine entry points you WILL call (verified signatures):
  - `rating_pipeline.fetch_all(tickers: list[str], *, days, fallback_rate, output_dir=None, timeout, min_interval) -> dict[ticker, raw_sample]` — needs `MASSIVE_API_KEY` in env.
  - `rating_inputs.build_inputs(sample: dict, *, rate, horizon_days, st_debt_fallback) -> InputBundle` (fields: `ticker`, `days: list[DayInput]`, `shares`, `unrateable_reason`).
  - `kmv_engine.rate_company(days: Sequence[DayInput]) -> EMResult`.
  - `ttc_conversion.convert_fh_to_sp(ccm, mu, pd_fh) -> dict` (keys: `ccm_star`, `alpha`, `rs_sp`, `sp_letter`, `sp_ttc_pd`, `credit_outlook`, plus `rs_fh`/`ccm_fh` — inspect the real return at build time).
  - **Do NOT use** `rating_inputs.rate_from_sample` — it can't pass `horizon_days`.
- `DayInput` fields: `date, equity, debt, rate, tau` (+ props `.z`, `.discounted_debt`). `EMResult` fields include `sigma_a, eta_a, r_a, assets (list), iterations, sigma_history (list), converged, asset_latest, equity_latest, debt_latest, tau_latest, dd, pit_pd, pd_fh, tic, risk_score, ccm, mu`.
- Offline samples for tests: `massive_api_raw_samples/*.json` (KO, WMT, etc. rateable; COST/AMZN unrateable under `strict`). Use these to mock Massive so tests never hit the network.
- `MASSIVE_API_KEY` lives in `~/.zshrc:140`; a non-interactive shell won't source it. The `.env` file (Task 1) is how the backend gets it.
- `fallback_rate` knob maps to BOTH `fetch_all(fallback_rate=)` and `build_inputs(rate=)`; it only bites when a day lacks `risk_free_rate_1y`.

---

## Task 0: Scaffold — deps, env, package skeleton

**Files:**
- Create: `requirements.txt`, `.env.example`, `.env`, `app/__init__.py`

- [ ] **Step 1: Write `requirements.txt`**

```
fastapi>=0.110
uvicorn[standard]>=0.29
# test-only
pytest>=8.0
httpx>=0.27
```

- [ ] **Step 2: Write `.env.example`** (committed) and `.env` (git-ignored, real values)

`.env.example`:
```
MASSIVE_API_KEY=your-massive-key
LLM_API_KEY=your-llm-key
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
```

`.env` — populate real values. **Never paste the real LLM key into any tracked
file (this plan, README, source). It goes ONLY into the git-ignored `.env`.**
Pull the Massive key from `~/.zshrc:140`; the user-provided LLM key is passed via
the shell env var `$LLM_KEY` (the operator exports it once, out of band — it is
NOT written into this document):
```bash
MASSIVE=$(grep -oE 'MASSIVE_API_KEY=[^ ]+' ~/.zshrc | head -1 | cut -d= -f2)
# operator has already run:  export LLM_KEY='sk-cp-...'   (the key the user gave)
cat > .env <<EOF
MASSIVE_API_KEY=$MASSIVE
LLM_API_KEY=$LLM_KEY
LLM_BASE_URL=https://api.openai.com/v1
LLM_MODEL=gpt-4o-mini
EOF
```
(Confirm `.env` is in `.gitignore` — it already is. `git check-ignore .env`
must print `.env` before proceeding.)

- [ ] **Step 3: Create `app/__init__.py`** (empty).

- [ ] **Step 4: Install deps and verify import**

Run: `python3 -m pip install -r requirements.txt && python3 -c "import fastapi, uvicorn, httpx; print('ok')"`
Expected: `ok`

- [ ] **Step 5: Verify existing engine tests still pass**

Run: `python3 -m pytest test_kmv_engine.py test_ttc_conversion.py -q`
Expected: 22 passed.

- [ ] **Step 6: Commit**

```bash
git add requirements.txt .env.example app/__init__.py
git commit -m "chore: scaffold FastAPI deps and app package"
```

---

## Task 1: `serialize.py` — engine objects → JSON-safe dicts

Pure functions, no I/O. This is the "show all intermediate data" core.

**Files:**
- Create: `app/serialize.py`
- Test: `test_pipeline.py` (shared test file; this task adds the serialize tests)

- [ ] **Step 1: Write failing tests**

```python
# test_pipeline.py
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

def test_intermediate_dict_handles_none_result():
    # Unrateable / compute-failure path: still return inputs, never raise.
    _, bundle, *_ = _rate_ko()
    inter = serialize.intermediate_dict(bundle, None)
    assert inter["day_inputs"]                 # inputs still present
    assert inter["assets"] == []               # no recovered assets
    assert inter["em"] == {} or inter["em"].get("iterations") in (None, 0)
    assert inter["metrics"] == {}              # empty, not raising
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
```

- [ ] **Step 2: Run tests — verify they fail** (`ModuleNotFoundError: app.serialize`)

Run: `python3 -m pytest test_pipeline.py -q`
Expected: FAIL (import error / attribute errors).

- [ ] **Step 3: Implement `app/serialize.py`**

Write pure functions:
- `source_dict(sample)` → `{shares_outstanding, balance_sheet (per-quarter debt_current/long_term/period_end), prices (date, dividend_adjusted_close), risk_free_rate_1y_series, sofr_series, notes}`. Pull from `sample["responses"]`, `sample["derived"]`, `sample["notes"]`. Cap price list length is fine (return all; frontend paginates).
- `intermediate_dict(bundle, result)` → `{day_inputs: [{date, equity, debt, rate, tau}], default_points: [...], em: {iterations, converged, sigma_history, sigma_a, eta_a, r_a}, assets: [...], metrics: {dd, pit_pd, pd_fh, tic, risk_score, ccm, mu, asset_latest, equity_latest, debt_latest, tau_latest}}`.
- `result_dict(result, sp, *, unrateable_reason=None, compute_error=None)` → merge `sp` keys + `{unrateable_reason, compute_error, partial: bool}`.
- **Both `intermediate_dict` and `result_dict` MUST accept `result=None`** (and `sp=None`): `intermediate_dict(bundle, None)` returns `day_inputs`/`default_points` from the bundle but `em={}`, `assets=[]`, `metrics={}`; `result_dict(None, None, ...)` returns all `sp` keys as `None` plus the passed `unrateable_reason`/`compute_error`. Driven by `test_intermediate_dict_handles_none_result` / `test_result_dict_handles_none_result`.
- Include a helper `_num(x)` that converts to plain float / returns `None` for inf/nan so `json.dumps` never chokes (guard `tic` which can be `inf`).

- [ ] **Step 4: Run tests — verify pass**

Run: `python3 -m pytest test_pipeline.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/serialize.py test_pipeline.py
git commit -m "feat: serialize engine objects to JSON-safe source/intermediate/result dicts"
```

---

## Task 2: `pipeline.py` — orchestration + failure handling

**Files:**
- Create: `app/pipeline.py`
- Test: `test_pipeline.py` (add orchestration tests; mock `fetch_all`)

- [ ] **Step 1: Write failing tests** (mock Massive with offline samples)

```python
# append to test_pipeline.py
from unittest.mock import patch
from app import pipeline

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
    assert out["result"]["unrateable_reason"]      # e.g. missing debt_current
    assert out["result"]["sp_letter"] is None
    assert out["source"]                            # source still returned

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
        s["derived"]["daily_dividend_adjusted_prices"] = []   # rate-limit symptom
        return {tickers[0]: s}
    # mock sleep so the retry adds no real delay; assert the retry actually happened.
    with patch("app.pipeline.time.sleep"), patch("app.pipeline.fetch_all", _empty):
        out = pipeline.rate_ticker("KO", days=400, st_debt_fallback="strict",
                                   horizon_days=365.0, fallback_rate=0.045)
    assert calls["n"] == 2                                     # original + one retry
    assert any("rate" in w.lower() for w in out["meta"]["warnings"])
```

- [ ] **Step 2: Run — verify fail**

Run: `python3 -m pytest test_pipeline.py -q`
Expected: FAIL (no `app.pipeline`).

- [ ] **Step 3: Implement `app/pipeline.py`**

```python
from __future__ import annotations
import time
from rating_pipeline import fetch_all          # imported here so tests can patch app.pipeline.fetch_all
import rating_inputs, kmv_engine, ttc_conversion
from app import serialize

class RateLimited(Exception): ...
class NotFound(Exception): ...

def _prices(sample): return sample.get("derived", {}).get("daily_dividend_adjusted_prices", [])

def _fetch_one(ticker, *, days, fallback_rate, retries=1):
    """Fetch with a single rate-limit retry. Detection per spec §6."""
    warnings = []
    for attempt in range(retries + 1):
        samples = fetch_all([ticker], days=days, fallback_rate=fallback_rate)
        sample = samples.get(ticker, {})
        has_meta = bool(sample.get("responses", {}).get("ticker_overview")) or \
                   bool(sample.get("responses", {}).get("balance_sheet"))
        if _prices(sample):
            return sample, warnings
        if has_meta and attempt < retries:      # prices empty but meta present -> rate-limit; retry
            warnings.append("Massive rate-limited (empty prices); retried once.")
            time.sleep(2)
            continue
        if has_meta:
            warnings.append("Massive rate-limited; prices still empty after retry. Try a larger --min-interval later.")
            return sample, warnings
        raise NotFound(f"No data for '{ticker}' (all responses empty).")
    return sample, warnings

def rate_ticker(ticker, *, days, st_debt_fallback, horizon_days, fallback_rate):
    t0 = time.time()
    meta = {"warnings": [], "timings": {}}
    ticker = ticker.strip().upper()
    # Allow class-suffix tickers like BRK.B / BRK-B; reject only empty/space-y.
    if not ticker or any(c.isspace() for c in ticker):
        raise NotFound(f"Invalid ticker '{ticker}'.")
    sample, warns = _fetch_one(ticker, days=days, fallback_rate=fallback_rate)
    meta["warnings"] += warns

    bundle = rating_inputs.build_inputs(sample, rate=fallback_rate,
                                        horizon_days=horizon_days, st_debt_fallback=st_debt_fallback)
    source = serialize.source_dict(sample)

    if bundle.unrateable_reason:
        return {"ticker": ticker, "source": source,
                "intermediate": serialize.intermediate_dict(bundle, None),
                "result": serialize.result_dict(None, None, unrateable_reason=bundle.unrateable_reason),
                "meta": {**meta, "timings": {"total_s": round(time.time()-t0, 2)}}}

    try:
        result = kmv_engine.rate_company(bundle.days)
        sp = ttc_conversion.convert_fh_to_sp(result.ccm, result.mu, result.pd_fh)
        res = serialize.result_dict(result, sp)
        inter = serialize.intermediate_dict(bundle, result)
    except Exception as exc:  # compute-stage failure -> partial
        res = serialize.result_dict(None, None, compute_error=f"{type(exc).__name__}: {exc}")
        inter = serialize.intermediate_dict(bundle, None)
        meta["warnings"].append("Rating computation failed; showing inputs only.")

    meta["timings"]["total_s"] = round(time.time()-t0, 2)
    return {"ticker": ticker, "source": source, "intermediate": inter, "result": res, "meta": meta}
```
(`serialize.intermediate_dict`/`result_dict` already accept `None` result — that
contract was test-driven in Task 1, so this task just consumes it.)

- [ ] **Step 4: Run — verify pass**

Run: `python3 -m pytest test_pipeline.py -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/pipeline.py app/serialize.py test_pipeline.py
git commit -m "feat: pipeline orchestration with unrateable/compute-error/rate-limit handling"
```

---

## Task 3: `llm.py` — OpenAI-compatible client, health probe, prompts

**Files:**
- Create: `app/llm.py`
- Test: `test_llm.py`

- [ ] **Step 1: Write failing tests** (mock `httpx`)

```python
# test_llm.py
from unittest.mock import patch, MagicMock
from app import llm

def test_build_explanation_prompt_includes_values():
    payload = {"ticker": "KO",
               "result": {"sp_letter": "AAA", "sp_ttc_pd": 0.0002, "credit_outlook": -0.0001},
               "intermediate": {"metrics": {"dd": 8.1, "pit_pd": 1e-9, "pd_fh": 2e-9,
                                            "tic": 0.01, "risk_score": 1.0, "ccm": 0.5, "mu": 20.0}}}
    msgs = llm.build_messages(payload)
    text = " ".join(m["content"] for m in msgs)
    assert "KO" in text and "AAA" in text
    assert "TiC" in text and "8.1" in text            # grounded in real numbers
    assert "distance-to-default" in text.lower() or "DD" in text

def test_explain_returns_text_on_success():
    fake = MagicMock(status_code=200)
    fake.json.return_value = {"choices": [{"message": {"content": "Because DD is high, KO is safe."}}]}
    with patch("app.llm.httpx.post", return_value=fake):
        out = llm.explain({"ticker": "KO", "result": {"sp_letter": "AAA"}, "intermediate": {"metrics": {}}})
    assert out["error"] is None
    assert "KO" in out["caliber_explanation"] + out["result_analysis"] or out["result_analysis"]

def test_explain_degrades_on_http_error():
    with patch("app.llm.httpx.post", side_effect=Exception("connection refused")):
        out = llm.explain({"ticker": "KO", "result": {"sp_letter": "AAA"}, "intermediate": {"metrics": {}}})
    assert out["error"]                                # surfaced, not raised
    assert out["caliber_explanation"] == "" and out["result_analysis"] == ""

def test_health_probe_returns_bool():
    with patch("app.llm.httpx.post", side_effect=Exception("no route")):
        h = llm.health()
    assert h["reachable"] is False and h["detail"]
```

- [ ] **Step 2: Run — verify fail** (`python3 -m pytest test_llm.py -q`).

- [ ] **Step 3: Implement `app/llm.py`**

- Read `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL` from env.
- `build_messages(payload)`: a system prompt describing the KMV/TiC methodology + a user prompt that injects this run's actual metric values and asks for TWO clearly delimited sections — `### CALIBER EXPLANATION` (what DD/EDF/TiC/CCM/PD_FH/TTC mean, using the run's numbers; **must flag the known TiC-vs-deck discrepancy**) and `### RESULT ANALYSIS` (credit judgment for this ticker + model-limitation note re: large-cap low-vol optimism). English.
- `_chat(messages) -> str`: `httpx.post(f"{BASE_URL}/chat/completions", json={model, messages, temperature:0.2}, headers={Authorization: Bearer KEY}, timeout=60)`; raise on non-200.
- `explain(payload) -> {caliber_explanation, result_analysis, model, error}`: call `_chat`, split on the `###` markers; on ANY exception return empty strings + `error=str(exc)` (never raise).
- `health() -> {reachable, detail}`: tiny 1-token probe; catch all, return `reachable=False` with the reason.

- [ ] **Step 4: Run — verify pass** (`python3 -m pytest test_llm.py -q`).

- [ ] **Step 5: Commit**

```bash
git add app/llm.py test_llm.py
git commit -m "feat: OpenAI-compatible LLM client with grounded prompts and graceful degradation"
```

---

## Task 4: `main.py` — FastAPI routes, static mount, global exception handler

**Files:**
- Create: `app/main.py`, `app/models.py`
- Test: `test_api.py`

- [ ] **Step 1: Write failing tests** (TestClient, Massive + LLM mocked)

```python
# test_api.py
import json
from pathlib import Path
from unittest.mock import patch
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def _fake_fetch(name):
    def _inner(tickers, **kw):
        return {tickers[0]: json.loads(Path(f"massive_api_raw_samples/{name}.json").read_text())}
    return _inner

def test_health_ok():
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

def test_rate_unrateable_is_200_with_reason():
    with patch("app.pipeline.fetch_all", _fake_fetch("COST")):
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
    with patch("app.pipeline.fetch_all", side_effect=RuntimeError("boom")):
        r = client.post("/api/rate", json={"ticker": "KO"})
    assert r.status_code == 500
    assert r.headers["content-type"].startswith("application/json")
    assert "error" in r.json()

def test_explain_endpoint_degrades():
    with patch("app.llm.httpx.post", side_effect=Exception("no endpoint")):
        r = client.post("/api/explain", json={"ticker": "KO", "result": {"sp_letter": "AAA"},
                                              "intermediate": {"metrics": {}}})
    assert r.status_code == 200
    assert r.json()["error"]

def test_index_served():
    r = client.get("/")
    assert r.status_code == 200 and "text/html" in r.headers["content-type"]
```

- [ ] **Step 2: Run — verify fail** (`python3 -m pytest test_api.py -q`).

- [ ] **Step 3: Implement `app/models.py`** — pydantic `RateRequest(ticker: str, days: int = 400, st_debt_fallback: Literal["strict","zero","curliab"] = "strict", horizon_days: float = 365.0, fallback_rate: float = 0.045)`; `ExplainRequest` accepts the rate payload (use `dict` / `model_config extra=allow` for flexibility).

- [ ] **Step 4: Implement `app/main.py`**

- On import: load `.env` (tiny hand-rolled loader or `os.environ` if already exported; do NOT add python-dotenv unless trivial — a 6-line parser reading `.env` is fine).
- `app = FastAPI()`. Mount `app/static` at `/static`; `GET /` returns `index.html` via `FileResponse`.
- `POST /api/rate`: call `pipeline.rate_ticker(**req)`; map `pipeline.NotFound` → `HTTPException(404, detail=...)`.
- `POST /api/explain`: call `llm.explain(payload)`; always 200.
- `GET /api/health`: `{massive_key: bool(env), llm: llm.health()}`.
- Global handlers: `@app.exception_handler(Exception)` → `JSONResponse(500, {"error": str(exc), "detail": type(exc).__name__})`; keep `HTTPException` default JSON.

- [ ] **Step 5: Run — verify pass** (`python3 -m pytest test_api.py -q`). Then full suite: `python3 -m pytest -q` (engine 22 + new tests all green).

- [ ] **Step 6: Commit**

```bash
git add app/main.py app/models.py test_api.py
git commit -m "feat: FastAPI routes with global error capture and static mount"
```

---

## Task 5: Front-end — static SPA (markup + styles + JS)

**Files:**
- Create: `app/static/index.html`, `app/static/styles.css`, `app/static/app.js`

- [ ] **Step 1: `index.html`** — English UI, four sections with stable element IDs:
  - Top banner `#health-banner` (hidden unless a health issue).
  - Input panel: `#ticker`, knobs (`#days`, `#st-debt`, `#horizon`, `#fallback-rate` with the "applies only when rate feed unavailable" hint), `#rate-btn`, `#loading`.
  - `#error-banner` (red, for /api/rate errors).
  - Section `#source` (collapsible cards), `#intermediate` (tables + `<canvas id="sigma-chart">`, `<canvas id="assets-chart">`, metric cards), `#rating` (big S&P letter, TTC_PD, outlook, conversion chain), `#ai` (two blocks + `#explain-btn` + `#ai-error`).
  - Chart.js via CDN `<script src="https://cdn.jsdelivr.net/npm/chart.js">`.

- [ ] **Step 2: `styles.css`** — clean modern dashboard: card grid, monospace numeric tables, color-coded rating (AAA green → C red), responsive.

- [ ] **Step 3: `app.js`**
  - `onHealth()` at load: GET `/api/health`; if `massive_key` false or `llm.reachable` false, show `#health-banner` with the reason.
  - `onRate()`: POST `/api/rate`; show `#loading` during; on non-2xx or `error` show `#error-banner`; on unrateable show reason + one-click buttons to re-run with `st_debt_fallback=zero`/`curliab`; else render all sections; draw `sigma_history` and `assets`-vs-equity charts. Guard every field with `?.` and fallbacks so a missing key never white-screens.
  - `onExplain()`: POST `/api/explain` with the last rate payload; render `caliber_explanation` + `result_analysis`; on `error` show `#ai-error` (rating stays intact). Add a footnote next to TiC about the known deck discrepancy.

- [ ] **Step 4: Manual smoke via TestClient is already covered (`test_index_served`).** Add nothing heavy; optionally a Playwright check is out of scope (YAGNI).

- [ ] **Step 5: Commit**

```bash
git add app/static
git commit -m "feat: single-page dashboard UI (source/intermediate/rating/AI) with charts"
```

---

## Task 6: End-to-end verification with real keys + docs

**Files:**
- Create: `README.md` (run instructions)

- [ ] **Step 1: Confirm `.env` has real Massive + LLM keys** (from Task 0). Verify it is git-ignored: `git check-ignore .env` → prints `.env`.

- [ ] **Step 2: Start the server**

Run (background): `python3 -m uvicorn app.main:app --port 8000`
Then: `curl -s localhost:8000/api/health` → inspect `massive_key:true`, and `llm.reachable` (may be false if `sk-cp-` base_url is wrong — that's expected/graceful).

- [ ] **Step 3: Live rate a real ticker** (needs network + key; slow first call)

Run: `curl -s -X POST localhost:8000/api/rate -H 'Content-Type: application/json' -d '{"ticker":"KO","days":400}' | python3 -m json.tool | head -40`
Expected: `result.sp_letter` present; `intermediate.day_inputs` non-empty. If rate-limited, `meta.warnings` explains it.

- [ ] **Step 4: Browser check** — use the `superpowers:webapp-testing` or `run` skill (or open `localhost:8000`): enter a ticker, confirm all four sections render, toggle a knob, trigger an unrateable ticker (COST strict) and confirm the reason + caliber-switch buttons, click "Explain" and confirm AI text or a graceful "unavailable" message.

- [ ] **Step 5: If `llm.reachable` is false**, note in README that the user must set `LLM_BASE_URL`/`LLM_MODEL` for the `sk-cp-` key; the rating dashboard works regardless.

- [ ] **Step 6: Write `README.md`** — setup (`pip install -r requirements.txt`, `.env`), run (`uvicorn app.main:app`), knobs explanation, error-handling behavior, known limitations (large-cap optimism, TiC discrepancy).

- [ ] **Step 7: Full test suite green**

Run: `python3 -m pytest -q`
Expected: all pass (22 engine + serialize/pipeline/llm/api).

- [ ] **Step 8: Commit**

```bash
git add README.md
git commit -m "docs: run instructions and known limitations; verified end-to-end"
```

---

## Definition of Done

- `python3 -m pytest -q` fully green (existing 22 untouched + new tests).
- `localhost:8000` serves the dashboard; entering a live ticker shows source + all intermediates + rating.
- Every failure mode from spec §6 renders a message, never a stack trace or white screen.
- LLM explanation works when reachable; degrades cleanly when not, without affecting rating.
- `.env` holds real keys and is git-ignored.
