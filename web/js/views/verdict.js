/* ═══════════════════════════════════════════════════════════════════════
   views/verdict.js — the answer, before any of the workings: the letter,
   four figures that justify it, one sentence of context, and the full
   PIT → TTC conversion chain.
   ═══════════════════════════════════════════════════════════════════════ */

import { esc, moneyK, num, pct } from "../format.js";
import { CHAIN, SNAP_FIELDS, deltaInfo, isIG, outlook } from "../fields.js";

const KPIS = ["dd", "spPd", "fpPd", "edf", "rs", "mu"];
const field = (key) => SNAP_FIELDS.find((f) => f.key === key);

export function renderVerdict(mount, row, cur, prior) {
  if (!row) {
    mount.innerHTML = "";
    return;
  }

  if (!row.snaps) {
    mount.innerHTML = `
      <div class="verdict__mark">
        <div class="verdict__letter spec">n/a</div>
        <div class="verdict__bar"></div>
        <div class="verdict__meta"><span>not rateable</span></div>
      </div>
      <div class="verdict__kpis">
        <div class="kpi" style="grid-column:1/-1;border-right:0">
          <span class="label">Why</span>
          <span class="kpi__v" style="font-size:1.05rem;font-family:var(--sans)">${esc(row.unrateable_reason)}</span>
          <div class="kpi__d">${esc(row.name)} is in the index, but the model cannot be evaluated on the
            cached data — most often a newly listed or spun-off entity whose quarterly balance sheet has not
            been filed under this symbol yet.</div>
        </div>
      </div>`;
    return;
  }

  if (!cur) {
    mount.innerHTML = "";
    return;
  }
  const look = outlook(cur.outlook);
  const wedge = cur.asset - cur.marketCap;
  const coverage = wedge ? cur.asset / wedge : NaN;

  const kpis = KPIS.map((key) => {
    const f = field(key);
    const delta = deltaInfo(f, cur[key], prior?.[key]);
    return `<div class="kpi">
      <span class="label">${f.label}</span>
      <span class="kpi__v">${f.f(cur[key])}</span>
      <div class="kpi__d ${delta.cls}">${delta.text} vs ${esc(prior?.date ?? "prior")}</div>
    </div>`;
  }).join("");

  mount.innerHTML = `
    <div class="verdict__mark">
      <div class="verdict__letter ${isIG(cur.spRating) ? "" : "spec"}">${esc(cur.spRating)}</div>
      <div class="verdict__bar"></div>
      <div class="verdict__meta">
        <span>S&amp;P scale · fine notch</span>
        <span class="verdict__date">${esc(cur.date)}</span>
        <span>${isIG(cur.spRating) ? "investment grade" : "speculative grade"}</span>
        <span class="${look.cls}">${look.sym} ${look.label} outlook</span>
      </div>
    </div>
    <div class="verdict__kpis">${kpis}</div>
    <div class="verdict__lede">
      <p><b>${esc(row.name)}</b> holds assets of <b>${moneyK(cur.asset)}</b> against equity of
      <b>${moneyK(cur.marketCap)}</b> — an implied debt wedge of <b>${moneyK(wedge)}</b> and
      <b>${num(coverage, 2)}×</b> asset coverage. Asset volatility calibrates to <b>${pct(row.assetVol)}</b>
      against <b>${pct(row.stockVol)}</b> observed on the equity, with drift <b>${num(row.assetRet, 4)}</b>
      over a <b>${row.window}-day</b> window, leaving <b>${num(cur.dd, 3)}</b> standard deviations of clearance
      to the default barrier.</p>
    </div>`;
}

export function renderChain(mount, row, cur) {
  if (!row?.snaps || !cur) {
    mount.innerHTML = "";
    mount.hidden = true;
    return;
  }
  mount.hidden = false;
  mount.innerHTML = CHAIN.map((hop) => `<div>
      <span class="label">${hop.label}</span>
      <span class="chain__v">${esc(hop.f(cur[hop.key]))}</span>
    </div>`).join("");
}
