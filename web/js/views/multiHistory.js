/* ═══════════════════════════════════════════════════════════════════════
   views/multiHistory.js — the watchlist's letters through time, one step
   line per name. Ten grey lines are unreadable, so the legend does the
   work: hovering a name pulls its line forward in the accent and dims the
   rest. The window between the dashboard's two dates is shaded, tying the
   chart to the pair every other figure obeys.
   ═══════════════════════════════════════════════════════════════════════ */

import { esc } from "../format.js";
import { SCALE, isIG, ratingIdx } from "../fields.js";

const W = 960;
const H = 340;
const PAD = { l: 44, r: 14, t: 14, b: 26 };

export function mountMultiHistory(mount) {
  mount.innerHTML = `<div class="mh__legend" role="list"></div><div class="mh__frame"></div>`;
  const legend = mount.querySelector(".mh__legend");
  const frame = mount.querySelector(".mh__frame");

  legend.addEventListener("pointerover", (event) => {
    const chip = event.target.closest("[data-tk]");
    if (chip) focus(chip.dataset.tk);
  });
  legend.addEventListener("pointerleave", () => focus(null));

  function focus(ticker) {
    for (const line of frame.querySelectorAll(".mh__line")) {
      line.classList.toggle("is-hot", line.dataset.tk === ticker);
      line.classList.toggle("is-dim", ticker !== null && line.dataset.tk !== ticker);
    }
    for (const chip of legend.querySelectorAll("[data-tk]")) {
      chip.classList.toggle("is-hot", chip.dataset.tk === ticker);
    }
  }

  return {
    /**
     * @param entries [{ticker, block:{dates, spRating}}] — each name's weekly history
     * @param span    {earlier, later} ISO dates to shade
     */
    update(entries, span) {
      const usable = entries.filter((e) => e.block?.dates?.length > 1);
      if (usable.length < 1) {
        frame.innerHTML = `<div class="plate__empty"><b>No history to draw.</b>
          The list is empty, or no member carries a weekly rating path.</div>`;
        legend.innerHTML = "";
        return;
      }

      // one shared time axis: the union of first/last dates, weekly resolution
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

      const lines = usable
        .map((e) => {
          const b = e.block;
          let d = `M ${x(b.dates[0])} ${y(ratingIdx(b.spRating[0]))}`;
          for (let i = 1; i < b.dates.length; i++) {
            d += ` H ${x(b.dates[i])} V ${y(ratingIdx(b.spRating[i]))}`;
          }
          return `<path class="mh__line" data-tk="${esc(e.ticker)}" d="${d}"/>`;
        })
        .join("");

      frame.innerHTML = `<svg viewBox="0 0 ${W} ${H}" class="mh__svg" role="img"
        aria-label="Rating history for every name on the watchlist">${grid}${lines}</svg>`;
      legend.innerHTML = usable
        .map((e) => `<button type="button" class="mh__chip" data-tk="${esc(e.ticker)}" role="listitem">
          ${esc(e.ticker)}</button>`)
        .join("");
    },
  };
}
