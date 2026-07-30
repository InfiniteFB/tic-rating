/* ═══════════════════════════════════════════════════════════════════════
   charts.js — the analytic plates, as SVG strings.

   Every builder emits geometry with semantic classes only (.ch-grid,
   .ch-conn.ch-up, .ch-bar-a, …) and takes no colours, so restyling the whole
   diagnostic set is a CSS change. Builders return null when the data cannot
   support the chart, which lets views draw an honest empty state instead of
   an empty frame.
   ═══════════════════════════════════════════════════════════════════════ */

import { esc, isNum, moneyK, num, pct, shortDate } from "./format.js";
import { SCALE, migration, ratingIdx } from "./fields.js";

const svg = (w, h, inner, label) =>
  `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;

/* 1 ── DD dumbbell: prior → current distance to default, for a peer set */
export function chartDD(rows, opt = {}) {
  const o = { w: 520, rowH: 24, padL: 52, padR: 44, padT: 24, padB: 24, ...opt };
  const set = rows.filter((r) => isNum(r.snaps?.[0]?.dd));
  if (!set.length) return null;
  const sorted = set.slice().sort((a, b) => b.snaps[0].dd - a.snaps[0].dd);
  const h = o.padT + sorted.length * o.rowH + o.padB;
  const values = sorted.flatMap((r) => [r.snaps[0].dd, r.snaps[1]?.dd].filter(isNum));
  const max = Math.ceil(Math.max(...values, 1) + 0.6);
  const min = Math.min(0, Math.floor(Math.min(...values)));
  const x = (v) => o.padL + ((v - min) / (max - min)) * (o.w - o.padL - o.padR);
  let s = "";

  const tick = Math.max(1, Math.round((max - min) / 5));
  for (let t = min; t <= max; t += tick) {
    s += `<line class="ch-grid" x1="${x(t)}" y1="${o.padT - 8}" x2="${x(t)}" y2="${h - o.padB}"/>`
      + `<text class="ch-tick" x="${x(t)}" y="${h - o.padB + 12}" text-anchor="middle">${t}</text>`;
  }
  if (min < 0) s += `<line class="ch-axis" x1="${x(0)}" y1="${o.padT - 8}" x2="${x(0)}" y2="${h - o.padB}"/>`;

  sorted.forEach((row, i) => {
    const y = o.padT + i * o.rowH + o.rowH / 2;
    const cur = row.snaps[0].dd;
    const pr = row.snaps[1]?.dd;
    const dir = !isNum(pr) ? "flat" : cur > pr ? "up" : cur < pr ? "down" : "flat";
    s += `<text class="ch-lab" x="${o.padL - 8}" y="${y + 3.5}" text-anchor="end">${esc(row.ticker)}</text>`;
    if (isNum(pr)) {
      s += `<line class="ch-conn ch-${dir}" x1="${x(pr)}" y1="${y}" x2="${x(cur)}" y2="${y}"/>`
        + `<circle class="ch-prior" cx="${x(pr)}" cy="${y}" r="3.4"/>`;
    }
    s += `<circle class="ch-cur ch-${dir}" cx="${x(cur)}" cy="${y}" r="4.4"/>`
      + `<text class="ch-val" x="${o.w - o.padR + 6}" y="${y + 3.5}">${num(cur, 2)}</text>`;
  });
  s += `<text class="ch-tick" x="${o.padL}" y="${o.padT - 12}">σ units from the barrier · hollow = prior snapshot</text>`;
  return svg(o.w, h, s, "Distance to default, prior against current snapshot");
}

/* 2 ── rating migration slope: prior notch → current notch */
export function chartMigration(rows, opt = {}) {
  const o = { w: 520, h: 310, padT: 30, padB: 22, padL: 90, padR: 90, ...opt };
  const set = rows.filter((r) => r.snaps?.[0]?.spRating && r.snaps?.[1]?.spRating);
  if (!set.length) return null;
  const all = set.flatMap((r) => r.snaps.map((s) => ratingIdx(s.spRating)));
  const lo = Math.min(...all) - 1;
  const hi = Math.max(...all) + 1;
  const y = (idx) => o.padT + ((idx - lo) / (hi - lo)) * (o.h - o.padT - o.padB);
  const xl = o.padL;
  const xr = o.w - o.padR;

  let s = `<line class="ch-axis" x1="${xl}" y1="${o.padT - 10}" x2="${xl}" y2="${o.h - o.padB}"/>`
    + `<line class="ch-axis" x1="${xr}" y1="${o.padT - 10}" x2="${xr}" y2="${o.h - o.padB}"/>`
    + `<text class="ch-tick" x="${xl}" y="${o.padT - 16}" text-anchor="middle">${esc(set[0].snaps[1].date)}</text>`
    + `<text class="ch-tick" x="${xr}" y="${o.padT - 16}" text-anchor="middle">${esc(set[0].snaps[0].date)}</text>`;

  const edge = SCALE.indexOf("BBB-") + 0.5;
  if (edge > lo && edge < hi) {
    s += `<line class="ch-grid ch-ig" x1="${xl}" y1="${y(edge)}" x2="${xr}" y2="${y(edge)}"/>`
      + `<text class="ch-tick ch-ig-lab" x="${(xl + xr) / 2}" y="${y(edge) - 5}" text-anchor="middle">investment grade ↑</text>`;
  }

  const stacker = () => {
    const used = [];
    return (idx) => {
      let yy = y(idx);
      while (used.some((u) => Math.abs(u - yy) < 11)) yy += 11;
      used.push(yy);
      return yy;
    };
  };
  const placeL = stacker();
  const placeR = stacker();

  set.slice()
    .sort((a, b) => ratingIdx(a.snaps[1].spRating) - ratingIdx(b.snaps[1].spRating))
    .forEach((row) => {
      const pi = ratingIdx(row.snaps[1].spRating);
      const ci = ratingIdx(row.snaps[0].spRating);
      const dir = migration(row).dir;
      s += `<line class="ch-conn ch-${dir}" x1="${xl}" y1="${y(pi)}" x2="${xr}" y2="${y(ci)}"/>`
        + `<circle class="ch-prior" cx="${xl}" cy="${y(pi)}" r="3"/>`
        + `<circle class="ch-cur ch-${dir}" cx="${xr}" cy="${y(ci)}" r="3.8"/>`
        + `<text class="ch-lab" x="${xl - 7}" y="${placeL(pi) + 3}" text-anchor="end">${esc(row.ticker)} ${esc(row.snaps[1].spRating)}</text>`
        + `<text class="ch-lab ch-${dir}" x="${xr + 7}" y="${placeR(ci) + 3}">${esc(row.snaps[0].spRating)} ${esc(row.ticker)}</text>`;
    });
  return svg(o.w, o.h, s, "Rating migration between the two snapshots");
}

/* 3 ── log-decade strip: FP_PD, SP_PD and EDF for one name */
export function chartPD(row, opt = {}) {
  const o = { w: 520, h: 158, gut: 56, padR: 26, padT: 40, padB: 30, rowH: 22, floor: -28, ...opt };
  if (!row?.snaps?.[0]) return null;
  const x = (v) => {
    const e = isNum(v) && v > 0 ? Math.log10(v) : o.floor;
    const clamped = Math.max(o.floor, Math.min(0, e));
    return o.gut + ((clamped - o.floor) / (0 - o.floor)) * (o.w - o.gut - o.padR);
  };
  const axisY = o.h - o.padB;
  let s = `<line class="ch-axis" x1="${o.gut}" y1="${axisY}" x2="${o.w - o.padR}" y2="${axisY}"/>`;
  for (let e = o.floor; e <= 0; e += 7) {
    const label = e === 0 ? "100%" : `1e${e + 2}%`;
    s += `<line class="ch-grid" x1="${x(10 ** e)}" y1="${o.padT - 14}" x2="${x(10 ** e)}" y2="${axisY}"/>`
      + `<text class="ch-tick" x="${x(10 ** e)}" y="${axisY + 13}" text-anchor="middle">${label}</text>`;
  }
  [
    { k: "fpPd", lab: "FP_PD" },
    { k: "spPd", lab: "SP_PD" },
    { k: "edf", lab: "EDF" },
  ].forEach((m, i) => {
    const yy = o.padT + i * o.rowH;
    const cur = row.snaps[0][m.k];
    const pr = row.snaps[1]?.[m.k];
    s += `<text class="ch-lab" x="2" y="${yy + 3.5}">${m.lab}</text>`;
    if (isNum(pr)) s += `<circle class="ch-prior" cx="${x(pr)}" cy="${yy}" r="3"/>`;
    if (!isNum(cur)) return;
    const dir = !isNum(pr) ? "flat" : cur > pr ? "down" : cur < pr ? "up" : "flat";
    if (isNum(pr)) s += `<line class="ch-conn ch-${dir}" x1="${x(pr)}" y1="${yy}" x2="${x(cur)}" y2="${yy}"/>`;
    s += `<circle class="ch-cur ch-${dir}" cx="${x(cur)}" cy="${yy}" r="4"/>`;
    const txt = cur === 0 ? "0 · underflow" : pct(cur);
    const right = x(cur) + 8 + txt.length * 5.4 < o.w - 2;
    s += `<text class="ch-val" x="${x(cur) + (right ? 8 : -8)}" y="${yy + 3.5}"${right ? "" : ' text-anchor="end"'}>${txt}</text>`;
  });
  s += `<text class="ch-tick" x="2" y="${o.padT - 24}">log decades · hollow = prior snapshot · 0 plots at the floor</text>`;
  return svg(o.w, o.h, s, "Probability of default measures on a log scale");
}

/* 4 ── asset / equity bars at both snapshots, wedge = implied debt */
export function chartAE(row, opt = {}) {
  const o = { w: 520, h: 220, padL: 54, padR: 84, padT: 26, padB: 30, ...opt };
  const snaps = (row?.snaps ?? []).filter((s) => isNum(s?.asset));
  if (snaps.length < 1) return null;
  const max = Math.max(...snaps.map((s) => s.asset)) * 1.06;
  const bw = 22;
  const gap = 6;
  const groupW = bw * 2 + gap;
  const y = (v) => o.padT + (1 - v / max) * (o.h - o.padT - o.padB);
  const base = o.h - o.padB;
  let s = `<line class="ch-axis" x1="${o.padL - 10}" y1="${base}" x2="${o.w - o.padR}" y2="${base}"/>`;
  for (let f = 0; f <= 1.0001; f += 0.25) {
    const v = max * f;
    s += `<line class="ch-grid" x1="${o.padL - 10}" y1="${y(v)}" x2="${o.w - o.padR}" y2="${y(v)}"/>`
      + `<text class="ch-tick" x="${o.padL - 14}" y="${y(v) + 3}" text-anchor="end">${moneyK(v)}</text>`;
  }
  snaps.slice().reverse().forEach((sn, i) => {   // prior first: left → right in time
    const gx = o.padL + 24 + i * (groupW + 46);
    s += `<rect class="ch-bar-a" x="${gx}" y="${y(sn.asset)}" width="${bw}" height="${base - y(sn.asset)}"/>`
      + `<rect class="ch-bar-e" x="${gx + bw + gap}" y="${y(sn.marketCap)}" width="${bw}" height="${base - y(sn.marketCap)}"/>`
      + `<text class="ch-val" x="${gx + groupW + 6}" y="${(y(sn.asset) + y(sn.marketCap)) / 2 + 3}">${moneyK(sn.asset - sn.marketCap)}</text>`
      + `<text class="ch-tick" x="${gx + groupW / 2}" y="${base + 14}" text-anchor="middle">${esc(sn.date)}</text>`;
  });
  s += `<text class="ch-tick" x="${o.padL - 10}" y="${o.padT - 12}">bars: Asset · MarketCap — label: implied debt wedge</text>`;
  return svg(o.w, o.h, s, "Asset value against market capitalisation at both snapshots");
}

/* 5 ── EM convergence: sigma_A per iteration (a short series by nature) */
export function chartEM(series, opt = {}) {
  const o = { w: 520, h: 190, padL: 46, padR: 74, padT: 26, padB: 28, ...opt };
  const hist = series?.sigmaHistory ?? [];
  if (hist.length < 2) return null;
  const lo = Math.min(...hist);
  const hi = Math.max(...hist);
  const spread = hi - lo || hi * 0.1 || 1;
  const yLo = lo - spread * 0.25;
  const yHi = hi + spread * 0.25;
  const x = (i) => o.padL + (i / (hist.length - 1)) * (o.w - o.padL - o.padR);
  const y = (v) => o.padT + (1 - (v - yLo) / (yHi - yLo)) * (o.h - o.padT - o.padB);
  let s = "";
  for (let k = 0; k <= 3; k++) {
    const v = yLo + (yHi - yLo) * (k / 3);
    s += `<line class="ch-grid" x1="${o.padL}" y1="${y(v)}" x2="${o.w - o.padR}" y2="${y(v)}"/>`
      + `<text class="ch-tick" x="${o.padL - 6}" y="${y(v) + 3}" text-anchor="end">${pct(v)}</text>`;
  }
  const final = hist[hist.length - 1];
  s += `<line class="ch-axis" x1="${o.padL}" y1="${o.h - o.padB}" x2="${o.w - o.padR}" y2="${o.h - o.padB}"/>`
    + `<line class="ch-conn ch-flat" x1="${o.padL}" y1="${y(final)}" x2="${o.w - o.padR + 4}" y2="${y(final)}" stroke-dasharray="2 3"/>`
    + `<path class="ch-line-a" d="${hist.map((v, i) => `${i ? "L" : "M"}${x(i)} ${y(v)}`).join(" ")}"/>`;
  hist.forEach((v, i) => {
    const last = i === hist.length - 1;
    s += `<circle class="${last ? "ch-cur" : "ch-prior"}" cx="${x(i)}" cy="${y(v)}" r="${last ? 4 : 3}"/>`
      + `<text class="ch-tick" x="${x(i)}" y="${o.h - o.padB + 12}" text-anchor="middle">${i}</text>`;
  });
  s += `<text class="ch-val" x="${o.w - o.padR + 8}" y="${y(final) + 3.5}">${pct(final)}</text>`
    + `<text class="ch-tick" x="${o.padL}" y="${o.padT - 12}">σ_A per EM iteration · ${hist.length - 1} update${hist.length === 2 ? "" : "s"} to ${series.converged ? "convergence" : "the iteration cap"}</text>`;
  return svg(o.w, o.h, s, "Asset volatility per EM iteration");
}

/* 6 ── the model's own paths: asset, equity, and the stepping default point */
export function chartPaths(series, opt = {}) {
  const o = { w: 520, h: 240, padL: 52, padR: 16, padT: 30, padB: 28, ...opt };
  if (!series?.dates || series.dates.length < 2) return null;
  const n = series.dates.length;
  const hi = Math.max(...series.asset) * 1.04;
  const x = (i) => o.padL + (i / (n - 1)) * (o.w - o.padL - o.padR);
  const y = (v) => o.padT + (1 - v / hi) * (o.h - o.padT - o.padB);
  const path = (arr) => arr.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  let s = "";
  for (let k = 0; k <= 4; k++) {
    const v = hi * (k / 4);
    s += `<line class="ch-grid" x1="${o.padL}" y1="${y(v)}" x2="${o.w - o.padR}" y2="${y(v)}"/>`
      + `<text class="ch-tick" x="${o.padL - 6}" y="${y(v) + 3}" text-anchor="end">${moneyK(v)}</text>`;
  }
  // the default point only moves on quarter ends — draw it as a step
  let step = `M${x(0)} ${y(series.debt[0])}`;
  for (let i = 1; i < n; i++) {
    if (series.debt[i] !== series.debt[i - 1]) {
      step += ` L${x(i)} ${y(series.debt[i - 1])} L${x(i)} ${y(series.debt[i])}`;
    }
  }
  step += ` L${x(n - 1)} ${y(series.debt[n - 1])}`;

  s += `<path class="ch-fill-a" d="${path(series.asset)} L${x(n - 1)} ${y(0)} L${x(0)} ${y(0)} Z"/>`
    + `<path class="ch-line-a" d="${path(series.asset)}"/>`
    + `<path class="ch-line-e" d="${path(series.equity)}"/>`
    + `<path class="ch-line-d" d="${step}"/>`;
  [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1].forEach((i, k) => {
    s += `<text class="ch-tick" x="${x(i)}" y="${o.h - o.padB + 12}" text-anchor="${k === 0 ? "start" : k === 3 ? "end" : "middle"}">${esc(shortDate(series.dates[i]))}</text>`;
  });
  s += `<text class="ch-tick" x="${o.padL}" y="${o.padT - 14}">asset · equity · default point (steps on quarter ends) · ${n} trading days</text>`;
  return svg(o.w, o.h, s, "Asset value, equity and the default point across the calibration window");
}
