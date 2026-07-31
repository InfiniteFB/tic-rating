/* ═══════════════════════════════════════════════════════════════════════
   views/diagnostics.js — four plates about this one name, every one of them
   answering to the pointer.

   The old probability strip (three dots on a log axis) mostly showed
   underflow for safe names and told the reader nothing they could act on;
   its slot now holds the daily distance-to-default path, which is the
   number the whole model turns on. Cross-sectional plates live on the
   dashboard, where more than one name is the point.
   ═══════════════════════════════════════════════════════════════════════ */

import { esc, moneyK, num, pct, shortDate } from "../format.js";
import { chartAE, chartEM, chartPaths } from "../charts.js";
import { isIG } from "../fields.js";

const W = 520;
const H = 210;
const PAD = { l: 46, r: 14, t: 20, b: 24 };

const empty = (subject, missing) =>
  `<div class="plate__empty"><b>Not plottable for ${esc(subject)}.</b> ${missing}</div>`;

function plate(mount, capMount, svg, caption, fallback) {
  mount.innerHTML = svg ?? fallback;
  capMount.innerHTML = caption;
}

/** daily DD over the detail tail, with a crosshair readout */
function ddChart(series) {
  const dd = series?.path?.dd;
  if (!dd || dd.length < 2) return null;
  const lo = Math.min(0, ...dd) - 0.4;
  const hi = Math.max(...dd) + 0.4;
  const n = dd.length;
  const x = (i) => PAD.l + (i / (n - 1)) * (W - PAD.l - PAD.r);
  const y = (v) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  let g = "";
  for (let k = 0; k <= 4; k++) {
    const v = lo + ((hi - lo) * k) / 4;
    g += `<line class="ch-grid" x1="${PAD.l}" y1="${y(v)}" x2="${W - PAD.r}" y2="${y(v)}"/>
      <text class="ch-tick" x="${PAD.l - 5}" y="${y(v) + 3}" text-anchor="end">${num(v, 1)}</text>`;
  }
  if (lo < 0 && hi > 0) {
    g += `<line class="ch-grid ch-ig" x1="${PAD.l}" y1="${y(0)}" x2="${W - PAD.r}" y2="${y(0)}"/>
      <text class="ch-tick ch-ig-lab" x="${W - PAD.r}" y="${y(0) - 4}" text-anchor="end">the barrier</text>`;
  }
  let seen = "";
  for (let i = 0; i < n; i += Math.ceil(n / 5)) {
    const year = series.dates[i].slice(0, 7);
    if (year !== seen) {
      seen = year;
      g += `<text class="ch-tick" x="${x(i)}" y="${H - PAD.b + 13}">${esc(shortDate(series.dates[i]))}</text>`;
    }
  }
  const line = dd.map((v, i) => `${i ? "L" : "M"} ${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return `<svg viewBox="0 0 ${W} ${H}" class="ddc" role="img" aria-label="Distance to default, daily">
    ${g}<path class="ddc__line" d="${line}"/>
    <g class="ddc__cross" visibility="hidden">
      <line class="cross__line" y1="${PAD.t}" y2="${H - PAD.b}"/>
      <circle class="cross__dot" r="3.5"/>
    </g></svg>`;
}

function wireDdChart(mount, capMount, series) {
  const svg = mount.querySelector("svg.ddc");
  if (!svg) return;
  const dd = series.path.dd;
  const n = dd.length;
  const lo = Math.min(0, ...dd) - 0.4;
  const hi = Math.max(...dd) + 0.4;
  const cross = svg.querySelector(".ddc__cross");
  const base = capMount.innerHTML;
  svg.addEventListener("pointermove", (event) => {
    const box = svg.getBoundingClientRect();
    const fx = ((event.clientX - box.left) / box.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((fx - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1))));
    const px = PAD.l + (i / (n - 1)) * (W - PAD.l - PAD.r);
    const py = PAD.t + (1 - (dd[i] - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
    cross.setAttribute("visibility", "visible");
    cross.querySelector("line").setAttribute("x1", px);
    cross.querySelector("line").setAttribute("x2", px);
    cross.querySelector("circle").setAttribute("cx", px);
    cross.querySelector("circle").setAttribute("cy", py);
    const letter = series.path.spRating[i];
    capMount.innerHTML = `<b>${esc(shortDate(series.dates[i]))}</b> · DD <b>${num(dd[i], 3)}</b> ·
      <span class="${isIG(letter) ? "" : "spec"}">${esc(letter)}</span> · SP_PD ${pct(series.path.spPd[i])}`;
  });
  svg.addEventListener("pointerleave", () => {
    cross.setAttribute("visibility", "hidden");
    capMount.innerHTML = base;
  });
}

function wirePathsChart(mount, capMount, series) {
  const svg = mount.querySelector("svg");
  if (!svg || !series?.dates) return;
  const n = series.dates.length;
  const base = capMount.innerHTML;
  svg.style.cursor = "crosshair";
  svg.addEventListener("pointermove", (event) => {
    const box = svg.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.round(((event.clientX - box.left) / box.width) * (n - 1))));
    capMount.innerHTML = `<b>${esc(shortDate(series.dates[i]))}</b> ·
      Asset <b>${moneyK(series.asset[i])}</b> · Equity ${moneyK(series.equity[i])} ·
      Default point ${moneyK(series.debt[i])}`;
  });
  svg.addEventListener("pointerleave", () => {
    capMount.innerHTML = base;
  });
}

export function renderDiagnostics(root, row, series, status, cur, prior) {
  if (!row) return;
  const tk = esc(row.ticker);
  const dated = cur ? { ...row, snaps: [cur, prior] } : row;
  const dateA = esc(prior?.date ?? "one window earlier");
  const dateB = esc(cur?.date ?? "the rating date");
  const loading = status === "loading";
  const waiting = `<div class="is-loading">loading series…</div>`;

  const ddSvg = loading ? null : ddChart(series);
  plate(
    root.querySelector("#p-pd"),
    root.querySelector("#c-pd"),
    ddSvg,
    ddSvg
      ? `<b>Fig 01</b> ${tk}: distance to default, daily. Hover for the day's DD, letter and SP_PD.`
      : `<b>Fig 01</b> Distance to default, daily. Needs the per-day series.`,
    loading ? waiting : empty(tk, "No daily DD path in the capture.")
  );
  if (ddSvg) wireDdChart(root.querySelector("#p-pd"), root.querySelector("#c-pd"), series);

  plate(
    root.querySelector("#p-ae"),
    root.querySelector("#c-ae"),
    chartAE(dated),
    `<b>Fig 02</b> ${tk}: asset value against market capitalisation at <b>${dateA}</b> and <b>${dateB}</b>.
     The gap is the debt the model places in the barrier; hover a bar for its value.`,
    empty(tk, "No asset or equity value at the selected date.")
  );

  const emSvg = loading ? null : chartEM(series);
  plate(
    root.querySelector("#p-em"),
    root.querySelector("#c-em"),
    emSvg,
    emSvg
      ? `<b>Fig 03</b> EM calibration on the latest window: σ_A per iteration, settling at
         <b>${pct(series.sigmaA)}</b> after ${series.iterations} iteration${series.iterations === 1 ? "" : "s"}${series.converged ? "" : " (iteration cap)"}. Hover a marker for its value.`
      : `<b>Fig 03</b> EM calibration. Needs the per-day price series.`,
    loading ? waiting : empty(tk, "The capture carries no calibration history.")
  );

  const pathSvg = loading ? null : chartPaths(series);
  plate(
    root.querySelector("#p-paths"),
    root.querySelector("#c-paths"),
    pathSvg,
    pathSvg
      ? `<b>Fig 04</b> ${tk} across the daily tail: recovered asset value, equity, and the default point
         stepping on quarter ends. Hover for the day's three values.`
      : `<b>Fig 04</b> Asset, equity and default-point paths. Needs the per-day price series.`,
    loading ? waiting : empty(tk, "The cached capture carries no per-day series.")
  );
  if (pathSvg) wirePathsChart(root.querySelector("#p-paths"), root.querySelector("#c-paths"), series);
}
