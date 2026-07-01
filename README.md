# KMV Credit Rating Dashboard

A single-page web dashboard over the project's structural (Merton/KMV) credit
rating engine. Type a stock ticker, fetch its market data live, and see **the
source data, every intermediate quantity, and the final S&P-scale rating** — with
adjustable methodology knobs, a time window, full error capture, and an LLM that
explains the calibers and analyzes the result.

The FastAPI backend is a thin *orchestration + serialization* layer over the
already-verified, stdlib-only engine (`kmv_engine.py`, `rating_inputs.py`,
`rating_pipeline.py`, `ttc_conversion.py`) — **no rating math was changed**, so
results stay identical to the engine's 22 unit tests.

## Architecture

```
Browser (static SPA: index.html + vanilla JS + Chart.js via CDN)
        │  fetch JSON
        ▼
FastAPI (app/)
  ├─ GET  /api/health   MASSIVE_API_KEY presence + LLM endpoint reachability
  ├─ POST /api/rate     ticker + knobs → source + all intermediates + rating
  ├─ POST /api/explain  rating payload → LLM caliber explanation + result analysis
  └─ GET  /             serves the dashboard
        │  orchestration only (no new math)
        ▼
rating_pipeline.fetch_all → rating_inputs.build_inputs
                          → kmv_engine.rate_company → ttc_conversion.convert_fh_to_sp
```

Modules: `app/serialize.py` (engine objects → JSON-safe dicts), `app/pipeline.py`
(orchestration + failure handling), `app/llm.py` (MiniMax via the Anthropic SDK),
`app/main.py` (routes, static mount, global error handler), `app/static/*` (UI).

## Setup

Requires Python 3.11+. The machine's system Python is externally-managed, so use a
virtualenv:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

Create a `.env` in the project root (it is git-ignored — never commit real keys):

```
MASSIVE_API_KEY=<your massive-api key>       # per-ticker market data
LLM_API_KEY=<your sk-cp-… key>               # MiniMax
LLM_BASE_URL=https://api.minimaxi.com/anthropic
LLM_MODEL=MiniMax-M3
```

See `.env.example` for the template. Both rate feeds (FRED DGS1, SOFR) are
key-less; only per-ticker market data needs `MASSIVE_API_KEY`.

## Run

```bash
.venv/bin/python -m uvicorn app.main:app --port 8137
```

Open http://127.0.0.1:8137, type a ticker (e.g. `KO`, `WMT`), and click
**Fetch & Rate**. The first query for a ticker can take ~30 s (live market-data
fetch; free-tier rate limits apply). After a rating renders, click
**Explain this rating** for the LLM interpretation.

## Adjustable knobs (methodology settings)

| Knob | Engine parameter | Effect |
|---|---|---|
| **Time window** (`days`, default 400) | `fetch_all(days=)` | Calendar-day price window (~250 trading days at 400). |
| **Short-term-debt fallback** (`st_debt_fallback`: strict / zero / curliab) | `build_inputs(st_debt_fallback=)` | How to treat a missing `debt_current`. `strict` skips the quarter (may be UNRATEABLE); `zero` treats short-term debt as 0; `curliab` uses total current liabilities. |
| **Debt horizon** (`horizon_days`, default 365) | `build_inputs(horizon_days=)` | Assumed debt maturity after each quarter-end (sets τ). |
| **Risk-free fallback** (`fallback_rate`, default 0.045) | `fetch_all` + `build_inputs(rate=)` | **Only used when a day has no FRED rate.** On the normal live path every day carries a real FRED DGS1 rate, so adjusting this usually changes nothing. |

## Error capture

Every failure degrades to a clear message — never a white screen or a stack trace
in the browser:

- **Ticker not found** → 404, red error banner with the reason.
- **Unrateable** (e.g. strict fallback with no `debt_current`, or no shares) → a
  "Not rateable" notice with the reason; source data still shown; one-click
  buttons offer to retry with a different debt fallback when relevant.
- **Rate-limited** (empty prices from the free tier) → one automatic retry, then a
  warning; source data preserved.
- **Compute error** (EM / math failure) → "showing inputs only" with the error;
  intermediates still rendered.
- **LLM unreachable** → the AI panel says so; the rating is unaffected (fully
  decoupled). A top banner flags a missing market-data key or unreachable LLM.
- Any unexpected server error becomes a `{error, detail}` 500 JSON.

## Known limitations

- **Large-cap optimism.** Structural PIT models are systematically optimistic for
  large-cap, low-volatility firms (equity ≫ default point → huge DD → PD≈0 →
  tends to AAA). This is a property of the Merton/KMV method, not a bug.
- **TiC scale caveat.** The TiC value is shown with a footnote: its scale is known
  to disagree with the course deck's worked example; **RiskScore = 100·TiC** is the
  practical reporting scale. (See the comment in `kmv_engine.py._attach_rating`.)
- **First query latency.** Live market-data fetches are slow on the first call for
  a ticker and subject to free-tier rate limits.

## Tests

```bash
.venv/bin/python -m pytest -q
```

Covers the engine (22 tests, unchanged) plus the new `serialize` / `pipeline` /
`llm` / `api` layers, with Massive and the LLM mocked so tests never hit the
network.
