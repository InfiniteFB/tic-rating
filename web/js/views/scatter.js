/* ═══════════════════════════════════════════════════════════════════════
   views/scatter.js — the whole universe on two axes: market value across,
   rating down. Every dot is a company; the watchlist's names are filled in
   the accent so the reader's own list is visible against the field. Hover
   names a dot, clicking one opens its page — the chart is a map, not a
   picture of one.
   ═══════════════════════════════════════════════════════════════════════ */

import { esc, moneyK, num, pct } from "../format.js";
import { SCALE, isIG, ratingIdx } from "../fields.js";

const W = 960;
const H = 380;
const PAD = { l: 44, r: 16, t: 16, b: 30 };

export function mountScatter(mount, { title = "Rating vs market value" } = {}) {
  mount.innerHTML = `
    <div class="plate__bar">
      <span class="plate__title">${esc(title)}</span>
      <div class="dctl__presets" role="group" aria-label="Scope">
        <button type="button" class="dctl__preset" data-scope="all" aria-pressed="true">S&amp;P 500</button>
        <button type="button" class="dctl__preset" data-scope="watchlist" aria-pressed="false">Watchlist</button>
      </div>
    </div>
    <div class="sc__frame"></div>`;
  const frame = mount.querySelector(".sc__frame");
  let rows = [];
  let highlight = new Set();
  let scope = "all";

  mount.querySelector("[aria-label='Scope']").addEventListener("click", (event) => {
    const button = event.target.closest("[data-scope]");
    if (!button) return;
    scope = button.dataset.scope;
    for (const b of mount.querySelectorAll("[data-scope]")) {
      b.setAttribute("aria-pressed", String(b.dataset.scope === scope));
    }
    paint();
  });

  function paint() {
    const pool = scope === "watchlist" ? rows.filter((r) => highlight.has(r.ticker)) : rows;
    draw(frame, pool, highlight);
  }

  return {
    update(nextRows, nextHighlight) {
      rows = nextRows;
      highlight = nextHighlight;
      paint();
    },
  };
}

function draw(mount, rows, highlight) {
  const rated = rows.filter((r) => r.snaps?.[0]?.marketCap > 0);
  if (rated.length < 3) {
    mount.innerHTML = `<div class="plate__empty"><b>Nothing to plot.</b></div>`;
    return;
  }
  const caps = rated.map((r) => Math.log10(r.snaps[0].marketCap * 1e3));
  const lo = Math.min(...caps);
  const hi = Math.max(...caps);
  const gLo = Math.max(0, Math.min(...rated.map((r) => ratingIdx(r.snaps[0].spRating))) - 1);
  const gHi = Math.min(SCALE.length - 1, Math.max(...rated.map((r) => ratingIdx(r.snaps[0].spRating))) + 1);

  const x = (cap) => PAD.l + ((cap - lo) / (hi - lo)) * (W - PAD.l - PAD.r);
  const y = (g) => PAD.t + ((g - gLo) / Math.max(1, gHi - gLo)) * (H - PAD.t - PAD.b);

  let grid = "";
  for (let g = gLo; g <= gHi; g++) {
    grid += `<line class="ch-grid" x1="${PAD.l}" y1="${y(g)}" x2="${W - PAD.r}" y2="${y(g)}"/>`;
    if (g % 2 === 0 || gHi - gLo < 10) {
      grid += `<text class="ch-tick ${isIG(SCALE[g]) ? "" : "spec"}" x="${PAD.l - 6}" y="${y(g) + 3}"
        text-anchor="end">${SCALE[g]}</text>`;
    }
  }
  const ig = SCALE.indexOf("BBB-") + 0.5;
  if (ig > gLo && ig < gHi) {
    grid += `<line class="ch-grid ch-ig" x1="${PAD.l}" y1="${y(ig)}" x2="${W - PAD.r}" y2="${y(ig)}"/>
      <text class="ch-tick ch-ig-lab" x="${W - PAD.r}" y="${y(ig) - 5}" text-anchor="end">investment grade ↑</text>`;
  }
  for (const decade of [10, 11, 12]) {   // $10B, $100B, $1T
    if (decade < lo || decade > hi) continue;
    const label = decade === 12 ? "$1T" : decade === 11 ? "$100B" : "$10B";
    grid += `<line class="ch-grid" x1="${x(decade)}" y1="${PAD.t}" x2="${x(decade)}" y2="${H - PAD.b}"/>
      <text class="ch-tick" x="${x(decade)}" y="${H - PAD.b + 14}" text-anchor="middle">${label}</text>`;
  }

  // jitter within the notch row so equal-rated dots do not stack into a line
  const seen = new Map();
  const dots = rated
    .map((r) => {
      const g = ratingIdx(r.snaps[0].spRating);
      const cap = Math.log10(r.snaps[0].marketCap * 1e3);
      const bucket = `${g}:${Math.round(x(cap) / 8)}`;
      const n = seen.get(bucket) ?? 0;
      seen.set(bucket, n + 1);
      const jitter = ((n % 5) - 2) * 2.4;
      const hot = highlight.has(r.ticker);
      const snap = r.snaps[0];
      const tip = [
        `${r.ticker} — ${r.legalName ?? r.name}`,
        `${snap.spRating} (${isIG(snap.spRating) ? "investment grade" : "speculative"})`,
        `DD ${num(snap.dd, 2)} · SP_PD ${pct(snap.spPd)}`,
        `MarketCap ${moneyK(snap.marketCap)} · FP_PD ${pct(snap.fpPd)}`,
      ].join("\n");
      return `<a href="./t.html#${encodeURIComponent(r.ticker)}">
        <circle class="sc-dot ${hot ? "is-hot" : ""} ${isIG(snap.spRating) ? "" : "spec"}"
          cx="${x(cap)}" cy="${(y(g) + jitter).toFixed(1)}" r="${hot ? 5 : 3.2}">
          <title>${esc(tip)}</title>
        </circle></a>`;
    })
    .join("");

  mount.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="sc" role="img"
      aria-label="Every rated company by market value and rating">${grid}${dots}</svg>`;
}
