/* ═══════════════════════════════════════════════════════════════════════
   tic-lib.js — shared, theme-agnostic layer for the style prototypes.

   Holds three things and nothing else:
     1. FIELDS  — the canonical, ordered inventory of every entry in
                  "TiC Rating(Prof 更新).xlsx". Themes iterate this, so a
                  theme cannot silently omit a column.
     2. fmt     — formatters (tiny probabilities, $ thousands, ratings).
     3. charts  — SVG builders. All colour/type comes from CSS classes,
                  so each theme restyles the same geometry.
   ═══════════════════════════════════════════════════════════════════════ */
(function (root) {
  "use strict";

  const DASH = "—";
  const isNum = (v) => typeof v === "number" && isFinite(v);

  /* ── formatters ──────────────────────────────────────────────────── */

  // sheet stores asset / marketCap in THOUSANDS of USD
  function moneyK(v) {
    if (!isNum(v)) return DASH;
    const a = Math.abs(v) * 1e3, sign = v < 0 ? "−" : "";
    for (const [d, s] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]]) {
      if (a >= d) return sign + "$" + (a / d).toFixed(2) + s;
    }
    return sign + "$" + a.toFixed(0);
  }

  function usd(v) { return isNum(v) ? "$" + v.toFixed(2) : DASH; }

  // probabilities span 1e-27 … 0.97 in this dataset, so switch to
  // exponential rather than rounding everything interesting to 0.0000%
  function pct(v) {
    if (!isNum(v)) return DASH;
    if (v === 0) return "0";
    const p = v * 100, abs = Math.abs(p);
    if (abs < 1e-3) return p.toExponential(2) + "%";
    if (abs < 1) return p.toFixed(4) + "%";
    if (abs < 10) return p.toFixed(3) + "%";
    return p.toFixed(2) + "%";
  }

  function num(v, d) {
    if (!isNum(v)) return DASH;
    return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  const fmt = {
    moneyK, usd, pct, num, DASH, isNum,
    // signed change, formatted with the same formatter as the field
    delta(cur, prior, f) {
      if (!isNum(cur) || !isNum(prior)) return DASH;
      const d = cur - prior;
      if (d === 0) return "±0";
      return (d > 0 ? "+" : "−") + f(Math.abs(d)).replace(/^[−+]/, "");
    },
  };

  /* ── S&P scale ───────────────────────────────────────────────────── */

  // the sheet emits "AAA-", which is not a real S&P notch but is kept
  // verbatim so the UI never disagrees with the model output
  const SCALE = ["AAA", "AAA-", "AA+", "AA", "AA-", "A+", "A", "A-",
    "BBB+", "BBB", "BBB-", "BB+", "BB", "BB-", "B+", "B", "B-",
    "CCC+", "CCC", "CCC-", "CC", "C", "D"];

  const ratingIdx = (l) => { const i = SCALE.indexOf(String(l).trim()); return i < 0 ? SCALE.length - 1 : i; };

  // investment-grade boundary sits between BBB- and BB+
  const isIG = (l) => ratingIdx(l) <= SCALE.indexOf("BBB-");

  function bucket(l) {
    const L = String(l || "").toUpperCase();
    if (L.startsWith("AAA") || L.startsWith("AA")) return "aaa";
    if (L.startsWith("A") || L.startsWith("BBB")) return "a";
    if (L.startsWith("BB") || L.startsWith("B")) return "bb";
    return "ccc";
  }

  // migration between the two snapshots: negative index move = upgrade
  function migration(co) {
    const [cur, prior] = co.snaps;
    const notches = ratingIdx(prior.spRating) - ratingIdx(cur.spRating);
    return { notches, dir: notches > 0 ? "up" : notches < 0 ? "down" : "flat" };
  }

  function outlook(sym) {
    const s = String(sym || "").trim();
    if (s === "+") return { sym: "▲", label: "positive", cls: "up", raw: "+" };
    if (s === "-") return { sym: "▼", label: "negative", cls: "down", raw: "−" };
    return { sym: "■", label: "stable", cls: "flat", raw: s || DASH };
  }

  /* ── canonical field inventory (mirrors the workbook) ────────────── */

  // company-level: one value per ticker
  const HEADER_FIELDS = [
    { key: "ticker", label: "Ticker", src: "row 2", f: (v) => v },
    { key: "quote", label: "Last quote", src: "row 2", f: usd },
    { key: "asof", label: "As of", src: "row 1", f: (v) => v },
    { key: "window", label: "Window", src: "row 3", f: (v) => v + " d" },
  ];

  // calibration: one EM fit per ticker, shared by both snapshots
  const CALIB_FIELDS = [
    { key: "assetVol", label: "AssetVol", gloss: "σ<sub>A</sub> — calibrated asset volatility", f: pct },
    { key: "assetRet", label: "AssetRet", gloss: "R<sub>A</sub> — annualised asset drift", f: (v) => num(v, 4) },
    { key: "stockVol", label: "StockVol", gloss: "σ<sub>E</sub> — observed equity volatility", f: pct },
  ];

  // snapshot: repeated for the current and the prior date
  const SNAP_FIELDS = [
    { key: "asset", label: "Asset", gloss: "market value of assets V<sub>A</sub>", f: moneyK, better: "up" },
    { key: "marketCap", label: "MarketCap", gloss: "market value of equity E", f: moneyK, better: "up" },
    { key: "price", label: "Price", gloss: "dividend-adjusted close on the snapshot date", f: usd, better: "up" },
    { key: "mu", label: "Mu", gloss: "μ — implied life expectancy, years", f: (v) => num(v, 4), better: "up" },
    { key: "ccm", label: "CCM", gloss: "credit cycle multiplier, point-in-time", f: (v) => num(v, 6), better: "down" },
    { key: "rs", label: "RS", gloss: "RiskScore = 100 · TiC", f: (v) => num(v, 4), better: "down" },
    { key: "fpPd", label: "FP_PD", gloss: "first-passage probability of default", f: pct, better: "down" },
    { key: "alpha", label: "Alpha", gloss: "α — PIT→TTC blending weight", f: (v) => num(v, 6) },
    { key: "spCcm", label: "SP_CCM", gloss: "CCM* rebased to the S&amp;P through-the-cycle level", f: (v) => num(v, 6) },
    { key: "spPd", label: "SP_PD", gloss: "through-the-cycle PD on the S&amp;P scale", f: pct, better: "down" },
    { key: "spRating", label: "SP_Rating", gloss: "letter grade, fine notch", f: (v) => v || DASH, rating: true },
    { key: "dd", label: "DD", gloss: "distance to default, σ units", f: (v) => num(v, 4), better: "up" },
    { key: "edf", label: "EDF", gloss: "expected default frequency, Merton closed form", f: pct, better: "down" },
    { key: "outlook", label: "Outlook", gloss: "sign of the credit outlook derivative", f: (v) => outlook(v).raw, flag: true },
  ];

  const byTicker = (t) => (root.TIC_DATA || []).find((c) => c.ticker === t);

  /* change between the two snapshots for one field, with a direction class
     that already accounts for whether up or down is the good news */
  function deltaInfo(field, cur, prior) {
    if (field.rating) {
      const n = ratingIdx(prior) - ratingIdx(cur);
      if (!n) return { text: "unchanged", cls: "flat" };
      return { text: (n > 0 ? "+" : "−") + Math.abs(n) + (Math.abs(n) === 1 ? " notch" : " notches"), cls: n > 0 ? "up" : "down" };
    }
    if (field.flag) {
      const a = outlook(cur), b = outlook(prior);
      return { text: a.raw === b.raw ? "unchanged" : b.raw + " → " + a.raw, cls: a.cls };
    }
    if (!isNum(cur) || !isNum(prior)) return { text: DASH, cls: "flat" };
    const d = cur - prior;
    if (d === 0) return { text: "±0", cls: "flat" };
    let cls = "flat";
    if (field.better === "up") cls = d > 0 ? "up" : "down";
    else if (field.better === "down") cls = d < 0 ? "up" : "down";
    const mag = field.f(Math.abs(d));
    return { text: (d > 0 ? "+" : "−") + String(mag).replace(/^[−+]/, ""), cls };
  }

  /* ── chart builders ──────────────────────────────────────────────────
     Every builder returns an SVG string using these classes:
       .ch-grid .ch-axis .ch-tick .ch-conn .ch-cur .ch-prior
       .ch-bar-a .ch-bar-e .ch-lab .ch-val .ch-up .ch-down .ch-flat
     ───────────────────────────────────────────────────────────────── */

  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const svg = (w, h, inner, label) =>
    `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;

  /* 1 ── DD dumbbell: prior → current distance to default, all tickers */
  function chartDD(cos, opt) {
    const o = Object.assign({ w: 460, rowH: 26, padL: 46, padR: 40, padT: 22, padB: 24 }, opt);
    const rows = cos.slice().sort((a, b) => b.snaps[0].dd - a.snaps[0].dd);
    const h = o.padT + rows.length * o.rowH + o.padB;
    const max = Math.ceil(Math.max(...rows.flatMap((c) => [c.snaps[0].dd, c.snaps[1].dd])) + 0.6);
    const x = (v) => o.padL + (v / max) * (o.w - o.padL - o.padR);
    let s = "";

    for (let t = 0; t <= max; t += max > 8 ? 3 : 2) {
      s += `<line class="ch-grid" x1="${x(t)}" y1="${o.padT - 8}" x2="${x(t)}" y2="${h - o.padB}"/>`
        + `<text class="ch-tick" x="${x(t)}" y="${h - o.padB + 12}" text-anchor="middle">${t}</text>`;
    }
    rows.forEach((c, i) => {
      const y = o.padT + i * o.rowH + o.rowH / 2;
      const cur = c.snaps[0].dd, pr = c.snaps[1].dd;
      const dir = cur > pr ? "up" : cur < pr ? "down" : "flat";
      s += `<text class="ch-lab" x="${o.padL - 8}" y="${y + 3.5}" text-anchor="end">${esc(c.ticker)}</text>`
        + `<line class="ch-conn ch-${dir}" x1="${x(pr)}" y1="${y}" x2="${x(cur)}" y2="${y}"/>`
        + `<circle class="ch-prior" cx="${x(pr)}" cy="${y}" r="3.4"/>`
        + `<circle class="ch-cur ch-${dir}" cx="${x(cur)}" cy="${y}" r="4.4"/>`
        + `<text class="ch-val" x="${o.w - o.padR + 6}" y="${y + 3.5}">${num(cur, 2)}</text>`;
    });
    s += `<text class="ch-tick" x="${o.padL}" y="${o.padT - 12}">σ units from the default barrier · hollow = ${esc(rows[0].snaps[1].date)}</text>`;
    return svg(o.w, h, s, "Distance to default for each ticker, prior versus current snapshot");
  }

  /* 2 ── rating migration slope: prior notch → current notch */
  function chartMigration(cos, opt) {
    const o = Object.assign({ w: 460, h: 300, padT: 30, padB: 22, padL: 84, padR: 84 }, opt);
    const all = cos.flatMap((c) => c.snaps.map((s) => ratingIdx(s.spRating)));
    const lo = Math.min(...all) - 1, hi = Math.max(...all) + 1;
    const y = (idx) => o.padT + ((idx - lo) / (hi - lo)) * (o.h - o.padT - o.padB);
    const xl = o.padL, xr = o.w - o.padR;
    let s = `<line class="ch-axis" x1="${xl}" y1="${o.padT - 10}" x2="${xl}" y2="${o.h - o.padB}"/>`
      + `<line class="ch-axis" x1="${xr}" y1="${o.padT - 10}" x2="${xr}" y2="${o.h - o.padB}"/>`
      + `<text class="ch-tick" x="${xl}" y="${o.padT - 16}" text-anchor="middle">${esc(cos[0].snaps[1].date)}</text>`
      + `<text class="ch-tick" x="${xr}" y="${o.padT - 16}" text-anchor="middle">${esc(cos[0].snaps[0].date)}</text>`;

    // investment-grade boundary
    const bIdx = SCALE.indexOf("BBB-") + 0.5;
    if (bIdx > lo && bIdx < hi) {
      s += `<line class="ch-grid ch-ig" x1="${xl}" y1="${y(bIdx)}" x2="${xr}" y2="${y(bIdx)}"/>`
        + `<text class="ch-tick ch-ig-lab" x="${(xl + xr) / 2}" y="${y(bIdx) - 5}" text-anchor="middle">investment grade ↑</text>`;
    }
    // de-collide labels per side
    const stackLabels = (side) => {
      const used = [];
      return (idx) => { let yy = y(idx); while (used.some((u) => Math.abs(u - yy) < 11)) yy += 11; used.push(yy); return yy; };
    };
    const placeL = stackLabels("l"), placeR = stackLabels("r");
    cos.slice().sort((a, b) => ratingIdx(a.snaps[1].spRating) - ratingIdx(b.snaps[1].spRating)).forEach((c) => {
      const pi = ratingIdx(c.snaps[1].spRating), ci = ratingIdx(c.snaps[0].spRating);
      const dir = migration(c).dir;
      s += `<line class="ch-conn ch-${dir}" x1="${xl}" y1="${y(pi)}" x2="${xr}" y2="${y(ci)}"/>`
        + `<circle class="ch-prior" cx="${xl}" cy="${y(pi)}" r="3"/>`
        + `<circle class="ch-cur ch-${dir}" cx="${xr}" cy="${y(ci)}" r="3.8"/>`
        + `<text class="ch-lab" x="${xl - 7}" y="${placeL(pi) + 3}" text-anchor="end">${esc(c.ticker)} ${esc(c.snaps[1].spRating)}</text>`
        + `<text class="ch-lab ch-${dir}" x="${xr + 7}" y="${placeR(ci) + 3}">${esc(c.snaps[0].spRating)} ${esc(c.ticker)}</text>`;
    });
    return svg(o.w, o.h, s, "Rating migration between the prior and current snapshot for each ticker");
  }

  /* 3 ── log-decade strip: FP_PD, SP_PD and EDF for one company */
  function chartPD(co, opt) {
    const o = Object.assign({ w: 460, h: 158, gut: 56, padR: 26, padT: 40, padB: 30, rowH: 22, floor: -28 }, opt);
    const x = (v) => {
      const e = isNum(v) && v > 0 ? Math.log10(v) : o.floor;
      const cl = Math.max(o.floor, Math.min(0, e));
      return o.gut + ((cl - o.floor) / (0 - o.floor)) * (o.w - o.gut - o.padR);
    };
    const axisY = o.h - o.padB;
    let s = `<line class="ch-axis" x1="${o.gut}" y1="${axisY}" x2="${o.w - o.padR}" y2="${axisY}"/>`;
    for (let e = o.floor; e <= 0; e += 7) {
      const lab = e === 0 ? "100%" : "1e" + (e + 2) + "%";
      s += `<line class="ch-grid" x1="${x(Math.pow(10, e))}" y1="${o.padT - 14}" x2="${x(Math.pow(10, e))}" y2="${axisY}"/>`
        + `<text class="ch-tick" x="${x(Math.pow(10, e))}" y="${axisY + 13}" text-anchor="middle">${lab}</text>`;
    }
    [{ k: "fpPd", lab: "FP_PD" }, { k: "spPd", lab: "SP_PD" }, { k: "edf", lab: "EDF" }].forEach((m, row) => {
      const yy = o.padT + row * o.rowH;
      const cur = co.snaps[0][m.k], pr = co.snaps[1][m.k];
      s += `<text class="ch-lab" x="2" y="${yy + 3.5}">${m.lab}</text>`;
      if (isNum(pr)) s += `<circle class="ch-prior" cx="${x(pr)}" cy="${yy}" r="3"/>`;
      if (!isNum(cur)) return;
      const dir = cur > pr ? "down" : cur < pr ? "up" : "flat"; // a higher PD is the bad direction
      s += `<line class="ch-conn ch-${dir}" x1="${x(pr)}" y1="${yy}" x2="${x(cur)}" y2="${yy}"/>`
        + `<circle class="ch-cur ch-${dir}" cx="${x(cur)}" cy="${yy}" r="4"/>`;
      // keep the value label inside the frame
      const txt = cur === 0 ? "0 · underflow" : pct(cur);
      const right = x(cur) + 8 + txt.length * 5.4 < o.w - 2;
      s += `<text class="ch-val" x="${x(cur) + (right ? 8 : -8)}" y="${yy + 3.5}"${right ? "" : ' text-anchor="end"'}>${txt}</text>`;
    });
    s += `<text class="ch-tick" x="2" y="${o.padT - 24}">log decades · hollow marker = ${esc(co.snaps[1].date)} · 0 plots at the floor</text>`;
    return svg(o.w, o.h, s, "Probability of default measures for the selected company on a log scale");
  }

  /* 4 ── asset / equity bars for the two snapshots, wedge = implied debt */
  function chartAE(co, opt) {
    const o = Object.assign({ w: 460, h: 210, padL: 54, padR: 84, padT: 26, padB: 30 }, opt);
    const max = Math.max(...co.snaps.map((s) => s.asset)) * 1.06;
    const bw = 22, gap = 6;
    const groupW = bw * 2 + gap;
    const y = (v) => o.padT + (1 - v / max) * (o.h - o.padT - o.padB);
    const base = o.h - o.padB;
    let s = `<line class="ch-axis" x1="${o.padL - 10}" y1="${base}" x2="${o.w - o.padR}" y2="${base}"/>`;
    for (let f = 0; f <= 1.0001; f += 0.25) {
      const v = max * f;
      s += `<line class="ch-grid" x1="${o.padL - 10}" y1="${y(v)}" x2="${o.w - o.padR}" y2="${y(v)}"/>`
        + `<text class="ch-tick" x="${o.padL - 14}" y="${y(v) + 3}" text-anchor="end">${moneyK(v)}</text>`;
    }
    // prior first, so the chart reads left → right in time
    [co.snaps[1], co.snaps[0]].forEach((sn, i) => {
      const gx = o.padL + 24 + i * (groupW + 46);
      s += `<rect class="ch-bar-a" x="${gx}" y="${y(sn.asset)}" width="${bw}" height="${base - y(sn.asset)}"/>`
        + `<rect class="ch-bar-e" x="${gx + bw + gap}" y="${y(sn.marketCap)}" width="${bw}" height="${base - y(sn.marketCap)}"/>`
        + `<line class="ch-conn ch-flat" x1="${gx + 3}" y1="${y(sn.asset)}" x2="${gx + bw + gap + bw - 3}" y2="${y(sn.asset)}" stroke-dasharray="2 3"/>`
        + `<text class="ch-val" x="${gx + groupW + 6}" y="${(y(sn.asset) + y(sn.marketCap)) / 2 + 3}">${moneyK(sn.asset - sn.marketCap)}</text>`
        + `<text class="ch-tick" x="${gx + groupW / 2}" y="${base + 14}" text-anchor="middle">${esc(sn.date)}</text>`;
    });
    s += `<text class="ch-tick" x="${o.padL - 10}" y="${o.padT - 12}">bars: Asset · MarketCap  —  right label: implied debt wedge</text>`;
    return svg(o.w, o.h, s, "Asset value versus market capitalisation for both snapshots");
  }

  /* 5 ── EM convergence: sigma_A per iteration.
     The engine converges in 2–7 iterations, so this is a short series by
     nature — draw the markers rather than pretending it is a smooth curve. */
  function chartEM(s, opt) {
    const o = Object.assign({ w: 460, h: 190, padL: 46, padR: 74, padT: 26, padB: 28 }, opt);
    const hist = (s && s.sigmaHistory) || [];
    if (hist.length < 2) return null;
    const lo = Math.min(...hist), hi = Math.max(...hist);
    const span = (hi - lo) || hi * 0.1 || 1;
    const yLo = lo - span * 0.25, yHi = hi + span * 0.25;
    const x = (i) => o.padL + (hist.length === 1 ? 0 : i / (hist.length - 1)) * (o.w - o.padL - o.padR);
    const y = (v) => o.padT + (1 - (v - yLo) / (yHi - yLo)) * (o.h - o.padT - o.padB);
    let g = "";
    for (let k = 0; k <= 3; k++) {
      const v = yLo + (yHi - yLo) * (k / 3);
      g += `<line class="ch-grid" x1="${o.padL}" y1="${y(v)}" x2="${o.w - o.padR}" y2="${y(v)}"/>`
        + `<text class="ch-tick" x="${o.padL - 6}" y="${y(v) + 3}" text-anchor="end">${pct(v)}</text>`;
    }
    g += `<line class="ch-axis" x1="${o.padL}" y1="${o.h - o.padB}" x2="${o.w - o.padR}" y2="${o.h - o.padB}"/>`;
    const final = hist[hist.length - 1];
    g += `<line class="ch-conn ch-flat" x1="${o.padL}" y1="${y(final)}" x2="${o.w - o.padR + 4}" y2="${y(final)}" stroke-dasharray="2 3"/>`
      + `<path class="ch-line-a" d="${hist.map((v, i) => (i ? "L" : "M") + x(i) + " " + y(v)).join(" ")}"/>`;
    hist.forEach((v, i) => {
      g += `<circle class="${i === hist.length - 1 ? "ch-cur" : "ch-prior"}" cx="${x(i)}" cy="${y(v)}" r="${i === hist.length - 1 ? 4 : 3}"/>`
        + `<text class="ch-tick" x="${x(i)}" y="${o.h - o.padB + 12}" text-anchor="middle">${i}</text>`;
    });
    g += `<text class="ch-val" x="${o.w - o.padR + 8}" y="${y(final) + 3.5}">${pct(final)}</text>`
      + `<text class="ch-tick" x="${o.padL}" y="${o.padT - 12}">σ_A per EM iteration · ${hist.length - 1} update${hist.length === 2 ? "" : "s"} to ${s.converged ? "convergence" : "the iteration cap"}</text>`;
    return svg(o.w, o.h, g, "Asset volatility per EM iteration");
  }

  /* 6 ── the paths the workbook does not carry: asset value, equity and the
     quarterly default point over the calibration window. The gap between the
     asset path and the step line is what DD measures. */
  function chartPaths(s, opt) {
    const o = Object.assign({ w: 460, h: 230, padL: 52, padR: 16, padT: 30, padB: 28 }, opt);
    if (!s || !s.dates || s.dates.length < 2) return null;
    const n = s.dates.length;
    const hi = Math.max(...s.asset) * 1.04, lo = 0;
    const x = (i) => o.padL + (i / (n - 1)) * (o.w - o.padL - o.padR);
    const y = (v) => o.padT + (1 - (v - lo) / (hi - lo)) * (o.h - o.padT - o.padB);
    const path = (arr) => arr.map((v, i) => (i ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join(" ");
    let g = "";
    for (let k = 0; k <= 4; k++) {
      const v = lo + (hi - lo) * (k / 4);
      g += `<line class="ch-grid" x1="${o.padL}" y1="${y(v)}" x2="${o.w - o.padR}" y2="${y(v)}"/>`
        + `<text class="ch-tick" x="${o.padL - 6}" y="${y(v) + 3}" text-anchor="end">${moneyK(v)}</text>`;
    }
    // the default point only moves on quarter ends, so draw it as a step
    let step = "M" + x(0) + " " + y(s.debt[0]);
    for (let i = 1; i < n; i++) {
      if (s.debt[i] !== s.debt[i - 1]) step += ` L${x(i)} ${y(s.debt[i - 1])} L${x(i)} ${y(s.debt[i])}`;
    }
    step += ` L${x(n - 1)} ${y(s.debt[n - 1])}`;
    g += `<path class="ch-fill-a" d="${path(s.asset)} L${x(n - 1)} ${y(0)} L${x(0)} ${y(0)} Z"/>`
      + `<path class="ch-line-a" d="${path(s.asset)}"/>`
      + `<path class="ch-line-e" d="${path(s.equity)}"/>`
      + `<path class="ch-line-d" d="${step}"/>`;
    [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1].forEach((i, k) => {
      g += `<text class="ch-tick" x="${x(i)}" y="${o.h - o.padB + 12}" text-anchor="${k === 0 ? "start" : k === 3 ? "end" : "middle"}">${esc(s.dates[i])}</text>`;
    });
    g += `<text class="ch-tick" x="${o.padL}" y="${o.padT - 14}">asset value · equity · default point (steps on quarter ends) · ${n} trading days</text>`;
    return svg(o.w, o.h, g, "Asset value, equity and the default point across the calibration window");
  }

  const series = (t) => (root.TIC_SERIES || {})[t] || null;

  root.TIC = {
    series,
    fmt, SCALE, ratingIdx, isIG, bucket, migration, outlook, byTicker, esc, deltaInfo,
    HEADER_FIELDS, CALIB_FIELDS, SNAP_FIELDS,
    charts: { dd: chartDD, migration: chartMigration, pd: chartPD, ae: chartAE, em: chartEM, paths: chartPaths },
    get all() { return root.TIC_DATA || []; },
  };
})(window);
