# TiC Rating — structural credit ratings for the S&P 500

Type a ticker, read a credit rating. The rating is not looked up from an agency —
it is computed from market equity and balance-sheet debt with a Merton/KMV
structural model, then converted from a point-in-time probability of default to a
through-the-cycle letter on the S&P scale.

498 of the 503 S&P 500 constituents are pre-computed and cached — the rating
re-evaluated on every trading day in the calibration window, with every
intermediate quantity the model produces. Pick any date; compare against any
earlier one.

```bash
python3 -m http.server 8141 --directory web     # the dashboard, no build step
python3 -m uvicorn app.main:app --port 8137     # optional: the live single-ticker API
```

## What is in here

```
web/                     the dashboard — static, dependency-free, ES modules
  index.html               section order and mount points, nothing else
  styles/                  tokens → base → layout → components → candles
  js/
    store.js               the only module that knows where data comes from
    fields.js              canonical inventory of every model field + the S&P scale
    format.js              money in thousands, probabilities down to 1e-27
    charts.js              six analytic plates, as SVG strings
    candles.js             interactive candlestick (crosshair, readout, ranges)
    views/                 one module per section, each handed its mount points
  data/                    generated payload (index + per-ticker series)

sp500_cache.py           two-stage pipeline: fetch (network) → derive (offline)
kmv_engine.py            EM asset recovery, DD, EDF, first-passage PD, TiC/CCM
ttc_conversion.py        PIT → TTC on the S&P scale (Table 8, No-Regulatory-Arbitrage)
rating_inputs.py         raw API payloads → per-day model inputs
app/                     FastAPI service for rating a single ticker live
design_prototypes/       four aesthetic directions explored before picking one
```

The front end is a **static site**: no framework, no bundler, no runtime
dependency beyond two webfonts. Everything it shows was computed offline by
`sp500_cache.py` and written to `web/data/`.

## The dashboard

**01 Search** — type a symbol or a company name; `/` focuses the field from
anywhere, `↑↓` picks, `⏎` loads. Exact symbol matches rank above name matches, so
`KO` never buries Coca-Cola. Underneath sit the twelve largest constituents by
market value as quick picks, computed from the data rather than hard-coded.

**02 Rating** — pick the trading day. The model is evaluated on every day in the
calibration window, so the date is the reader's, not the build's; the chosen date
is the loudest thing in the control because it is what changes the answer. Below
it: the letter, six figures with their change, and the conversion chain
`CCM → RS → FP_PD → α → SP_CCM → SP_PD → letter`.

**03 Compare** — pick any earlier trading day and see what moved: both letters,
the notch distance, and whether the move came from the asset value or from the
barrier. The calibration is shared across dates, so a change here is a change in
A, D and E — never in the volatility assumption.

**04 Price** — interactive daily candlesticks over 1M / 3M / 6M / all. Hollow
bodies closed up, solid bodies closed down, volume beneath; hover or drag for a
per-day OHLC readout. These are raw split-adjusted bars, while the model
calibrates on dividend-adjusted closes — different series, and the caption says so.

**05 Entries** — every field the model emits, at the two selected dates, with the change
and a direction that knows which way is good news. The table iterates the field
inventory in `js/fields.js`, so it is complete by construction.

**06 Diagnostics** — six plates: distance-to-default dumbbells and rating
migration across a sector peer set of similar size, the three probability
measures on a log axis, asset against equity, EM convergence, and the model's own
asset / equity / default-point paths.

**07 Reading** — plain language assembled in the browser from the figures already
on screen. Not a language-model call, and it introduces no number the tables do not show.

**08 Index** — all 503 constituents: filter, sort any column, click through. The
strip above is the rating distribution across the 27 notches.

**09 Appendix** — provenance, per-day model inputs, the whole grid, and the names
the model could not rate with the reason for each.

## The data pipeline

```bash
python3 sp500_cache.py fetch                      # ~25 min, 8 workers, 2012 API calls
python3 sp500_cache.py derive --data-out web/data # ~8 s, offline
```

`fetch` pulls four endpoints per constituent, attaches the shared FRED DGS1 and
SOFR series, and writes one raw capture per ticker. It is resumable — existing
captures are skipped — and retries transient TLS resets, which are the dominant
failure mode under concurrency (22% of tickers needed one on the last full run).

`derive` re-runs the engine over those captures offline and writes the deployable
payload. Money stays in the workbook's unit (thousands of USD); probabilities
below 1e-3 % print in exponential form rather than rounding to zero.

**One calibration per company.** `AssetVol`, `AssetRet` and `StockVol` are fitted
once over the current window and reused for both snapshots — the course
workbook's own structure. Re-calibrating on the earlier window instead lets `R_A`
drift, and since `mu = ln(A/D)/|R_A|`, KO's implied life expectancy came out at
211 years against the workbook's 6.6 before this was fixed.

| Payload | Size | Gzipped |
|---|---|---|
| `data/index.json` — 503 rows, both snapshots | 408 KB | 100 KB |
| `data/series/{TICKER}.json` — EM history, model paths, the rating re-evaluated on every day in the window, 275 daily bars | 40 KB each | 13 KB each |
| raw captures (git-ignored, regenerable) | 65 MB | — |

The index loads once; series load lazily on selection and are cached for the
session, so a cold visit never pays for 498 of them.

## Reconciliation against the course workbook

Re-running the engine at `window=150` reproduces the professor's answer workbook
closely — KO calibrates to `AssetVol` 16.3242% against 16.3499%, `AssetRet`
+0.2474 against +0.2470, with `mu`, `ccm` and `dd` inside 2%. Two differences are
known and deliberate:

- **Top-of-table clamp.** `sp_ttc_pd` clamps at S&P Table 8's best anchor
  (PD 0.0001), while the workbook floors at 0.0002, and the workbook also floors
  `CCM*` at 0.3 where this implementation solves freely below it. Letters agree;
  the printed `SP_PD` differs by 2× on the highest grades, which is 93 of the 498
  names. See the comment block in `ttc_conversion.py`.
- **Financials.** Bank and insurer debt bases are the known soft spot — PNC
  calibrates to σ_A 6.16% here against 6.62% in the workbook, and Financials carry
  the lowest median DD of any sector (4.32 across 75 names). Treat the sector's
  absolute levels with suspicion; the relative ordering is more robust.

## Known limitations

- **Large-cap optimism.** Structural PIT models are systematically generous to
  large, low-volatility firms: equity ≫ default point → large DD → PD ≈ 0. 86% of
  the index prints investment grade here. That is a property of the method.
- **Cached, not live.** The dashboard reads a snapshot taken on 2026-07-30.
  Refreshing it means re-running the pipeline; the site has no server.
- **`AAA-` is not a real S&P notch.** It is what the course's fine-notched scale
  emits, reproduced verbatim so the interface never disagrees with the model.
- **Five constituents cannot be rated** — newly listed or spun-off entities with
  no quarterly balance sheet under their current symbol. They are listed with
  their reason rather than hidden.

## Tests

```bash
python3 -m pytest -q
```

Engine tests plus the `serialize` / `pipeline` / `llm` / `api` layers, with the
market-data API and the LLM mocked so tests never hit the network.
