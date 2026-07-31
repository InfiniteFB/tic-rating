/* ═══════════════════════════════════════════════════════════════════════
   methodCharts.js — the figures only the method page draws.

   Same idiom as charts.js: SVG strings, semantic classes, CSS colours,
   null when the data cannot support the figure. Everything that can come
   from the model's own output does; the engine's numbers are never
   recomputed here — the one exception is the g-curve, where the *curve* is
   background geometry and the solved point itself is the engine's value.
   ═══════════════════════════════════════════════════════════════════════ */

import { esc, isNum, num, pct, shortDate } from "./format.js";
import { SCALE, ratingIdx } from "./fields.js";

const svg = (w, h, inner, label) =>
  `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;

/** display-grade Φ for drawing the g curve (Zelen–Severo 26.2.17) */
function normCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/* 1 ── Moody's B-rated one-year default rates, paper Table 1 (2006 absent
   in the source). The same letter, two orders of magnitude apart. */
const MOODYS_B = [
  ["2001", 9.8], ["2002", 5.4], ["2003", 2.8], ["2004", 0.7], ["2005", 1.3],
  ["2007", 0.0], ["2008", 2.1], ["2009", 7.6], ["2010", 0.5], ["2011", 0.1],
  ["2012", 0.5], ["2013", 0.9], ["2014", 0.3], ["2015", 2.3], ["2016", 1.6],
];

export function figMoodysB(opt = {}) {
  const o = { w: 640, h: 200, padL: 40, padR: 10, padT: 26, padB: 26, ...opt };
  const max = 10;
  const base = o.h - o.padB;
  const bw = (o.w - o.padL - o.padR) / MOODYS_B.length;
  const y = (v) => o.padT + (1 - v / max) * (base - o.padT);
  let s = `<line class="ch-axis" x1="${o.padL}" y1="${base}" x2="${o.w - o.padR}" y2="${base}"/>`;
  for (let v = 0; v <= max; v += 2.5) {
    s += `<line class="ch-grid" x1="${o.padL}" y1="${y(v)}" x2="${o.w - o.padR}" y2="${y(v)}"/>`
      + `<text class="ch-tick" x="${o.padL - 5}" y="${y(v) + 3}" text-anchor="end">${v}%</text>`;
  }
  MOODYS_B.forEach(([yr, v], i) => {
    const x = o.padL + i * bw + bw * 0.18;
    s += `<rect class="ch-bar-e" x="${x}" y="${y(v)}" width="${bw * 0.64}" height="${Math.max(1, base - y(v))}">
        <title>${yr} · ${v}%</title></rect>`
      + `<text class="ch-tick" x="${x + bw * 0.32}" y="${base + 12}" text-anchor="middle">${yr.slice(2)}</text>`;
  });
  s += `<text class="ch-tick" x="${o.padL}" y="${o.padT - 10}">one-year default rate of Moody's B-rated issuers · same letter every year</text>`;
  return svg(o.w, o.h, s, "Historical one-year default rates of Moody's B-rated issuers");
}

/* 2 ── the payoff geometry: at maturity equity is max(A − D, 0) */
export function figPayoff(opt = {}) {
  const o = { w: 640, h: 230, padL: 48, padR: 20, padT: 24, padB: 34, ...opt };
  const base = o.h - o.padB;
  const xD = o.padL + (o.w - o.padL - o.padR) * 0.42;
  const xEnd = o.w - o.padR;
  const yTop = o.padT + 8;
  let s = `<line class="ch-axis" x1="${o.padL}" y1="${base}" x2="${xEnd}" y2="${base}"/>`
    + `<line class="ch-axis" x1="${o.padL}" y1="${base}" x2="${o.padL}" y2="${o.padT - 4}"/>`
    + `<line class="ch-grid ch-ig" x1="${xD}" y1="${base}" x2="${xD}" y2="${o.padT}"/>`
    + `<text class="ch-lab" x="${xD}" y="${base + 14}" text-anchor="middle">A = D</text>`
    // debt holders: min(A, D) — rises then flat
    + `<path class="ch-line-d" d="M${o.padL} ${base} L${xD} ${base - (base - yTop) * 0.5} L${xEnd} ${base - (base - yTop) * 0.5}"/>`
    // equity holders: flat zero then up — the call
    + `<path class="ch-line-a" d="M${o.padL} ${base} L${xD} ${base} L${xEnd} ${yTop}"/>`
    + `<text class="ch-lab" x="${xEnd - 4}" y="${yTop + 12}" text-anchor="end">equity = max(A − D, 0)</text>`
    + `<text class="ch-lab" x="${xEnd - 4}" y="${base - (base - yTop) * 0.5 - 6}" text-anchor="end">debt = min(A, D)</text>`
    + `<text class="ch-tick" x="${xEnd}" y="${base + 14}" text-anchor="end">asset value at maturity →</text>`
    + `<text class="ch-tick" x="${o.padL}" y="${o.padT - 8}">value to each claim</text>`;
  return svg(o.w, o.h, s, "Equity as a call option on the assets struck at the debt");
}

/* 3 ── the g curve, with the day's solve marked: g is monotone, so the
   equity observation pins down exactly one asset value */
export function figG(snap, opt = {}) {
  const o = { w: 640, h: 250, padL: 52, padR: 22, padT: 26, padB: 32, ...opt };
  if (!snap || !isNum(snap.asset) || !isNum(snap.marketCap) || !isNum(snap.debt) || !isNum(snap.assetVol)) return null;
  const sigma = snap.assetVol;
  const tau = 1;
  const r = isNum(snap.rate) ? snap.rate : 0.04;
  const disc = snap.debt * Math.exp(-r * tau);
  const xStar = snap.asset / disc;
  const zStar = snap.marketCap / disc;
  const g = (x) => {
    const lx = Math.log(x);
    const s2 = (sigma * sigma * tau) / 2;
    const st = sigma * Math.sqrt(tau);
    return x * normCdf((lx + s2) / st) - normCdf((lx - s2) / st);
  };
  const x0 = Math.max(0.55, xStar * 0.45);
  const x1 = xStar * 1.5;
  const gMax = g(x1) * 1.06;
  const X = (x) => o.padL + ((x - x0) / (x1 - x0)) * (o.w - o.padL - o.padR);
  const Y = (v) => o.padT + (1 - v / gMax) * (o.h - o.padT - o.padB);
  const base = o.h - o.padB;
  let s = `<line class="ch-axis" x1="${o.padL}" y1="${base}" x2="${o.w - o.padR}" y2="${base}"/>`;
  for (let k = 1; k <= 3; k++) {
    const v = (gMax * k) / 4;
    s += `<line class="ch-grid" x1="${o.padL}" y1="${Y(v)}" x2="${o.w - o.padR}" y2="${Y(v)}"/>`;
  }
  const steps = 120;
  let d = "";
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    d += `${i ? "L" : "M"}${X(x).toFixed(1)} ${Y(g(x)).toFixed(1)}`;
  }
  s += `<path class="ch-line-a" d="${d}"/>`
    // the observed z arrives on the y axis, meets the curve, drops to x*
    + `<line class="ch-conn ch-down" stroke-dasharray="3 3" x1="${o.padL}" y1="${Y(zStar)}" x2="${X(xStar)}" y2="${Y(zStar)}"/>`
    + `<line class="ch-conn ch-down" stroke-dasharray="3 3" x1="${X(xStar)}" y1="${Y(zStar)}" x2="${X(xStar)}" y2="${base}"/>`
    + `<circle class="ch-cur ch-down" cx="${X(xStar)}" cy="${Y(zStar)}" r="4.5"/>`
    + `<text class="ch-lab" x="${o.padL + 4}" y="${Y(zStar) - 6}">z = ${num(zStar, 3)} observed</text>`
    + `<text class="ch-lab" x="${X(xStar)}" y="${base + 14}" text-anchor="middle">x* = ${num(xStar, 3)}</text>`
    + `<text class="ch-tick" x="${o.padL}" y="${o.padT - 10}">g(x, σ_A = ${pct(sigma)}, τ = 1) · x = A / (D·e^(−rτ)) · monotone ⇒ one solution</text>`;
  return svg(o.w, o.h, s, "The normalised option curve and the day's bisection solve");
}

/* 5 ── where the whole universe stands, in σ units from the barrier */
export function figDDStrip(rows, subjectTicker, opt = {}) {
  const o = { w: 640, h: 130, padL: 40, padR: 16, padT: 34, padB: 30, cap: 26, ...opt };
  const set = rows.filter((r) => isNum(r.snaps?.[0]?.dd));
  if (!set.length) return null;
  const y0 = o.padT + 18;
  const y1 = o.h - o.padB;
  const X = (v) => o.padL + (Math.min(v, o.cap) / o.cap) * (o.w - o.padL - o.padR);
  let s = `<line class="ch-axis" x1="${o.padL}" y1="${y1}" x2="${o.w - o.padR}" y2="${y1}"/>`;
  for (let t = 0; t <= o.cap; t += 5) {
    s += `<line class="ch-grid" x1="${X(t)}" y1="${y0 - 6}" x2="${X(t)}" y2="${y1}"/>`
      + `<text class="ch-tick" x="${X(t)}" y="${y1 + 12}" text-anchor="middle">${t}${t === o.cap ? "+" : ""}</text>`;
  }
  s += `<line class="ch-grid ch-ig" x1="${X(0)}" y1="${y0 - 12}" x2="${X(0)}" y2="${y1}"/>`
    + `<text class="ch-lab" x="${X(0) + 4}" y="${y0 - 14}">default point</text>`;
  let subject = null;
  for (const r of set) {
    const dd = r.snaps[0].dd;
    if (r.ticker === subjectTicker) { subject = dd; continue; }
    s += `<line x1="${X(dd)}" y1="${y0}" x2="${X(dd)}" y2="${y1 - 1}" stroke="var(--ink)" stroke-opacity="0.16" stroke-width="1.2"><title>${esc(r.ticker)} · DD ${num(dd, 2)}</title></line>`;
  }
  if (isNum(subject)) {
    s += `<line x1="${X(subject)}" y1="${y0 - 8}" x2="${X(subject)}" y2="${y1 - 1}" stroke="var(--red)" stroke-width="2.6"/>`
      + `<text class="ch-lab ch-down" x="${X(subject)}" y="${y0 - 12}" text-anchor="middle">${esc(subjectTicker)} ${num(subject, 1)}σ</text>`;
  }
  s += `<text class="ch-tick" x="${o.padL}" y="${o.padT - 22}">every rated constituent, distance to default in σ units · capped at ${o.cap}σ</text>`;
  return svg(o.w, o.h, s, "Distance to default across the rated universe");
}

/* 6 ── maturity-only vs first-passage: two designed paths, one barrier.
   Path B ends the year above D — Merton's EDF never sees the touch. */
export function figBarrier(opt = {}) {
  const o = { w: 640, h: 240, padL: 46, padR: 18, padT: 24, padB: 30, ...opt };
  const base = o.h - o.padB;
  const yD = base - (base - o.padT) * 0.32;
  const X = (f) => o.padL + f * (o.w - o.padL - o.padR);
  const Y = (v) => base - v * (base - o.padT);
  // hand-set paths (fractions of the frame): deterministic, no RNG
  const pathA = [0.62, 0.66, 0.6, 0.7, 0.66, 0.74, 0.7, 0.78, 0.74, 0.82, 0.8, 0.86];
  const pathB = [0.62, 0.55, 0.58, 0.44, 0.4, 0.3, 0.24, 0.34, 0.42, 0.5, 0.46, 0.55];
  const touchIdx = 6; // where B crosses the barrier level (0.32 of frame ≈ yD)
  const line = (arr) => arr.map((v, i) => `${i ? "L" : "M"}${X(i / (arr.length - 1)).toFixed(1)} ${Y(v).toFixed(1)}`).join(" ");
  let s = `<line class="ch-axis" x1="${o.padL}" y1="${base}" x2="${o.w - o.padR}" y2="${base}"/>`
    + `<line class="ch-line-d" x1="${o.padL}" y1="${yD}" x2="${o.w - o.padR}" y2="${yD}"/>`
    + `<text class="ch-lab" x="${o.padL + 4}" y="${yD - 6}">default point D</text>`
    + `<path class="ch-line-e" d="${line(pathA)}"/>`
    + `<path class="ch-line-a" d="${line(pathB)}"/>`
    + `<circle class="ch-cur ch-down" cx="${X(touchIdx / (pathB.length - 1))}" cy="${Y(0.24)}" r="5"/>`
    + `<text class="ch-lab ch-down" x="${X(touchIdx / (pathB.length - 1))}" y="${Y(0.24) + 16}" text-anchor="middle">first passage — default counted</text>`
    + `<text class="ch-lab" x="${o.w - o.padR - 2}" y="${Y(pathB[pathB.length - 1]) - 8}" text-anchor="end">ends above D — EDF misses it</text>`
    + `<text class="ch-tick" x="${o.padL}" y="${o.padT - 8}">two asset paths over one year · EDF asks only where they end · first passage asks whether they ever touch</text>`
    + `<text class="ch-tick" x="${o.w - o.padR}" y="${base + 13}" text-anchor="end">one year →</text>`;
  return svg(o.w, o.h, s, "Maturity-only default against first-passage default");
}

/* 7 ── a decade of one name: the PIT distance wiggles, the letter steps */
export function figPIT(series, ticker, opt = {}) {
  const o = { w: 640, hTop: 150, hBot: 128, padL: 46, padR: 16, padT: 24, gap: 14, padB: 26, ...opt };
  const h = series?.history?.[String(series.window ?? 150)];
  if (!h?.dates?.length) return null;
  const n = h.dates.length;
  const H = o.hTop + o.gap + o.hBot + o.padB;
  const X = (i) => o.padL + (i / (n - 1)) * (o.w - o.padL - o.padR);

  // top: DD (point-in-time, drift included) — the wiggling line
  const dds = h.dd.filter(isNum);
  const dMax = Math.max(...dds) * 1.06;
  const dMin = Math.min(0, Math.min(...dds));
  const yT = (v) => o.padT + (1 - (v - dMin) / (dMax - dMin)) * (o.hTop - o.padT);
  let s = "";
  for (let k = 0; k <= 3; k++) {
    const v = dMin + ((dMax - dMin) * k) / 3;
    s += `<line class="ch-grid" x1="${o.padL}" y1="${yT(v)}" x2="${o.w - o.padR}" y2="${yT(v)}"/>`
      + `<text class="ch-tick" x="${o.padL - 5}" y="${yT(v) + 3}" text-anchor="end">${num(v, 0)}</text>`;
  }
  s += `<path class="ch-line-a" d="${h.dd.map((v, i) => (isNum(v) ? `${i && isNum(h.dd[i - 1]) ? "L" : "M"}${X(i).toFixed(1)} ${yT(v).toFixed(1)}` : "")).join("")}"/>`
    + `<text class="ch-tick" x="${o.padL}" y="${o.padT - 10}">${esc(ticker)} · weekly · top: distance to default (point-in-time) · bottom: the TTC letter</text>`;

  // bottom: the letter as steps on the rating scale
  const idxs = h.spRating.map((L) => (L ? ratingIdx(L) : null));
  const seen = idxs.filter((v) => v !== null);
  const lo = Math.max(0, Math.min(...seen) - 1);
  const hi = Math.min(SCALE.length - 1, Math.max(...seen) + 1);
  const top = o.hTop + o.gap;
  const yB = (idx) => top + ((idx - lo) / Math.max(1, hi - lo)) * o.hBot;
  for (let idx = lo; idx <= hi; idx++) {
    if ((idx - lo) % Math.ceil((hi - lo) / 5 || 1) === 0) {
      s += `<line class="ch-grid" x1="${o.padL}" y1="${yB(idx)}" x2="${o.w - o.padR}" y2="${yB(idx)}"/>`
        + `<text class="ch-tick" x="${o.padL - 5}" y="${yB(idx) + 3}" text-anchor="end">${esc(SCALE[idx])}</text>`;
    }
  }
  let dStep = "";
  for (let i = 0; i < n; i++) {
    if (idxs[i] === null) continue;
    const px = X(i).toFixed(1);
    const py = yB(idxs[i]).toFixed(1);
    if (!dStep) dStep = `M${px} ${py}`;
    else if (idxs[i] === idxs[i - 1]) dStep += ` L${px} ${py}`;
    else dStep += ` L${px} ${yB(idxs[i - 1]).toFixed(1)} L${px} ${py}`;
  }
  s += `<path class="ch-line-d" d="${dStep}"/>`;
  [0, Math.floor(n / 2), n - 1].forEach((i, k) => {
    s += `<text class="ch-tick" x="${X(i)}" y="${H - 8}" text-anchor="${k === 0 ? "start" : k === 2 ? "end" : "middle"}">${esc(shortDate(h.dates[i]))}</text>`;
  });
  return svg(o.w, H, s, "A decade of point-in-time distance against the through-the-cycle letter");
}

/* 8 ── the Table 8 strip: seven anchors on a log RiskScore axis, and where
   this name's RS_SP lands (large caps often land far left of AAA) */
export function figTable8(snap, table8, opt = {}) {
  const o = { w: 640, h: 120, padL: 20, padR: 20, padT: 40, padB: 30, lo: 1e-4, hi: 300, ...opt };
  if (!snap || !isNum(snap.rsSp)) return null;
  const y = o.h - o.padB - 18;
  const X = (v) => {
    const c = Math.max(o.lo, Math.min(o.hi, v));
    return o.padL + ((Math.log10(c) - Math.log10(o.lo)) / (Math.log10(o.hi) - Math.log10(o.lo))) * (o.w - o.padL - o.padR);
  };
  let s = `<line class="ch-axis" x1="${o.padL}" y1="${y}" x2="${o.w - o.padR}" y2="${y}"/>`;
  for (let e = -4; e <= 2; e++) {
    s += `<line class="ch-grid" x1="${X(10 ** e)}" y1="${y - 34}" x2="${X(10 ** e)}" y2="${y}"/>`
      + `<text class="ch-tick" x="${X(10 ** e)}" y="${y + 12}" text-anchor="middle">${e === 0 ? "1" : `1e${e}`}</text>`;
  }
  table8.forEach(([letter, rsAnchor], i) => {
    // adjacent anchors crowd on a log axis — alternate the label height
    const ly = y - 30 - (i % 2 ? 12 : 0);
    s += `<line x1="${X(rsAnchor)}" y1="${y - 26}" x2="${X(rsAnchor)}" y2="${y}" stroke="var(--ink)" stroke-width="1.6"/>`
      + `<text class="ch-lab" x="${X(rsAnchor)}" y="${ly}" text-anchor="middle">${esc(letter)}</text>`;
  });
  s += `<line x1="${X(snap.rsSp)}" y1="${y - 26}" x2="${X(snap.rsSp)}" y2="${y}" stroke="var(--red)" stroke-width="2.6"/>`
    + `<text class="ch-lab ch-down" x="${X(snap.rsSp)}" y="${y - 30}" text-anchor="middle">RS_SP ${num(snap.rsSp, 4)}</text>`
    + `<text class="ch-tick" x="${o.padL}" y="${o.padT - 24}">the Table 8 anchors on a log RiskScore axis · scores left of AAA clamp to AAA — where strong large caps land</text>`;
  return svg(o.w, o.h, s, "Table 8 anchors and this name's landing point");
}
