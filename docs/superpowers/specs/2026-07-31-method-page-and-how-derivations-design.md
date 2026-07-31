# Method page & per-number derivations — design

2026-07-31 · approved direction: 方法讲解页 + 公司页逐数字 How? 溯源（通式-实例联动）。
知识底座：`knowledge/`（论文/课件/纪要精读笔记，含课件矛盾清单 `lecture-deck.md §6`）。

## Shared spine: one source of formulas, two consumers

`web/js/formula.js` — tiny HTML formula primitives (fraction, sub/sup, √, Φ), site-font, zero deps.
`web/js/derivations.js` — the canonical map `key → {title, formula(), plugged(snap), note, anchor}`
for every SNAP/CALIB field and chain hop. `formula()` renders the general form; `plugged(snap)`
renders the same structure with the day's real numbers substituted. Anchors point into method.html.
The method page teaches the general form; the company page opens the same entry with numbers —
the "通式-实例联动".

Numeric truth: formulas follow `kmv_engine.py` / `ttc_conversion.py` (paper is authority;
known deck discrepancies — √250 annualisation, s112 TiC, s113 missing TTC chapter — are
footnoted, never reproduced). All inputs needed for substitution exist on `snapshotAt()`
snapshots (asset, debt, rate, mu, ccm, rsSp, alpha, …).

## A. `web/method.html` — the method, told with real data

Same frame as t.html (rail / mast / numbered sections). Article typography (`styles/method.css`),
figures reuse the charts.js SVG-string idiom (semantic classes, CSS colours). Live data: KO series
(course workbook lead) + one volatile name for the PIT section; hardcoded historical table for §1.

1. **Why compute a rating** — SEC 2012 "seems impossible"; Moody's B PD 0.0–9.8% (Table 1,
   hardcoded); "one IBM" no-data problem. Figure: B-rated PD by year bars.
2. **Equity is a call option** — s55 three-quantities problem; Merton. Figure: payoff geometry.
3. **Inverting the option** — BSM equity eq → normalised g(x,σ,τ), monotone → bisection.
   Figure: g curve with the day's (z → x) solve marked, KO numbers.
4. **EM calibration** — one equation two unknowns; classic second equation "less stable"; E/M
   steps. Figures: reuse `chartEM` + `chartPaths` on KO.
5. **Distance to default** — R_A (annualised, footnote the √250 fix), DD; "η_A makes both
   unstable". Figure: lognormal asset fan vs default point, DD arrow, KO numbers.
6. **From distance to probability** — EDF=Φ(−DD) (maturity-only) vs first-passage PD (eq 13,
   barrier). Figure: two designed paths — one ends above D but crosses the barrier mid-way.
7. **The problem with PIT** — KMV three sins (s71); procyclicality. Figure: ten years of a
   volatile name — PIT DD wiggles vs TTC letter steps (history data, weekly).
8. **The TTC conversion** — TiC = σ²/ln²(A/D): η cancels ⇒ Girsanov-invariant (the *mechanism*
   of stability); CCM & μ; equal-confidence CL_FH(CCM)=CL_SP(CCM*); Table 8; fine scale;
   outlook = PD_FH − TTC (mean-reversion reading). Figures: the day's real conversion chain
   (chain visual) + Table 8 anchors on a log-RS strip with KO's landing point.
9. **Honest limitations** — big-cap optimism (T: model AAA vs agency ~BBB); deck discrepancy
   footnotes (link knowledge base); default-ratings-only (no LGD); "AAA-" fine-scale artifact.

Rail on all three pages gains a "Method" link.

## B. Company-page How? (t.html workings + chain)

- `entries.js`: every row label gets a `+` toggle (fold visual language: red +/−,
  aria-expanded). Opens an inserted `tr.derive` under the row: general formula → "with
  2026-07-30's numbers" plugged row → one-line note → "Read the method →" anchor link.
- `verdict.js` chain hops become the same toggles (derivation panel mounts under the chain).
- Open-state survives repaints (module-level open-set keyed by field; date-slider moves
  re-render the plugged numbers live).
- Solve-type quantities (asset via bisection, alpha/spCcm via root-finding) render as the
  equation being solved + "solved numerically" — no fake closed forms.

## Errors & edge cases

- Missing series / unrateable names: How? buttons render only when `cur` exists (same guard
  entries.js already uses); method.html falls back to a static note if KO series fetch fails
  (each figure's builder already returns null → honest empty state).
- No new deps, no build step; ES modules only.

## Verification

devserve :8143 → both pages: console clean, figures render on live data, How? toggles open/
close/persist across date drags, method anchors land. Screenshot proof. Python tests untouched.
