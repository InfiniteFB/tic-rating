/* ═══════════════════════════════════════════════════════════════════════
   views/entries.js — every entry the model emits, at both snapshots, with
   the change. Iterates the field inventory from fields.js, so this table is
   complete by construction rather than by review.
   ═══════════════════════════════════════════════════════════════════════ */

import { esc, pct } from "../format.js";
import { CALIB_FIELDS, HEADER_FIELDS, SNAP_FIELDS, deltaInfo, isIG, outlook } from "../fields.js";

const KEY_ROWS = new Set(["spRating", "dd", "spPd"]);

export function renderEntries(snapMount, calibMount, row) {
  if (!row?.snaps) {
    snapMount.innerHTML = "";
    calibMount.innerHTML = "";
    return;
  }
  const [cur, prior] = row.snaps;

  const body = SNAP_FIELDS.map((f) => {
    const delta = deltaInfo(f, cur[f.key], prior?.[f.key]);
    const tone = f.rating
      ? isIG(cur.spRating) ? "" : "spec"
      : f.flag ? outlook(cur.outlook).cls : "";
    return `<tr${KEY_ROWS.has(f.key) ? ' class="is-key"' : ""}>
      <th scope="row">${f.label}${f.key === "rs" ? " †" : ""}
        <span class="entries__gloss">${f.gloss}</span></th>
      <td class="${tone}">${esc(f.f(cur[f.key]))}</td>
      <td class="is-prior">${esc(prior ? f.f(prior[f.key]) : "—")}</td>
      <td class="is-change ${delta.cls}">${delta.text}</td>
    </tr>`;
  }).join("");

  snapMount.innerHTML = `
    <thead><tr>
      <th>Snapshot entry</th>
      <th>${esc(cur.date)}</th>
      <th>${esc(prior?.date ?? "prior")}</th>
      <th>Change</th>
    </tr></thead>
    <tbody>${body}</tbody>`;

  const calib = CALIB_FIELDS.map((f) => `<tr class="is-key">
      <th scope="row">${f.label}<span class="entries__gloss">${f.gloss}</span></th>
      <td>${esc(f.f(row[f.key]))}</td>
    </tr>`).join("");

  const header = HEADER_FIELDS.map((f) => `<tr>
      <th scope="row">${f.label}<span class="entries__gloss">${f.gloss}</span></th>
      <td style="font-size:var(--t-body);font-weight:500">${esc(f.f(row[f.key]))}</td>
    </tr>`).join("");

  calibMount.innerHTML = `
    <thead><tr><th>Calibration &amp; header</th><th>Value</th></tr></thead>
    <tbody>
      ${calib}
      ${header}
      <tr><th scope="row">Company<span class="entries__gloss">as filed in the index</span></th>
        <td style="font-size:var(--t-body);font-weight:500">${esc(row.name)}</td></tr>
      <tr><th scope="row">σ_A ÷ σ_E<span class="entries__gloss">asset volatility as a share of equity volatility</span></th>
        <td style="font-size:var(--t-body);font-weight:500">${
          row.stockVol ? pct(row.assetVol / row.stockVol) : "—"
        }</td></tr>
    </tbody>`;
}
