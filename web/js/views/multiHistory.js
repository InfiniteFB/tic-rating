/* ═══════════════════════════════════════════════════════════════════════
   views/multiHistory.js — the watchlist's letters through time.

   A handful of names carry colour by default; clicking a legend chip toggles
   its line between coloured and grey, so the reader composes the picture.
   A heavier dashed line runs the market-value-weighted average of the list —
   the list's own credit cycle, against which each member reads as better or
   worse. The shaded band is the dashboard's selected span.
   ═══════════════════════════════════════════════════════════════════════ */

import { esc } from "../format.js";
import { SCALE, isIG, ratingIdx } from "../fields.js";

const W = 960;
const H = 340;
const PAD = { l: 44, r: 14, t: 14, b: 26 };

/* a small categorical set, muted to sit inside the palette: vermilion first,
   then ink-adjacent hues that stay legible on the paper ground */
const COLOURS = [
  "oklch(55% 0.195 30)",   // vermilion
  "oklch(48% 0.085 245)",  // blue
  "oklch(46% 0.095 155)",  // green
  "oklch(52% 0.13 62)",    // ochre
  "oklch(45% 0.09 300)",   // violet
];
const DEFAULT_COLOURED = 4;

export function mountMultiHistory(mount) {
  mount.innerHTML = `
    <div class="plate__bar">
      <span class="plate__title">Watchlist rating history</span>
      <span class="plate__hint">click a symbol to colour or grey its line</span>
    </div>
    <div class="mh__legend" role="list"></div>
    <div class="mh__frame"></div>`;
  const legend = mount.querySelector(".mh__legend");
  const frame = mount.querySelector(".mh__frame");

  let entries = [];
  let span = null;
  let weights = new Map();
  const coloured = new Map();   // ticker → colour index, only for active lines

  legend.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-tk]");
    if (!chip) return;
    const tk = chip.dataset.tk;
    if (coloured.has(tk)) {
      coloured.delete(tk);
    } else {
      const used = new Set(coloured.values());
      const free = COLOURS.findIndex((_, i) => !used.has(i));
      coloured.set(tk, free === -1 ? coloured.size % COLOURS.length : free);
    }
    paint();
  });

  function seed() {
    coloured.clear();
    entries.slice(0, DEFAULT_COLOURED).forEach((e, i) => coloured.set(e.ticker, i % COLOURS.length));
  }

  function paint() {
    const usable = entries.filter((e) => e.block?.dates?.length > 1);
    if (usable.length < 1) {
      frame.innerHTML = `<div class="plate__empty"><b>No history to draw.</b>
        The list is empty, or no member carries a weekly rating path.</div>`;
      legend.innerHTML = "";
      return;
    }

    const first = usable.map((e) => e.block.dates[0]).sort()[0];
    const last = usable.map((e) => e.block.dates.at(-1)).sort().at(-1);
    const t0 = Date.parse(first);
    const t1 = Date.parse(last);
    const idxAll = usable.flatMap((e) => e.block.spRating.map(ratingIdx));
    const gLo = Math.max(0, Math.min(...idxAll) - 1);
    const gHi = Math.min(SCALE.length - 1, Math.max(...idxAll) + 1);
    const x = (iso) => PAD.l + ((Date.parse(iso) - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
    const y = (g) => PAD.t + ((g - gLo) / Math.max(1, gHi - gLo)) * (H - PAD.t - PAD.b);

    let grid = "";
    for (let g = gLo; g <= gHi; g++) {
      grid += `<line class="ch-grid" x1="${PAD.l}" y1="${y(g)}" x2="${W - PAD.r}" y2="${y(g)}"/>`;
      if (g % 2 === 0 || gHi - gLo < 10) {
        grid += `<text class="ch-tick ${isIG(SCALE[g]) ? "" : "spec"}" x="${PAD.l - 6}" y="${y(g) + 3}"
          text-anchor="end">${SCALE[g]}</text>`;
      }
    }
    for (let year = Number(first.slice(0, 4)) + 1; year <= Number(last.slice(0, 4)); year++) {
      const px = x(`${year}-01-01`);
      grid += `<line class="ch-grid" x1="${px}" y1="${PAD.t}" x2="${px}" y2="${H - PAD.b}"/>
        <text class="ch-tick" x="${px + 3}" y="${H - PAD.b + 14}">${year}</text>`;
    }
    if (span?.earlier && span?.later) {
      grid += `<rect class="mh__span" x="${x(span.earlier)}" y="${PAD.t}"
        width="${Math.max(2, x(span.later) - x(span.earlier))}" height="${H - PAD.t - PAD.b}"/>`;
    }

    // grey lines first so colour always sits on top
    const sorted = usable.slice().sort((a, b) =>
      Number(coloured.has(a.ticker)) - Number(coloured.has(b.ticker)));
    const lines = sorted
      .map((e) => {
        const b = e.block;
        let d = `M ${x(b.dates[0])} ${y(ratingIdx(b.spRating[0]))}`;
        for (let i = 1; i < b.dates.length; i++) {
          d += ` H ${x(b.dates[i])} V ${y(ratingIdx(b.spRating[i]))}`;
        }
        const ci = coloured.get(e.ticker);
        const style = ci == null ? "" : ` style="stroke:${COLOURS[ci]}"`;
        return `<path class="mh__line ${ci == null ? "" : "is-coloured"}"${style}
          data-tk="${esc(e.ticker)}" d="${d}"><title>${esc(e.ticker)}</title></path>`;
      })
      .join("");

    // the list's own cycle: market-value-weighted mean notch, per week
    const avg = weightedAverage(usable, weights);
    let avgPath = "";
    if (avg.length > 1) {
      avgPath = `<path class="mh__avg" d="${avg
        .map((p, i) => `${i ? "L" : "M"} ${x(p.date).toFixed(1)} ${y(p.notch).toFixed(1)}`)
        .join(" ")}"><title>Weighted average (by latest market value)</title></path>`;
    }

    frame.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="mh__svg" role="img"
      aria-label="Rating history for every name on the watchlist">${grid}${lines}${avgPath}</svg>`;

    legend.innerHTML = usable
      .map((e) => {
        const ci = coloured.get(e.ticker);
        const style = ci == null ? "" : ` style="background:${COLOURS[ci]};border-color:${COLOURS[ci]};color:var(--paper)"`;
        return `<button type="button" class="mh__chip" data-tk="${esc(e.ticker)}"${style}
          aria-pressed="${ci != null}" role="listitem">${esc(e.ticker)}</button>`;
      })
      .join("")
      + `<span class="mh__chip mh__chip--avg" role="listitem">━ ━ weighted avg</span>`;
  }

  return {
    update(nextEntries, nextSpan, nextWeights) {
      const changed = nextEntries.map((e) => e.ticker).join() !== entries.map((e) => e.ticker).join();
      entries = nextEntries;
      span = nextSpan;
      weights = nextWeights ?? weights;
      if (changed || coloured.size === 0) seed();
      paint();
    },
  };
}

/** mean notch index per date, weighted by each name's (latest) market value */
function weightedAverage(usable, weights) {
  const axis = usable.reduce((best, e) => (e.block.dates.length > best.length ? e.block.dates : best), []);
  const out = [];
  for (const day of axis) {
    let mass = 0;
    let sum = 0;
    for (const e of usable) {
      const b = e.block;
      if (day < b.dates[0]) continue;
      let k = b.dates.length - 1;
      while (k >= 0 && b.dates[k] > day) k -= 1;
      if (k < 0) continue;
      const w = weights.get(e.ticker) ?? 1;
      mass += w;
      sum += w * ratingIdx(b.spRating[k]);
    }
    if (mass > 0) out.push({ date: day, notch: sum / mass });
  }
  return out;
}
