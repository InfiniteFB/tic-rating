/* ═══════════════════════════════════════════════════════════════════════
   views/history.js — the rating through time, and the methodology knob.

   A decade of letters on a weekly grid, drawn as steps because a rating is a
   bucket, not a curve. The calibration-window toggle lives here rather than
   in a settings page: the window is the one assumption that visibly moves
   the answer, so it belongs next to the picture it changes.
   ═══════════════════════════════════════════════════════════════════════ */

import { esc, num, shortDate } from "../format.js";
import { SCALE, isIG, ratingIdx } from "../fields.js";

const W = 960;
const H = 300;
const PAD = { l: 44, r: 14, t: 14, b: 26 };

export function mountHistory(root, _opts = {}) {
  root.innerHTML = `
    <div class="hist__bar">
      <div class="hist__knob" role="group" aria-label="Calibration window"></div>
      <span class="hist__note">calibration window, trading days — changes this chart only — the rating above stays on the 150-day build</span>
      <output class="hist__readout" aria-live="polite"></output>
    </div>
    <div class="hist__frame"></div>
    <p class="note hist__foot"></p>`;

  const knob = root.querySelector(".hist__knob");
  const frame = root.querySelector(".hist__frame");
  const readout = root.querySelector(".hist__readout");
  const foot = root.querySelector(".hist__foot");

  let series = null;
  let chosen = 150;
  let block = null;   // the active history block {dates, spRating, dd}

  knob.addEventListener("click", (event) => {
    const button = event.target.closest("[data-w]");
    if (!button || button.disabled) return;
    chosen = Number(button.dataset.w);
    paint();
  });

  function paint() {
    if (!series?.history) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    const windows = series.windows ?? [150];
    knob.innerHTML = windows
      .map(
        (w) => `<button type="button" class="hist__w" data-w="${w}"
          aria-pressed="${w === chosen}" ${series.history[String(w)] ? "" : "disabled"}>${w}</button>`
      )
      .join("");

    block = series.history[String(chosen)];
    if (!block?.dates?.length) {
      frame.innerHTML = `<div class="plate__empty"><b>No history at this window.</b></div>`;
      return;
    }
    frame.innerHTML = draw(block);
    wire(frame.querySelector("svg"), block);
    const letters = new Set(block.spRating);
    foot.innerHTML = `${block.dates.length} weekly points, <b>${esc(block.dates[0])}</b> →
      <b>${esc(block.dates[block.dates.length - 1])}</b>, ${letters.size} distinct grades.
      Each point is a fresh calibration on the ${chosen} trading days before it — the letter an
      observer would have computed that week, not today's assumptions read backwards.
      Other knobs are fixed at the build: strict short-term-debt handling, 365-day horizon,
      FRED DGS1 risk-free.`;
    readout.textContent = "";
  }

  function draw(b) {
    const n = b.dates.length;
    const idx = b.spRating.map(ratingIdx);
    const lo = Math.max(0, Math.min(...idx) - 1);
    const hi = Math.min(SCALE.length - 1, Math.max(...idx) + 1);
    const x = (i) => PAD.l + (i / (n - 1)) * (W - PAD.l - PAD.r);
    const y = (g) => PAD.t + ((g - lo) / Math.max(1, hi - lo)) * (H - PAD.t - PAD.b);

    let grid = "";
    for (let g = lo; g <= hi; g++) {
      const major = SCALE[g].length <= 3 && !SCALE[g].includes("-") && !SCALE[g].includes("+");
      grid += `<line class="ch-grid" x1="${PAD.l}" y1="${y(g)}" x2="${W - PAD.r}" y2="${y(g)}"/>`;
      if (major || hi - lo < 9 || g % 2 === 0) {
        grid += `<text class="ch-tick hist__ylab ${isIG(SCALE[g]) ? "" : "spec"}"
          x="${PAD.l - 6}" y="${y(g) + 3}" text-anchor="end">${SCALE[g]}</text>`;
      }
    }
    const ig = SCALE.indexOf("BBB-") + 0.5;
    if (ig > lo && ig < hi) {
      grid += `<line class="ch-grid ch-ig" x1="${PAD.l}" y1="${y(ig)}" x2="${W - PAD.r}" y2="${y(ig)}"/>`;
    }
    // year ticks
    let lastYear = "";
    for (let i = 0; i < n; i++) {
      const year = b.dates[i].slice(0, 4);
      if (year !== lastYear) {
        lastYear = year;
        grid += `<line class="ch-grid" x1="${x(i)}" y1="${PAD.t}" x2="${x(i)}" y2="${H - PAD.b}"/>
          <text class="ch-tick" x="${x(i) + 3}" y="${H - PAD.b + 14}">${year}</text>`;
      }
    }

    let path = `M ${x(0)} ${y(idx[0])}`;
    for (let i = 1; i < n; i++) path += ` H ${x(i)} V ${y(idx[i])}`;

    return `<svg viewBox="0 0 ${W} ${H}" class="hist__svg" role="img"
        aria-label="Rating history on the ${esc(String(chosen))}-day window">
      ${grid}
      <path class="hist__line" d="${path}"/>
      <g class="hist__cross" visibility="hidden">
        <line class="cross__line" y1="${PAD.t}" y2="${H - PAD.b}"/>
        <circle class="cross__dot" r="3.5"/>
      </g>
    </svg>`;
  }

  function wire(svg, b) {
    const n = b.dates.length;
    const idx = b.spRating.map(ratingIdx);
    const lo = Math.max(0, Math.min(...idx) - 1);
    const hi = Math.min(SCALE.length - 1, Math.max(...idx) + 1);
    const cross = svg.querySelector(".hist__cross");
    const move = (event) => {
      const box = svg.getBoundingClientRect();
      const fx = ((event.clientX - box.left) / box.width) * W;
      const i = Math.max(0, Math.min(n - 1,
        Math.round(((fx - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1))));
      const px = PAD.l + (i / (n - 1)) * (W - PAD.l - PAD.r);
      const py = PAD.t + ((idx[i] - lo) / Math.max(1, hi - lo)) * (H - PAD.t - PAD.b);
      cross.setAttribute("visibility", "visible");
      cross.querySelector("line").setAttribute("x1", px);
      cross.querySelector("line").setAttribute("x2", px);
      const dot = cross.querySelector("circle");
      dot.setAttribute("cx", px);
      dot.setAttribute("cy", py);
      readout.innerHTML = `<b>${esc(shortDate(b.dates[i]))}</b> ·
        <span class="${isIG(b.spRating[i]) ? "" : "spec"}">${esc(b.spRating[i])}</span>
        · DD ${num(b.dd[i], 2)}`;
    };
    svg.addEventListener("pointermove", move);
    svg.addEventListener("pointerleave", () => {
      cross.setAttribute("visibility", "hidden");
      readout.textContent = "";
    });
  }

  return {
    update(next) {
      series = next;
      if (series && !series.history?.[String(chosen)]) chosen = series.window ?? 150;
      paint();
    },
    get window() {
      return chosen;
    },
  };
}
