/* ═══════════════════════════════════════════════════════════════════════
   views/verdict.js — the answer, before any of the workings.

   The letter, six figures a reader checks first — where the price closed,
   what the equity is worth, what money costs, and the three numbers the
   letter actually rests on — then one sentence of context. The scale the
   letter is read off sits behind a small reference toggle, so "AA-" is never
   a claim the page cannot substantiate on the spot.
   ═══════════════════════════════════════════════════════════════════════ */

import { esc, moneyK, num, pct, usd } from "../format.js";
import { CHAIN, FINE_SCALE, SNAP_FIELDS, deltaInfo, isIG, outlook } from "../fields.js";

const field = (key) => SNAP_FIELDS.find((f) => f.key === key);

/** close and day-move at (or just before) the snapshot date */
function closeAt(series, iso) {
  const bars = series?.ohlc;
  if (!bars?.dates?.length || !iso) return null;
  let i = bars.dates.length - 1;
  while (i >= 0 && bars.dates[i] > iso) i -= 1;
  if (i < 0) return null;
  const close = bars.c[i];
  const prev = i > 0 ? bars.c[i - 1] : null;
  const move = prev ? (close - prev) / prev : null;
  return { date: bars.dates[i], close, move };
}

function scaleCard(letter, spPd) {
  const rows = FINE_SCALE.map(([grade, floor], i) => {
    const ceil = FINE_SCALE[i + 1]?.[1];
    const bound = ceil === undefined ? `≥ ${pct(floor)}` : `${pct(floor)} – ${pct(ceil)}`;
    return `<tr class="${grade === letter ? "is-here" : ""}">
      <td class="${isIG(grade) ? "" : "spec"}">${esc(grade)}</td><td>${bound}</td></tr>`;
  }).join("");
  return `<div class="scalecard" role="dialog" aria-label="The rating scale">
    <div class="scalecard__head">The fine S&amp;P scale the letter is read off —
      buckets of through-the-cycle PD, closed-left / open-right.
      This name's SP_PD of <b>${pct(spPd)}</b> lands on the highlighted row.</div>
    <table><thead><tr><th>Grade</th><th>SP_PD bucket</th></tr></thead>
      <tbody>${rows}</tbody></table>
  </div>`;
}

export function renderVerdict(mount, row, cur, prior, series) {
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
          <div class="kpi__d">${esc(row.name)} is in the universe, but the model cannot be evaluated on the
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
  const bar = closeAt(series, cur.date);
  const vs = esc(prior?.date ?? "one window ago");

  const modelKpi = (key, label = null) => {
    const f = field(key);
    const delta = deltaInfo(f, cur[key], prior?.[key]);
    return `<div class="kpi">
      <span class="label">${label ?? f.label}</span>
      <span class="kpi__v">${f.f(cur[key])}</span>
      <div class="kpi__d ${delta.cls}">${delta.text} vs ${vs}</div>
    </div>`;
  };

  const kpis = [
    // where the stock closed on the rating date, with the day move
    `<div class="kpi">
      <span class="label">Close · ${esc(bar?.date ?? cur.date)}</span>
      <span class="kpi__v">${bar ? usd(bar.close) : "—"}</span>
      <div class="kpi__d ${bar?.move > 0 ? "up" : bar?.move < 0 ? "down" : "flat"}">
        ${bar?.move == null ? "no prior bar" : `${bar.move > 0 ? "+" : "−"}${Math.abs(bar.move * 100).toFixed(2)}% on the day`}
      </div>
    </div>`,
    modelKpi("marketCap"),
    `<div class="kpi">
      <span class="label">Risk-free · 1y</span>
      <span class="kpi__v">${cur.rate != null ? pct(cur.rate) : "—"}</span>
      <div class="kpi__d flat">FRED DGS1 on the rating date</div>
    </div>`,
    modelKpi("dd"),
    modelKpi("spPd"),
    `<div class="kpi">
      <span class="label">RS_SP</span>
      <span class="kpi__v">${num(cur.rsSp, 4)}</span>
      <div class="kpi__d flat">the score Table 8 is read with — not RS = 100·TiC</div>
    </div>`,
  ].join("");

  mount.innerHTML = `
    <div class="verdict__mark">
      <div class="verdict__tk">${esc(row.ticker)}</div>
      <div class="verdict__letterrow">
        <div class="verdict__letter">${esc(cur.spRating)}</div>
        <button class="verdict__why" type="button" aria-expanded="false"
          aria-label="Show the rating scale">i</button>
        ${scaleCard(cur.spRating, cur.spPd)}
      </div>
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
      <p><b>${esc(row.legalName ?? row.name)}</b> holds assets of <b>${moneyK(cur.asset)}</b> against equity of
      <b>${moneyK(cur.marketCap)}</b> — an implied debt wedge of <b>${moneyK(wedge)}</b> and
      <b>${num(coverage, 2)}×</b> asset coverage. Asset volatility calibrates to <b>${pct(cur.assetVol ?? row.assetVol)}</b>
      against <b>${pct(cur.stockVol ?? row.stockVol)}</b> observed on the equity, leaving
      <b>${num(cur.dd, 3)}</b> standard deviations of clearance to the default barrier.</p>
    </div>`;

  // the reference card toggles on click and stays; a click anywhere else
  // dismisses it — hover-only popovers die the moment the pointer travels
  const why = mount.querySelector(".verdict__why");
  const card = mount.querySelector(".scalecard");
  why.addEventListener("click", () => {
    const open = !card.classList.contains("is-open");
    card.classList.toggle("is-open", open);
    why.setAttribute("aria-expanded", String(open));
    if (open) {
      const here = card.querySelector(".is-here");
      if (here) card.scrollTop = Math.max(0, here.offsetTop - card.clientHeight / 2);
    }
  });
  installDismiss();
}

/** one document-level listener for every card this page will ever render —
 *  re-registering per repaint would leak a handler on each date drag */
let dismissInstalled = false;
function installDismiss() {
  if (dismissInstalled) return;
  dismissInstalled = true;
  document.addEventListener("click", (event) => {
    if (event.target.closest(".scalecard, .verdict__why")) return;
    for (const open of document.querySelectorAll(".scalecard.is-open")) {
      open.classList.remove("is-open");
      open.parentElement?.querySelector(".verdict__why")?.setAttribute("aria-expanded", "false");
    }
  });
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
