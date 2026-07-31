/* ═══════════════════════════════════════════════════════════════════════
   views/appendix.js — provenance. Where each number came from, what the
   units are, and which names the model could not rate. A dashboard that
   hides its failures is not a research tool.
   ═══════════════════════════════════════════════════════════════════════ */

import { esc, num, pct, shortDate, usd } from "../format.js";
import { SNAP_FIELDS } from "../fields.js";
import { state, unrateable } from "../store.js";

export function renderAppendix(root, row, series) {
  const kv = root.querySelector("#app-kv");
  const table = root.querySelector("#app-table");
  const failures = root.querySelector("#app-failures");

  const summary = state.summary ?? {};
  const generated = summary.generated_for ?? {};

  const pairs = [
    ["Constituents", summary.constituents ?? state.index.length],
    ["Rated", summary.rated ?? "—"],
    ["Not rateable", summary.unrateable ?? "—"],
    ["Current cutoff", generated.current ?? "—"],
    ["Prior cutoff", generated.prior ?? "—"],
    ["Window", generated.window ? `${generated.window} d` : "—"],
    ["Monetary unit", "USD thousands"],
    ["Risk-free", "FRED DGS1"],
  ];
  if (row?.snaps) {
    pairs.push(["Selected", row.ticker]);
    pairs.push(["Last quote", usd(row.quote)]);
    if (series) {
      pairs.push(["EM iterations", `${series.iterations}${series.converged ? "" : " (cap)"}`]);
      pairs.push(["Daily bars", series.ohlc ? series.ohlc.dates.length : "—"]);
    }
  }

  kv.innerHTML = pairs
    .map(([k, v]) => `<div><span class="label">${esc(k)}</span><span class="kv__v">${esc(v)}</span></div>`)
    .join("");

  const misses = unrateable();
  failures.innerHTML = misses.length
    ? `<p class="note" style="border:0;padding:0;margin:0 0 .6rem">
         <b>${misses.length} of ${state.index.length}</b> constituents cannot be rated on the cached data.
         Each is listed with the reason the pipeline recorded, not hidden.</p>
       <div class="kv">${misses
         .map((r) => `<div><span class="label">${esc(r.ticker)}</span>
           <span class="kv__v" style="font-size:.78rem;font-weight:400">${esc(r.unrateable_reason)}</span></div>`)
         .join("")}</div>`
    : `<p class="note" style="border:0;padding:0;margin:0">Every constituent rated on this run.</p>`;

  if (!row?.snaps) {
    table.innerHTML = "";
    return;
  }

  // per-day model inputs for the selected name, straight off the series file
  if (!series?.dates) {
    table.innerHTML = `<tbody><tr><td class="is-loading">loading per-day inputs…</td></tr></tbody>`;
    return;
  }
  const n = series.dates.length;
  const rows = [];
  for (let i = n - 1; i >= 0; i--) {
    const bar = series.ohlc && series.ohlc.dates[i] === series.dates[i] ? i : null;
    rows.push(`<tr>
      <td>${esc(shortDate(series.dates[i]))}</td>
      <td>${num(series.asset[i] / 1e6, 2)}</td>
      <td>${num(series.equity[i] / 1e6, 2)}</td>
      <td>${num(series.debt[i] / 1e6, 2)}</td>
      <td>${num((series.asset[i] - series.debt[i]) / series.debt[i], 3)}</td>
      <td>${bar === null ? "—" : usd(series.ohlc.c[bar])}</td>
    </tr>`);
  }
  table.innerHTML = `
    <thead><tr>
      <th>Date</th><th>Asset $M</th><th>Equity $M</th><th>Default point $M</th>
      <th>A/D − 1</th><th>Close</th>
    </tr></thead>
    <tbody>${rows.join("")}</tbody>`;
}

/** the whole index, every field — the sheet a reviewer asks for */
export function renderFullTable(mount) {
  const heads = ["Name", "Sector", "Snapshot", "AssetVol", "AssetRet", "StockVol"]
    .concat(SNAP_FIELDS.map((f) => f.label));
  const rows = [];
  for (const row of state.index) {
    if (!row.snaps) {
      rows.push(`<tr><td>${esc(row.ticker)}</td><td>${esc(row.sector ?? "—")}</td>
        <td colspan="${heads.length - 2}">${esc(row.unrateable_reason)}</td></tr>`);
      continue;
    }
    row.snaps.forEach((snap, i) => {
      rows.push(`<tr>
        <td>${esc(row.ticker)}</td>
        <td>${i ? "·" : esc(row.sector ?? "—")}</td>
        <td>${esc(snap.date)}</td>
        <td>${i ? "·" : pct(row.assetVol)}</td>
        <td>${i ? "·" : num(row.assetRet, 4)}</td>
        <td>${i ? "·" : pct(row.stockVol)}</td>
        ${SNAP_FIELDS.map((f) => `<td>${esc(f.f(snap[f.key]))}</td>`).join("")}
      </tr>`);
    });
  }
  mount.innerHTML = `<thead><tr>${heads.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.join("")}</tbody>`;
}


/**
 * The company page's appendix. Deliberately narrower than the dashboard's:
 * where this name's numbers came from, and the per-day inputs the engine ran
 * on. Index-wide provenance — how many constituents failed, and why — belongs
 * on the dashboard, not on a page about one company.
 */
export function renderTickerAppendix(root, row, series) {
  if (!row) return;
  const generated = state.summary?.generated_for ?? {};
  const pairs = [
    ["Ticker", row.ticker],
    ["Company", row.name],
    ["Sector", row.sector ?? "—"],
    ["Window", generated.window ? `${generated.window} trading days` : "—"],
    ["Last quote", usd(row.quote)],
    ["Monetary unit", "USD thousands"],
    ["Risk-free", "FRED DGS1, per day"],
    ["Source", "massive-api, cached"],
  ];
  if (series) {
    pairs.push(["EM iterations", `${series.iterations}${series.converged ? "" : " (cap)"}`]);
    pairs.push(["Calibrated \u03c3_A", pct(series.sigmaA)]);
    pairs.push(["Trading days", series.dates?.length ?? "—"]);
    pairs.push(["Daily bars", series.ohlc ? series.ohlc.dates.length : "—"]);
  }

  const inputs = !row.snaps
    ? `<p class="note" style="border:0;padding:0">${esc(row.unrateable_reason ?? "Not rateable.")}</p>`
    : !series?.dates
      ? `<div class="is-loading">loading per-day inputs\u2026</div>`
      : perDayTable(series);

  root.innerHTML = `
    <h2 class="section__head">
      <span class="section__no">07</span><span>Appendix</span>
      <span class="section__note">provenance and the per-day inputs for ${esc(row.ticker)}</span>
    </h2>
    <div class="kv">${pairs
      .map(([k, v]) => `<div><span class="label">${esc(k)}</span><span class="kv__v">${esc(v)}</span></div>`)
      .join("")}</div>
    <details class="fold" style="margin-top:1.2rem">
      <summary>Per-day model inputs<span class="fold__ct">${
        series?.dates ? `${series.dates.length} rows` : ""
      }</span></summary>
      <div class="tscroll" style="max-height:24rem;overflow:auto">${inputs}</div>
    </details>
    <p class="note">Asset value is the EM-recovered V_A; the default point is the quarter's debt carried
      forward to each trading day, which is why it steps rather than drifts.</p>`;
}

function perDayTable(series) {
  const rows = [];
  for (let i = series.dates.length - 1; i >= 0; i--) {
    const bar = series.ohlc && series.ohlc.dates[i] === series.dates[i] ? i : null;
    rows.push(`<tr>
      <td>${esc(shortDate(series.dates[i]))}</td>
      <td>${num(series.asset[i] / 1e6, 2)}</td>
      <td>${num(series.equity[i] / 1e6, 2)}</td>
      <td>${num(series.debt[i] / 1e6, 2)}</td>
      <td>${num((series.asset[i] - series.debt[i]) / series.debt[i], 3)}</td>
      <td>${series.path?.dd ? num(series.path.dd[i], 3) : "\u2014"}</td>
      <td>${series.path?.spRating ? esc(series.path.spRating[i]) : "\u2014"}</td>
      <td>${bar === null ? "\u2014" : usd(series.ohlc.c[bar])}</td>
    </tr>`);
  }
  return `<table class="entries"><thead><tr>
      <th>Date</th><th>Asset $M</th><th>Equity $M</th><th>Default point $M</th>
      <th>A/D \u2212 1</th><th>DD</th><th>Rating</th><th>Close</th>
    </tr></thead><tbody>${rows.join("")}</tbody></table>`;
}
