# Style prototypes — KMV / TiC rating front end

Four aesthetic directions for the same interface, all running on real data extracted from
`TiC Rating(Prof 更新).xlsx`. Open `index.html` to compare, pick one, and the rest get deleted.

## Run

```bash
python3 -m http.server 8139 --directory design_prototypes
```

Then open <http://localhost:8139/index.html>. (Also registered as the `design-prototypes` config in
`.claude/launch.json`.) A plain `file://` open works too — the scripts are classic, not modules.

## Files

| File | What it is |
|---|---|
| `index.html` | Comparison page, one entry per direction |
| `01-broadsheet.html` | Financial broadsheet — Instrument Serif / Newsreader, warm paper, oxblood |
| `02-swiss.html` | Swiss grid — Archivo / Archivo Black, cool white, vermilion |
| `03-blueprint.html` | Drafting sheet — IBM Plex Sans Condensed / Mono, pale blueprint, rust |
| `04-specimen.html` | Archival specimen — Fraunces / Spectral, ivory, botanical green |
| `tic-data.js` | **Generated** from the workbook. Do not hand-edit; regenerate (see below) |
| `tic-series.js` | **Generated** by re-running the KMV engine offline over the cached raw API captures — the EM σ history and the per-day asset / equity / default-point paths, which the workbook does not carry |
| `tic-lib.js` | Shared, theme-agnostic layer: field inventory, formatters, SVG chart builders |

## The shared layer

`tic-lib.js` is what keeps four skins honest:

- `TIC.HEADER_FIELDS`, `TIC.CALIB_FIELDS`, `TIC.SNAP_FIELDS` — the canonical, ordered inventory of every entry in
  the workbook. Each theme *iterates* these lists, so a skin cannot silently drop a column.
- `TIC.fmt` — formatters. `moneyK` accounts for the workbook filing money in thousands; `pct` switches to
  exponential below 1e-3 % instead of rounding 2.66e-22 down to `0.0000%`.
- `TIC.deltaInfo(field, cur, prior)` — the change between snapshots plus a direction class that already knows
  whether up or down is the good news (a higher `DD` is good, a higher `SP_PD` is not).
- `TIC.charts.{dd,migration,pd,ae,em,paths}` — SVG builders that emit geometry with semantic classes
  (`.ch-grid`, `.ch-conn.ch-up`, `.ch-bar-a`, `.ch-line-d`, …). Each theme restyles the same charts entirely in CSS.
  `em` and `paths` read `TIC_SERIES` and return `null` when a name has no series, so themes can render an empty
  state instead of a broken frame (AMZN is the live example).
- `TIC.series(ticker)` — the engine-derived series for one name, or `null`.

Six plates per theme: four cross-sectional or two-date views the workbook supports directly (DD dumbbell, rating
migration, PD log strip, asset-vs-equity bars), plus two the engine supplies (EM convergence, and the asset /
equity / default-point paths over the 150-day window).

## Regenerating the data

```bash
python3 - <<'PY'
import openpyxl, json
wb = openpyxl.load_workbook('TiC Rating(Prof 更新).xlsx', data_only=True)
ws = wb['Sheet1']
cell = lambda r, c: ws.cell(row=r, column=c).value
cos = []
for c in range(1, ws.max_column + 1, 2):
    if cell(1, c) is None:
        continue
    d = {'name': str(cell(1, c)).split(' (')[0], 'ticker': str(cell(2, c)), 'quote': cell(2, c + 1),
         'asof': str(cell(1, c + 1))[:10], 'window': cell(3, 1), 'assetVol': cell(4, c + 1),
         'assetRet': cell(5, c + 1), 'stockVol': cell(6, c + 1), 'snaps': []}
    for base, dr in ((7, 0), (26, 19)):          # current block, then the prior block 19 rows down
        s = {'date': str(cell(base, c + 1))[:10]}
        for k, row in [('asset', 8), ('marketCap', 9), ('price', 10), ('mu', 11), ('ccm', 12), ('rs', 13),
                       ('fpPd', 16), ('alpha', 17), ('spCcm', 18), ('spPd', 19), ('spRating', 20),
                       ('dd', 21), ('edf', 22), ('outlook', 23)]:
            s[k] = cell(row + dr, c + 1)
        d['snaps'].append(s)
    cos.append(d)
open('design_prototypes/tic-data.js', 'w').write(
    'window.TIC_DATA = ' + json.dumps(cos, ensure_ascii=False, separators=(',', ':'), default=str) + ';\n')
PY
```

And for `tic-series.js`, which re-runs the engine over the cached captures:

```bash
python3 - <<'PY'
from pathlib import Path
import json, sys
sys.path.insert(0, '.')
from rating_inputs import rate_from_sample

sig = lambda v, n=7: None if v is None else float(f"%.{n}g" % v)
out = {}
for p in sorted(Path('massive_api_raw_samples_20260730/massive_api_raw_samples').glob('*.json')):
    b, em = rate_from_sample(p, window=150)          # window=150 matches the workbook
    if em is None:
        out[b.ticker] = {"unavailable": b.unrateable_reason}
        continue
    out[b.ticker] = {
        "iterations": em.iterations, "converged": bool(em.converged),
        "sigmaA": sig(em.sigma_a), "sigmaE": sig(em.sigma_e), "rA": sig(em.r_a),
        "sigmaHistory": [sig(v) for v in em.sigma_history],
        "dates": [d.date for d in b.days],
        "equity": [sig(d.equity / 1e3, 6) for d in b.days],   # thousands, as in the workbook
        "asset": [sig(a / 1e3, 6) for a in em.assets],
        "debt": [sig(d.debt / 1e3, 6) for d in b.days],
    }
Path('design_prototypes/tic-series.js').write_text(
    'window.TIC_SERIES = ' + json.dumps(out, separators=(',', ':')) + ';\n')
PY
```

Workbook layout, for reference: each company occupies two columns; row 1 holds the name and the current snapshot
date, row 2 the ticker and last quote, row 3 the window in days, rows 4–6 the calibration, rows 7–23 the current
snapshot, and rows 26–42 the same block for the prior date. Row 15's `RS` duplicates row 13 and is ignored.

## Known gaps

- Only issuer selection is wired. Live ticker entry, the methodology knobs and the `/api/explain` call are drawn
  but inert — the generated commentary is assembled from the numbers in the browser, not from the LLM.
- The backend (`app/pipeline.py`, `app/serialize.py`) emits one snapshot per request, not the two-date pair the
  workbook uses. Whichever direction wins, that shape has to be added before the UI can go live.
- `tic-series.js` is a frozen offline re-run, not live output. In production these two plates read
  `intermediate.em.sigma_history` and `intermediate.assets` / `intermediate.day_inputs`, which
  `app/serialize.py` already ships — no engine work needed, only wiring.
- AMZN has no series: the 2026-07-30 capture returned no daily prices. Re-pull that sample to fill it in.
- Re-running the engine at `window=150` reproduces the workbook's calibration to within 0.01–0.78 pp of σ_A
  (KO is the widest at +0.78 pp). Close enough to cross-validate both, wide enough to be worth chasing if the two
  are ever shown side by side as if identical.
