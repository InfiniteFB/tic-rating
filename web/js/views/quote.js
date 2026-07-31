/* ═══════════════════════════════════════════════════════════════════════
   views/quote.js — the price section: range switch plus the interactive
   candlestick. Owns the selected range so switching it does not re-run any
   of the rating views.
   ═══════════════════════════════════════════════════════════════════════ */

import { esc } from "../format.js";
import { RANGES, renderCandles } from "../candles.js";

export function mountQuote(root) {
  const chart = root.querySelector("#candles");
  const controls = root.querySelector("#ranges");
  const caption = root.querySelector("#candles-cap");
  const note = root.querySelector("#quote-note");

  let range = "3M";
  let current = null;   // { ticker, ohlc }

  controls.innerHTML = RANGES.map(
    (r) => `<button class="btn btn--range" type="button" data-range="${r.key}"
      aria-pressed="${r.key === range}">${r.label}</button>`
  ).join("");

  controls.addEventListener("click", (event) => {
    const button = event.target.closest("[data-range]");
    if (!button) return;
    range = button.dataset.range;
    for (const b of controls.querySelectorAll("[data-range]")) {
      b.setAttribute("aria-pressed", String(b.dataset.range === range));
    }
    draw();
  });

  function draw() {
    if (!current) {
      chart.innerHTML = `<div class="is-loading">loading daily bars…</div>`;
      caption.textContent = "";
      return;
    }
    const drawn = renderCandles(chart, current.ohlc, { range, weekly: current.weekly });
    if (!drawn) {
      caption.innerHTML = `Daily bars are unavailable for ${esc(current.ticker)}.`;
      return;
    }
    const unit = (range === "5Y" || range === "MAX") ? "weekly" : "daily";
    caption.innerHTML = `<b>${esc(current.ticker)}</b> ${drawn.bars} ${unit} bars,
      ${esc(drawn.from)} → ${esc(drawn.to)}. Hollow bodies closed up, solid bodies closed down;
      the strip beneath is volume. Hover or drag for a per-bar readout.`;
  }

  note.innerHTML = `These are raw split-adjusted aggregates. The rating calibrates on
    <em>dividend-adjusted</em> closes, so the last close here can differ slightly from
    <b>Price</b> in the entries table — the two are different series, not a disagreement.`;

  return {
    /** @param {{ticker:string}} row @param {object|null} series */
    update(row, series, status) {
      if (!row) return;
      if (status === "loading") {
        current = null;
        draw();
        return;
      }
      if (!series?.ohlc) {
        current = null;
        chart.innerHTML = `<div class="plate__empty"><b>No daily bars for ${esc(row.ticker)}.</b>
          The cached capture carries no price aggregates for this name.</div>`;
        caption.textContent = "";
        return;
      }
      current = { ticker: row.ticker, ohlc: series.ohlc, weekly: series.ohlcW ?? null };
      draw();
    },
  };
}
