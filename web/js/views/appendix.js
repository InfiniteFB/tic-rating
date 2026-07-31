/* ═══════════════════════════════════════════════════════════════════════
   views/appendix.js — provenance. Where each number came from, what the
   units are, and which names the model could not rate. A dashboard that
   hides its failures is not a research tool.
   ═══════════════════════════════════════════════════════════════════════ */

import { esc, moneyK, num, pct, shares, shortDate, usd } from "../format.js";
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
 * The company page's appendix — the provenance chain, in reading order:
 * who this is, where every number came from, what the calibration settled on,
 * then the raw filings the default point is built from, and finally the
 * per-day inputs the engine actually consumed. Nothing on the page above
 * should be untraceable from here.
 */
export function renderTickerAppendix(root, row, series) {
  if (!row) return;
  const generated = state.summary?.generated_for ?? {};

  const block = (title, pairs) => `
    <div class="appx__block">
      <div class="appx__title">${esc(title)}</div>
      <div class="kv">${pairs
        .map(([k, v]) => `<div><span class="label">${esc(k)}</span><span class="kv__v">${esc(v)}</span></div>`)
        .join("")}</div>
    </div>`;

  const identity = block("Identity", [
    ["Ticker", row.ticker],
    ["Company", row.legalName ?? row.name],
    ["Sector", row.sector ?? "—"],
    ["Last quote", usd(row.quote)],
  ]);

  const sources = block("Sources", [
    ["Prices, deep", series?.priceSource ?? "yahoo 10y"],
    ["Prices, recent", "massive-api aggregates"],
    ["Balance sheet", "massive-api, quarterly"],
    ["Share counts", "income statements, quarterly"],
    ["Risk-free", "FRED DGS1, per day"],
    ["Monetary unit", "USD thousands, as filed"],
  ]);

  const calibration = block("Calibration — the rating date's own fit", [
    ["Window", generated.window ? `${generated.window} trading days` : "—"],
    ["σ_A", series ? pct(series.sigmaA) : "—"],
    ["σ_E", series ? pct(series.sigmaE) : "—"],
    ["R_A", series ? num(series.rA, 4) : "—"],
    ["EM iterations", series ? `${series.iterations}${series.converged ? "" : " (cap)"}` : "—"],
    ["Rated days", series?.dates?.length ?? "—"],
  ]);

  const quarters = !row.snaps
    ? `<p class="note" style="border:0;padding:0">${esc(row.unrateable_reason ?? "Not rateable.")}</p>`
    : quartersTable(series);
  const inputs = !row.snaps
    ? ""
    : !series?.dates
      ? `<div class="is-loading">loading per-day inputs\u2026</div>`
      : perDayTable(series);

  root.innerHTML = `
    <h2 class="section__head">
      <span class="section__no">08</span><span>Appendix</span>
      <span class="section__note">the provenance chain for ${esc(row.ticker)}</span>
    </h2>
    <div class="appx">${identity}${sources}${calibration}</div>
    <details class="fold" open>
      <summary>Quarterly filings — what the default point is built from<span class="fold__ct">${
        series?.quarters ? `${series.quarters.length} quarters` : ""
      }</span></summary>
      <div class="tscroll" style="max-height:24rem;overflow:auto">${quarters}</div>
      <p class="note">Straight off the filings, in thousands of USD. The default point on any day is the most
        recent quarter's short-term debt plus long-term debt (strict handling: a quarter missing a component is
        skipped); shares are the quarter's basic count, which is why a 2017 market cap uses 2017's float.</p>
    </details>
    <details class="fold">
      <summary>Per-day model inputs<span class="fold__ct">${
        series?.dates ? `${series.dates.length} rows` : ""
      }</span></summary>
      <div class="tscroll" style="max-height:24rem;overflow:auto">${inputs}</div>
      <p class="note">Asset value is the EM-recovered V_A; the default point steps on quarter ends rather than
        drifting, because that is when the filings change.</p>
    </details>`;
}

function quartersTable(series) {
  const rows = series?.quarters ?? [];
  if (!rows.length) return `<p class="note" style="border:0;padding:0">No quarterly filings in the capture.</p>`;
  const money = (v) => (v == null ? "\u2014" : moneyK(v));
  const body = rows
    .slice()
    .reverse()
    .map((q) => `<tr>
      <td>${esc(q.periodEnd)}</td>
      <td>${esc(q.filed ?? "\u2014")}</td>
      <td>${money(q.debtCurrent)}</td>
      <td>${money(q.longTermDebt)}</td>
      <td>${money(q.totalLiabilities)}</td>
      <td>${money(q.totalCurrentLiabilities)}</td>
      <td>${q.shares == null ? "\u2014" : shares(q.shares)}</td>
    </tr>`)
    .join("");
  return `<table class="entries"><thead><tr>
      <th>Period end</th><th>Filed</th><th>Current debt</th><th>LT debt + leases</th>
      <th>Total liabilities</th><th>Current liabilities</th><th>Basic shares</th>
    </tr></thead><tbody>${body}</tbody></table>`;
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
