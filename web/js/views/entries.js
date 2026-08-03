/* ═══════════════════════════════════════════════════════════════════════
   views/entries.js — every entry the model emits, at both snapshots, with
   the change. Iterates the field inventory from fields.js, so this table is
   complete by construction rather than by review.

   Every row that has a derivation carries a red + — it opens the general
   formula with the selected day's numbers substituted (derivations.js).
   The open set survives repaints, so dragging the date slider live-updates
   the substituted numbers instead of snapping the fold shut.
   ═══════════════════════════════════════════════════════════════════════ */

import { esc, pct } from "../format.js";
import { CALIB_FIELDS, HEADER_FIELDS, SNAP_FIELDS, deltaInfo, isIG, outlook } from "../fields.js";
import { DERIVATIONS, renderDerivation } from "../derivations.js";

const KEY_ROWS = new Set(["spRating", "dd", "spPd"]);

const open = new Set();
let last = null;

const howBtn = (key) =>
  DERIVATIONS[key]
    ? `<button class="how" data-how="${key}" aria-expanded="${open.has(key)}"
         aria-label="How ${key} is derived">${open.has(key) ? "−" : "+"}</button>`
    : "";

const deriveRow = (key, ctx, span) =>
  open.has(key) && DERIVATIONS[key]
    ? `<tr class="derive"><td colspan="${span}">${renderDerivation(key, ctx)}</td></tr>`
    : "";

export function renderEntries(snapMount, calibMount, row, cur, prior) {
  last = { snapMount, calibMount, row, cur, prior };
  wireToggles(snapMount);
  wireToggles(calibMount);

  if (!row?.snaps || !cur) {
    snapMount.innerHTML = "";
    calibMount.innerHTML = "";
    return;
  }

  const snapCtx = { ...row, ...cur };

  const body = SNAP_FIELDS.map((f) => {
    const delta = deltaInfo(f, cur[f.key], prior?.[f.key]);
    const tone = f.rating
      ? isIG(cur.spRating) ? "" : "spec"
      : f.flag ? outlook(cur.outlook).cls : "";
    return `<tr${KEY_ROWS.has(f.key) ? ' class="is-key"' : ""}>
      <th scope="row">${f.label}${f.key === "rs" ? " †" : ""}${howBtn(f.key)}
        <span class="entries__gloss">${f.gloss}</span></th>
      <td class="${tone}">${esc(f.f(cur[f.key]))}</td>
      <td class="is-prior">${esc(prior ? f.f(prior[f.key]) : "—")}</td>
      <td class="is-change ${delta.cls}">${delta.text}</td>
    </tr>${deriveRow(f.key, snapCtx, 4)}`;
  }).join("");

  snapMount.innerHTML = `
    <thead><tr>
      <th>Model entry</th>
      <th>${esc(cur.date)}</th>
      <th>${esc(prior?.date ?? "—")}</th>
      <th>Change</th>
    </tr></thead>
    <tbody>${body}</tbody>`;

  // the calibration table prints the build's own fit, so the substituted
  // numbers keep the row's values rather than the slider day's
  const calibCtx = { ...cur, ...row, date: row.asof ?? cur.date };

  const calib = CALIB_FIELDS.map((f) => `<tr class="is-key">
      <th scope="row">${f.label}${howBtn(f.key)}<span class="entries__gloss">${f.gloss}</span></th>
      <td>${esc(f.f(row[f.key]))}</td>
    </tr>${deriveRow(f.key, calibCtx, 2)}`).join("");

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

/** the verdict's "full calculation" button: every derivation at once */
export function openAllDerivations() {
  for (const f of [...SNAP_FIELDS, ...CALIB_FIELDS]) if (DERIVATIONS[f.key]) open.add(f.key);
  if (last) renderEntries(last.snapMount, last.calibMount, last.row, last.cur, last.prior);
}

/** one delegated listener per mount; innerHTML rewrites never drop it */
function wireToggles(mount) {
  if (mount.dataset.howWired) return;
  mount.dataset.howWired = "1";
  mount.addEventListener("click", (e) => {
    const btn = e.target.closest("button.how");
    if (!btn) return;
    const key = btn.dataset.how;
    if (open.has(key)) open.delete(key);
    else open.add(key);
    if (last) renderEntries(last.snapMount, last.calibMount, last.row, last.cur, last.prior);
  });
}
