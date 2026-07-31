/* ═══════════════════════════════════════════════════════════════════════
   views/diagnostics.js — four plates about this one name.

   Cross-sectional plates (the peer dumbbell, the migration slope) live on
   the dashboard, where more than one name is the point. Here everything is
   the subject's own: its probability measures, its balance-sheet geometry,
   its calibration, and its paths — all drawn at the selected date.
   ═══════════════════════════════════════════════════════════════════════ */

import { esc, pct } from "../format.js";
import { chartAE, chartEM, chartPD, chartPaths } from "../charts.js";

const empty = (subject, missing) =>
  `<div class="plate__empty"><b>Not plottable for ${esc(subject)}.</b> ${missing}</div>`;

function plate(mount, capMount, svg, caption, fallback) {
  mount.innerHTML = svg ?? fallback;
  capMount.innerHTML = caption;
}

export function renderDiagnostics(root, row, series, status, cur, prior) {
  if (!row) return;
  const tk = esc(row.ticker);
  const dated = cur ? { ...row, snaps: [cur, prior] } : row;
  const dateA = esc(prior?.date ?? "one window earlier");
  const dateB = esc(cur?.date ?? "the rating date");

  plate(
    root.querySelector("#p-pd"),
    root.querySelector("#c-pd"),
    chartPD(dated),
    `<b>Fig 01</b> ${tk}: FP_PD, SP_PD and EDF on a log axis at <b>${dateB}</b>, hollow at <b>${dateA}</b>.
     The three answer different questions, so decades of separation are expected rather than an error.`,
    empty(tk, "No probability measures at the selected date.")
  );

  plate(
    root.querySelector("#p-ae"),
    root.querySelector("#c-ae"),
    chartAE(dated),
    `<b>Fig 02</b> ${tk}: asset value against market capitalisation at <b>${dateA}</b> and <b>${dateB}</b>.
     The gap is the debt the model places in the barrier.`,
    empty(tk, "No asset or equity value at the selected date.")
  );

  const loading = status === "loading";
  const emSvg = loading ? null : chartEM(series);
  const pathSvg = loading ? null : chartPaths(series);
  const seriesMissing = loading
    ? `<div class="is-loading">loading series…</div>`
    : empty(tk, "The cached capture carries no per-day series for this name.");

  plate(
    root.querySelector("#p-em"),
    root.querySelector("#c-em"),
    emSvg,
    emSvg
      ? `<b>Fig 03</b> EM calibration on the latest window: σ_A per iteration, settling at
         <b>${pct(series.sigmaA)}</b> after ${series.iterations} iteration${series.iterations === 1 ? "" : "s"}${series.converged ? "" : " (iteration cap)"}.`
      : `<b>Fig 03</b> EM calibration. Needs the per-day price series.`,
    seriesMissing
  );

  plate(
    root.querySelector("#p-paths"),
    root.querySelector("#c-paths"),
    pathSvg,
    pathSvg
      ? `<b>Fig 04</b> ${tk} across the daily tail: recovered asset value, equity, and the default point
         stepping on quarter ends. That vertical clearance, over σ_A, is DD.`
      : `<b>Fig 04</b> Asset, equity and default-point paths. Needs the per-day price series.`,
    seriesMissing
  );
}
