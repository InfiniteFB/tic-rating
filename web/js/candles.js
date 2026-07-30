/* ═══════════════════════════════════════════════════════════════════════
   candles.js — interactive daily candlestick chart.

   Hand-rolled SVG rather than a charting library: the whole site ships no
   dependencies, and the interaction we need is narrow — crosshair, readout,
   range switch. Up bars are hollow, down bars are solid accent; that is the
   only colour spent here, so the price action stays legible next to the
   rating typography.

   Bars are the raw split-adjusted aggregates. The model calibrates on
   dividend-adjusted closes, so the last close here can sit slightly away
   from `Price` in the entries table — the caption says so.
   ═══════════════════════════════════════════════════════════════════════ */

import { num, shortDate, shares, usd, change } from "./format.js";

const NS = "http://www.w3.org/2000/svg";

export const RANGES = [
  { key: "1M", label: "1M", days: 21 },
  { key: "3M", label: "3M", days: 63 },
  { key: "6M", label: "6M", days: 126 },
  { key: "ALL", label: "All", days: Infinity },
];

const el = (name, attrs = {}) => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

const niceStep = (span, target = 5) => {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? mag * 10;
};

/**
 * @param {HTMLElement} mount
 * @param {{dates:string[],o:number[],h:number[],l:number[],c:number[],v:number[]}} ohlc
 * @param {{range?:string, onRange?:(key:string)=>void}} opts
 */
export function renderCandles(mount, ohlc, opts = {}) {
  mount.textContent = "";
  if (!ohlc || !Array.isArray(ohlc.dates) || ohlc.dates.length < 2) {
    mount.innerHTML = `<div class="plate__empty"><b>No daily bars.</b>
      The cached capture for this name carries no price aggregates.</div>`;
    return;
  }

  const rangeKey = opts.range ?? "3M";
  const span = RANGES.find((r) => r.key === rangeKey) ?? RANGES[1];
  const total = ohlc.dates.length;
  const from = Number.isFinite(span.days) ? Math.max(0, total - span.days) : 0;

  const d = {
    dates: ohlc.dates.slice(from),
    o: ohlc.o.slice(from),
    h: ohlc.h.slice(from),
    l: ohlc.l.slice(from),
    c: ohlc.c.slice(from),
    v: (ohlc.v ?? []).slice(from),
  };
  const n = d.dates.length;

  // ── geometry (a viewBox in px; CSS scales it fluidly) ─────────────────
  const W = 900;
  const H = 340;
  const padL = 8;
  const padR = 62;         // price axis on the right, as on a trading screen
  const padT = 18;
  const volH = 46;
  const gap = 12;
  const priceH = H - padT - volH - gap - 22;

  const lo = Math.min(...d.l);
  const hi = Math.max(...d.h);
  const pad = (hi - lo) * 0.06 || hi * 0.02 || 1;
  const yLo = lo - pad;
  const yHi = hi + pad;
  const vMax = Math.max(1, ...d.v);

  const plotW = W - padL - padR;
  const step = plotW / n;
  const bodyW = Math.max(1, Math.min(11, step * 0.62));
  const x = (i) => padL + step * (i + 0.5);
  const y = (p) => padT + (1 - (p - yLo) / (yHi - yLo)) * priceH;
  const vy = (val) => padT + priceH + gap + volH - (val / vMax) * volH;

  const svg = el("svg", {
    viewBox: `0 0 ${W} ${H}`,
    role: "img",
    "aria-label": `Daily candlestick chart, ${d.dates[0]} to ${d.dates[n - 1]}`,
    class: "candles",
  });

  // ── price gridlines + right-hand axis ────────────────────────────────
  const stepP = niceStep(yHi - yLo);
  const grid = el("g");
  for (let p = Math.ceil(yLo / stepP) * stepP; p <= yHi; p += stepP) {
    grid.append(el("line", { class: "ch-grid", x1: padL, y1: y(p), x2: W - padR, y2: y(p) }));
    const t = el("text", { class: "ch-tick", x: W - padR + 6, y: y(p) + 3 });
    t.textContent = `$${num(p, p < 20 ? 2 : 0)}`;
    grid.append(t);
  }
  svg.append(grid);

  // ── candles ──────────────────────────────────────────────────────────
  const bars = el("g");
  for (let i = 0; i < n; i++) {
    const up = d.c[i] >= d.o[i];
    const cls = up ? "candle candle--up" : "candle candle--down";
    bars.append(el("line", { class: `${cls} candle__wick`, x1: x(i), y1: y(d.h[i]), x2: x(i), y2: y(d.l[i]) }));
    const top = y(Math.max(d.o[i], d.c[i]));
    const bottom = y(Math.min(d.o[i], d.c[i]));
    bars.append(el("rect", {
      class: `${cls} candle__body`,
      x: x(i) - bodyW / 2,
      y: top,
      width: bodyW,
      height: Math.max(1, bottom - top),
    }));
    if (d.v[i] != null) {
      bars.append(el("rect", {
        class: `${cls} candle__vol`,
        x: x(i) - bodyW / 2,
        y: vy(d.v[i]),
        width: bodyW,
        height: Math.max(0.5, padT + priceH + gap + volH - vy(d.v[i])),
      }));
    }
  }
  svg.append(bars);

  // ── date axis: four evenly spaced labels ─────────────────────────────
  const axis = el("g");
  axis.append(el("line", {
    class: "ch-axis", x1: padL, y1: padT + priceH + gap + volH,
    x2: W - padR, y2: padT + priceH + gap + volH,
  }));
  [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1].forEach((i, k) => {
    const t = el("text", {
      class: "ch-tick",
      x: x(i),
      y: H - 6,
      "text-anchor": k === 0 ? "start" : k === 3 ? "end" : "middle",
    });
    t.textContent = shortDate(d.dates[i]);
    axis.append(t);
  });
  svg.append(axis);

  // ── crosshair + hit area ─────────────────────────────────────────────
  const cross = el("g", { class: "cross", visibility: "hidden" });
  const vline = el("line", { class: "cross__line", y1: padT, y2: padT + priceH + gap + volH });
  const hline = el("line", { class: "cross__line", x1: padL, x2: W - padR });
  const dot = el("circle", { class: "cross__dot", r: 3 });
  cross.append(vline, hline, dot);
  svg.append(cross);

  const hit = el("rect", { x: padL, y: padT, width: plotW, height: priceH + gap + volH, fill: "transparent" });
  svg.append(hit);

  mount.append(svg);

  // ── readout ──────────────────────────────────────────────────────────
  const readout = document.createElement("div");
  readout.className = "candles__readout";
  mount.append(readout);

  const first = d.c[0];
  const last = d.c[n - 1];
  const overall = change(first, last);

  const setReadout = (i) => {
    const idx = i ?? n - 1;
    const prev = idx > 0 ? d.c[idx - 1] : d.o[idx];
    const day = change(prev, d.c[idx]);
    readout.innerHTML = `
      <span class="candles__date">${shortDate(d.dates[idx])}</span>
      <span><i class="label">O</i>${usd(d.o[idx])}</span>
      <span><i class="label">H</i>${usd(d.h[idx])}</span>
      <span><i class="label">L</i>${usd(d.l[idx])}</span>
      <span><i class="label">C</i>${usd(d.c[idx])}</span>
      <span class="${day.cls}">${day.text}</span>
      <span><i class="label">Vol</i>${shares(d.v[idx])}</span>
      <span class="candles__span">${d.dates[0]} → ${d.dates[n - 1]}
        <b class="${overall.cls}">${overall.text}</b></span>`;
  };
  setReadout(null);

  const indexFromEvent = (event) => {
    const box = svg.getBoundingClientRect();
    const px = ((event.clientX - box.left) / box.width) * W;
    return Math.max(0, Math.min(n - 1, Math.round((px - padL) / step - 0.5)));
  };

  const move = (event) => {
    const i = indexFromEvent(event);
    cross.setAttribute("visibility", "visible");
    vline.setAttribute("x1", x(i));
    vline.setAttribute("x2", x(i));
    hline.setAttribute("y1", y(d.c[i]));
    hline.setAttribute("y2", y(d.c[i]));
    dot.setAttribute("cx", x(i));
    dot.setAttribute("cy", y(d.c[i]));
    setReadout(i);
  };

  svg.addEventListener("pointermove", move);
  svg.addEventListener("pointerdown", move);
  svg.addEventListener("pointerleave", () => {
    cross.setAttribute("visibility", "hidden");
    setReadout(null);
  });

  return { bars: n, from: d.dates[0], to: d.dates[n - 1] };
}
