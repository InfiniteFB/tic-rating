/* ═══════════════════════════════════════════════════════════════════════
   views/diagnostics.js — six plates. Four read the index payload (two of
   them across a sector peer set), two read the per-ticker series. Each
   builder returns null when its data is absent, and the empty state says
   which input is missing instead of leaving a blank frame.
   ═══════════════════════════════════════════════════════════════════════ */

import { esc, pct } from "../format.js";
import { chartAE, chartDD, chartEM, chartMigration, chartPD, chartPaths } from "../charts.js";
import { peers } from "../store.js";

const empty = (subject, missing) =>
  `<div class="plate__empty"><b>Not plottable for ${esc(subject)}.</b> ${missing}</div>`;

function plate(mount, capMount, svg, caption, fallback) {
  mount.innerHTML = svg ?? fallback;
  capMount.innerHTML = caption;
}

/**
 * @param cur/prior  the snapshot pair the reader selected, not the pair the
 *                   build froze — every plate is drawn at those two dates
 * @param peerRows   cohort already evaluated at the same two dates
 */
export function renderDiagnostics(root, row, series, status, cur, prior, peerRows) {
  if (!row) return;
  const cohort = peerRows ?? peers(row, 12);
  const sector = esc(row.sector ?? "the index");
  const tk = esc(row.ticker);
  // the charts read `snaps`, so hand them a view of this row at the chosen dates
  const dated = cur ? { ...row, snaps: [cur, prior] } : row;
  const dateA = esc(prior?.date ?? "the earlier date");
  const dateB = esc(cur?.date ?? "the later date");

  plate(
    root.querySelector("#p-dd"),
    root.querySelector("#c-dd"),
    chartDD(cohort),
    `<b>Fig 01</b> Distance to default across ${cohort.length} ${sector} names of similar size,
     at <b>${dateA}</b> (hollow) and <b>${dateB}</b> (filled). Red means the name moved toward the barrier.`,
    empty(tk, "No peer set with a computed DD.")
  );

  plate(
    root.querySelector("#p-mig"),
    root.querySelector("#c-mig"),
    chartMigration(cohort),
    `<b>Fig 02</b> Rating migration for the same peer set between <b>${dateA}</b> and <b>${dateB}</b>,
     on notch position. The dashed rule is the investment-grade boundary.`,
    empty(tk, "Peers do not carry a rating at both selected dates.")
  );

  plate(
    root.querySelector("#p-pd"),
    root.querySelector("#c-pd"),
    chartPD(dated),
    `<b>Fig 03</b> ${tk}: FP_PD, SP_PD and EDF on a log axis at <b>${dateB}</b>, hollow at <b>${dateA}</b>.
     The three answer different questions, so decades of separation are expected rather than an error.`,
    empty(tk, "No probability measures at the selected date.")
  );

  plate(
    root.querySelector("#p-ae"),
    root.querySelector("#c-ae"),
    chartAE(dated),
    `<b>Fig 04</b> ${tk}: asset value against market capitalisation at <b>${dateA}</b> and <b>${dateB}</b>.
     The gap is the debt the model places in the barrier.`,
    empty(tk, "No asset or equity value at the selected date.")
  );

  const loading = status === "loading";
  const emSvg = loading ? null : chartEM(series);
  const pathSvg = loading ? null : chartPaths(series);
  const seriesMissing = loading
    ? `<div class="is-loading">loading series…</div>`
    : empty(tk, "The cached capture carries no per-day price series, so the engine cannot be re-run for it.");

  plate(
    root.querySelector("#p-em"),
    root.querySelector("#c-em"),
    emSvg,
    emSvg
      ? `<b>Fig 05</b> EM calibration: σ_A per iteration, settling at <b>${pct(series.sigmaA)}</b> after
         ${series.iterations} iteration${series.iterations === 1 ? "" : "s"}${series.converged ? "" : " (iteration cap)"}.
         Short by nature — the fixed point arrives in a handful of updates.`
      : `<b>Fig 05</b> EM calibration. Needs the per-day price series.`,
    seriesMissing
  );

  plate(
    root.querySelector("#p-paths"),
    root.querySelector("#c-paths"),
    pathSvg,
    pathSvg
      ? `<b>Fig 06</b> ${tk} across ${series.dates.length} trading days: recovered asset value, equity, and the
         default point stepping on quarter ends. That vertical clearance, over σ_A, is DD.`
      : `<b>Fig 06</b> Asset, equity and default-point paths. Needs the per-day price series.`,
    seriesMissing
  );
}
