# KMV Credit-Rating Dashboard — Design Spec

**Date:** 2026-07-01
**Status:** Approved (brainstorming), pending spec review
**Author:** Claude (with user)

## 1. Goal

A polished single-page web dashboard (English UI) that lets a user type a stock
ticker, fetches its financial data live, runs the existing KMV/Merton credit
rating engine, and displays **the source data, every intermediate quantity, and
the final rating** — with adjustable methodology knobs and a time window. After
a rating is produced, an LLM explains the methodology (calibers/formulas) and
analyzes the result. All failures are captured and shown gracefully; nothing
white-screens.

## 2. Non-Goals (YAGNI)

- No user accounts, no persistence/database, no history.
- No changes to the rating math — the engine (`kmv_engine.py`,
  `ttc_conversion.py`, `rating_inputs.py`, `rating_pipeline.py`) is reused
  verbatim so results stay consistent with the 22 existing unit tests.
- No front-end build tooling (no React/Vite/node). Static HTML/CSS/JS only.
- No custom-voice/TTS, no multi-ticker batch UI, no export.

## 3. Architecture

```
Browser (static SPA: index.html + vanilla JS + Chart.js via CDN)
        │  fetch JSON
        ▼
FastAPI backend (app/)
  ├─ GET  /api/health   probe MASSIVE_API_KEY presence + LLM endpoint reachability
  ├─ POST /api/rate     ticker + knobs → full pipeline → source + intermediates + result
  ├─ POST /api/explain  rating result → LLM caliber-explanation + result-analysis
  └─ GET  /            serve the static front-end
        │  orchestration + serialization only (no new math)
        ▼
rating_pipeline.fetch_all → rating_inputs.build_inputs
                          → kmv_engine.rate_company → ttc_conversion.convert_fh_to_sp
```

**Core principle:** the backend is an *orchestration + serialization* layer over
the already-verified engine. It must not re-implement or alter any formula.

### Directory layout
```
app/
  __init__.py
  main.py          # FastAPI app, routes, static mount, global exception handler
  pipeline.py      # thin adapter: ticker+knobs -> structured dict (source/intermediate/result)
  llm.py           # OpenAI-compatible chat client + prompt builders
  models.py        # pydantic request/response models
  static/
    index.html     # the single-page dashboard
    app.js
    styles.css
.env               # LLM_API_KEY, LLM_BASE_URL, LLM_MODEL, MASSIVE_API_KEY
.env.example
test_api.py        # FastAPI TestClient tests (offline, Massive mocked)
requirements.txt   # fastapi, uvicorn (engine stays stdlib-only)
```

## 4. Data flow & displayed sections (top → bottom)

1. **Input panel** — ticker text box + adjustable knobs. Each knob maps to a
   **specific engine parameter** (the backend calls `rating_pipeline.fetch_all`
   → `rating_inputs.build_inputs` → `kmv_engine.rate_company` directly; it does
   **not** use `rate_from_sample`, which cannot pass `horizon_days`):
   - `days` (time window, default 400) → `fetch_all(days=)`.
   - `st_debt_fallback` ∈ {strict, zero, curliab} (default strict) →
     `build_inputs(st_debt_fallback=)`.
   - `horizon_days` (debt maturity, default 365) → `build_inputs(horizon_days=)`.
   - `fallback_rate` (default 0.045) → passed BOTH to `fetch_all(fallback_rate=)`
     (used when the FRED/SOFR feed is unavailable) AND to `build_inputs(rate=)`
     (the legacy per-row fallback). **It only takes effect when a day has no
     `risk_free_rate_1y`;** on the normal live path every day carries a real FRED
     rate, so this knob usually does not change the result. The UI must label it
     "applies only when the rate feed is unavailable" so users aren't confused
     when adjusting it shows no change.
   - "Fetch & Rate" button.
2. **Source Data** (collapsible cards): Massive raw responses — ticker overview
   (shares outstanding), balance sheet (per-quarter `debt_current` /
   `long_term_debt_and_capital_lease_obligations`), dividend-adjusted price
   series, FRED DGS1 rate series, SOFR series.
3. **Intermediate** (the heart of "show all intermediate data"):
   - Per-day `DayInput` table: date / equity (E = adj_close × shares) / debt D /
     rate / tau.
   - Per-quarter default-point D derivation detail.
   - EM iteration: `sigma_history` convergence line chart + iteration count +
     converged flag.
   - Recovered daily `assets` series line chart (vs equity).
   - Latest-day metric cards: DD, PIT_PD (EDF), PD_FH, TiC, RiskScore, CCM, mu.
     **TiC caveat:** the TiC value must be shown with a footnote that its scale is
     known to disagree with the course-deck worked example (see the comment in
     `kmv_engine.py._attach_rating` and memory `kmv-tic-formula-discrepancy`);
     RiskScore = 100·TiC is the practical reporting scale. Do not present TiC as a
     verified figure without this note, and the AI caliber-explanation must flag it.
4. **Rating** — S&P letter (large), TTC_PD, Credit Outlook, with the
   PIT→TTC conversion chain shown (CCM → α → CCM* → RS_SP → letter).
5. **AI Interpretation** — two blocks:
   - *Caliber explanation*: what DD/EDF/TiC/CCM/PD_FH/TTC conversion mean and
     the actual input values used this run.
   - *Result analysis*: credit judgment for this ticker plus model-limitation
     notes (e.g. large-cap low-vol systematic optimism: equity ≫ default point →
     DD huge → PD≈0 → tends to AAA).

## 5. API contracts

### POST /api/rate
Request:
```json
{ "ticker": "KO", "days": 400, "st_debt_fallback": "strict",
  "horizon_days": 365, "fallback_rate": 0.045 }
```
Response (success): a structured object with four top-level keys mirroring the
UI sections: `source`, `intermediate`, `result`, `meta` (notes, warnings,
timings). `result` includes both the raw `EMResult` fields and the
`convert_fh_to_sp` output (keys `ccm_star`, `alpha`, `rs_sp`, `sp_letter`,
`sp_ttc_pd`, `credit_outlook`).

**Two distinct failure modes, two distinct fields** (do not conflate):
- *Input-stage unrateable* — comes from `InputBundle.unrateable_reason`
  (e.g. "no shares outstanding", "no quarter has both debt components"). Returned
  as `result.unrateable_reason`; no `EMResult` is produced, but any source data
  fetched is still returned.
- *Compute-stage failure* — EM non-convergence / math error (A≤0, overflow) after
  a valid `InputBundle`. Returned under a separate `result.compute_error` field
  with a `partial` flag, alongside whatever intermediates were computed. This is
  NOT `unrateable_reason` (which belongs to `InputBundle`, not `EMResult`).

### POST /api/explain
Request: the `/api/rate` result payload (or a compact subset). Response:
`{ "caliber_explanation": "...", "result_analysis": "...", "model": "...",
   "error": null }`. Runs independently of `/api/rate`.

### GET /api/health
`{ "massive_key": true|false, "llm": {"reachable": bool, "detail": "..."} }`.

## 6. Error capture & fallback (every layer degrades, never crashes)

| Failure | Fallback | UI |
|---|---|---|
| Ticker not found / Massive 404 | `{error, stage:"fetch", detail}` | "Ticker not found or no data", input preserved |
| Massive rate-limit (empty prices `{}`) | orchestration-layer retry once, then surface `min_interval` hint. **Detection rule:** the ticker returned an overview/balance sheet but `derived.daily_dividend_adjusted_prices` is empty while other fields are present (the known free-tier "silently swallowed prices" symptom) → treat as rate-limit and retry. If *all* responses are empty → treat as "not found", do NOT retry. | yellow "rate-limited, retried" warning |
| `MASSIVE_API_KEY` missing | `/api/health` → red | top banner "backend key missing" |
| Missing `debt_current` (COST/AMZN) strict → unrateable | return `unrateable_reason` + suggest zero/curliab | result panel shows reason + one-click caliber-switch buttons |
| EM non-convergence / math error (A≤0, overflow) | try/except around `rate_company`, return `partial` | show intermediates computed + mark failing step |
| LLM endpoint error (base_url unknown/timeout/401) | `/api/explain` decoupled from rating | AI panel "explanation unavailable: <reason>", rating still shown |
| Rate feed (FRED/SOFR) down | engine's built-in flat fallback | notes annotate "flat fallback used" |

Backend has a global exception handler turning any unexpected error into
`500 + {error, detail}` JSON (never an HTML stack trace to the browser).

## 7. LLM integration

- `.env`: `LLM_API_KEY` (user-provided `sk-cp-…`), `LLM_BASE_URL` (configurable),
  `LLM_MODEL` (configurable). OpenAI `/v1/chat/completions` compatible.
- On startup / `/api/health`, probe reachability. Endpoint for `sk-cp-` is
  unknown to us — try a sensible OpenAI-compatible default; if the probe fails,
  the UI banner says "LLM endpoint not reachable, set LLM_BASE_URL" and rating
  functionality is **unaffected**.
- Prompts inject this run's formulas *and* actual numeric values so the
  explanation is grounded in the specific ticker, not generic.

## 8. Tech choices & testing

- Backend: FastAPI + uvicorn (the only two new deps). Engine stays stdlib-only.
- Front-end: single `index.html` + vanilla JS + Chart.js via CDN. No build step.
- Tests: `test_api.py` (pytest + FastAPI `TestClient`) covering each error
  fallback path plus one happy path, with Massive mocked to an offline sample so
  tests never hit the network. The existing 22 engine unit tests stay green.

## 9. Open items

- `LLM_BASE_URL` for the `sk-cp-` key is unknown; backend is written to probe and
  degrade gracefully. User will supply the base URL if the default probe fails.
- Live Massive fetch is slow on first query (tens of seconds; free-tier rate
  limits). UI shows a progress/loading state.
