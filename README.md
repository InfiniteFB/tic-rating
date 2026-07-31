# TiC Rating — structural credit ratings for the S&P 500

Type a ticker, read a credit rating. The rating is not looked up from an agency —
it is computed from market equity and balance-sheet debt with a Merton/KMV
structural model, then converted from a point-in-time probability of default to a
through-the-cycle letter on the S&P scale.

497 of the 503 S&P 500 constituents are pre-computed and cached, with **a
decade of rating history**: daily resolution over the last two years, weekly
back to 2017, each point fitted on its own trailing calibration window — so an
earlier date shows the rating that was observable then, not today's volatility
read backwards. The calibration window itself (90 / 150 / 250 trading days) is
a knob on every company page.

```bash
python3 devserve.py                             # the site on :8143, no build step
python3 -m uvicorn app.main:app --port 8137     # optional: the live single-ticker API
```

Three pages. `/` is the **dashboard**: search, a watchlist that starts as the
course workbook's ten names and is then yours to edit, one pair of dates every
figure obeys (sliders share one fixed axis, so neither thumb ever jumps because
the other moved), four figures — the list's DD, its migration, a decade of its
letters, and the whole universe as a rating-by-size scatter — and the full
universe table underneath. `/t.html#TICKER` is **one company**: rating with a
date slider, ten years of rating history with the window knob, the workings,
price candles (daily to 1Y, weekly to Max), single-name diagnostics, a plain
reading, a side-by-side of up to four companies, and that name's appendix.
`/method.html` is **the method**: nine sections from "why compute a rating at
all" to the letter, every formula the engine's own form, every figure drawn
from the site's cached output — Prof. Yimin Yang's TiC framework, taught with
real data.

Every number on the company page can explain itself: each row of the workings
table and each hop of the conversion chain carries a red **+** that opens the
general formula with that day's values substituted, and links into the method
page section that teaches it. The formulas live in one module
(`js/derivations.js`), so the taught form and the worked instance can never
drift apart. Dragging the date slider live-updates the substituted numbers.

Deep price history comes from Yahoo's chart API (key-less; its adjclose matches
Massive's dividend-adjusted close to 0.0001% on the overlap), fundamentals and
the recent window from Massive, share counts quarterly from income statements —
so a 2017 market cap uses 2017's float, not today's.

## What is in here

```
web/                     the site — static, dependency-free, ES modules
  index.html               the dashboard: search, watchlist, dates, index
  t.html                   one company: rating, workings, price, diagnostics
  method.html              the method, taught with the site's own data
  styles/                  tokens → base → layout → components → candles → method
  js/
    dashboard.js           bootstrap for the dashboard
    ticker.js              bootstrap for a company page
    method.js              bootstrap for the method page
    store.js               the only module that knows where data comes from
    fields.js              canonical inventory of every model field + the S&P scale
    formula.js             HTML formula primitives — serif math, no dependencies
    derivations.js         every field's formula, general and with the day's numbers
    format.js              money in thousands, probabilities down to 1e-27
    charts.js              six analytic plates, as SVG strings
    methodCharts.js        the method page's figures (payoff, g-curve, barrier, …)
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

## The two pages

**The dashboard** (`/`). A search field; a watchlist that starts as the course
workbook's ten names but belongs to the reader — add any constituent, drop any
row, and the choice survives a reload; one pair of dates that every figure on the
page obeys; and the whole index underneath, filterable and sortable. Every ticker
and company name is a link to its own page.

**A company page** (`/t.html#TICKER`). Only this name's material, and the
calculation leads:

1. **Rating** — pick the trading day. The letter, six figures with their change,
   and the date set in the accent because it is what changes the answer.
2. **Workings** — the conversion chain `CCM → RS → FP_PD → α → SP_CCM → SP_PD →
   letter`, then every field the model emits at both selected dates. The table
   iterates the inventory in `js/fields.js`, so it is complete by construction.
3. **Price** — interactive daily candlesticks over 1M / 3M / 6M / all. Hollow
   bodies closed up, solid closed down, volume beneath, per-day OHLC on hover.
   Raw split-adjusted bars, while the model calibrates on dividend-adjusted
   closes — different series, and the caption says so.
4. **Diagnostics** — six plates, all drawn at the two selected dates: DD and
   rating migration across a sector peer set, the three probability measures on a
   log axis, asset against equity, EM convergence, and the model's own paths.
5. **Reading** — plain language assembled in the browser from the figures above.
6. **Compare** — any earlier trading day: both letters, the notch distance, and
   whether the move came from asset value or from the barrier.
7. **Appendix** — this company's provenance and its per-day model inputs.
   Index-wide provenance lives on the dashboard, not here.

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

**A calibration for every day.** Each evaluated day is fitted on the `window`
trading days ending at that day, so `AssetVol`, `AssetRet` and `StockVol` are
series rather than constants. The newest day's fit is exactly the single
calibration the course workbook uses, which is where the reconciliation below was
measured — but an earlier date now carries the volatility that was observable
then, instead of one borrowed from the future.

The alternative, sharing today's calibration across every date, was tried first
and is subtly wrong in both directions: it reads a future volatility backwards,
and if you instead re-fit only the earlier window in isolation, `R_A` drifts
enough that `mu = ln(A/D)/|R_A|` blows up — KO's implied life expectancy came out
at 211 years against the workbook's 6.6.

**Two years is the ceiling.** The price feed on this subscription returns the
last ~501 trading days and refuses a purely historical window outright (`HTTP
403`), so a longer history is not a matter of asking for more. With a 150-day
calibration window that leaves ~352 days of rated history per name.

| Payload | Size | Gzipped |
|---|---|---|
| `data/index.json` — 503 rows, latest plus a default comparison | 408 KB | 100 KB |
| `data/series/{TICKER}.json` — the rating re-evaluated on every trading day with its own calibration, plus 501 daily bars | 86 KB each | 29 KB each |
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
- **Six constituents cannot be rated** — newly listed or spun-off entities with
  no quarterly balance sheet under their current symbol. They are listed with
  their reason rather than hidden.

## Tests

```bash
python3 -m pytest -q
```

Engine tests plus the `serialize` / `pipeline` / `llm` / `api` layers, with the
market-data API and the LLM mocked so tests never hit the network.
