/* ═══════════════════════════════════════════════════════════════════════
   views/compare.js — two dates, side by side.

   The letter alone hides the interesting part: what moved between two days,
   and whether the move came from the barrier or from the asset value. Both
   dates are picked by the reader; the calibration is shared, so a change here
   is a change in A, D and E, never in the volatility assumption.
   ═══════════════════════════════════════════════════════════════════════ */

import { change, esc, num } from "../format.js";
import { SNAP_FIELDS, deltaInfo, isIG, notches } from "../fields.js";

/** the fields worth showing side by side; the rest live in section 05 */
const ROWS = ["dd", "spPd", "fpPd", "rs", "ccm", "mu", "asset", "marketCap", "price"];
const field = (key) => SNAP_FIELDS.find((f) => f.key === key);

export function renderCompare(mount, row, a, b) {
  if (!row?.snaps || !a || !b) {
    mount.innerHTML = `<p class="note">Pick a rating date and a comparison date to see what moved.</p>`;
    return;
  }

  const move = notches(a.spRating, b.spRating);
  const dir = move > 0 ? "up" : move < 0 ? "down" : "flat";
  const span = spanLabel(a, b);

  const wedgeA = a.asset - a.marketCap;
  const wedgeB = b.asset - b.marketCap;
  const coverA = wedgeA ? a.asset / wedgeA : NaN;
  const coverB = wedgeB ? b.asset / wedgeB : NaN;

  const rows = ROWS.map((key) => {
    const f = field(key);
    const delta = deltaInfo(f, a[key], b[key]);
    return `<tr>
      <th scope="row">${f.label}<span class="entries__gloss">${f.gloss}</span></th>
      <td>${esc(f.f(b[key]))}</td>
      <td>${esc(f.f(a[key]))}</td>
      <td class="is-change ${delta.cls}">${delta.text}</td>
    </tr>`;
  }).join("");

  mount.innerHTML = `
    <div class="cmp">
      <div class="cmp__side">
        <span class="label">${esc(b.date)}</span>
        <span class="cmp__letter ${isIG(b.spRating) ? "" : "spec"}">${esc(b.spRating)}</span>
      </div>
      <div class="cmp__arrow ${dir}">
        <span class="cmp__move">${moveLabel(move)}</span>
        <span class="cmp__span">${esc(span)}</span>
      </div>
      <div class="cmp__side">
        <span class="label">${esc(a.date)}</span>
        <span class="cmp__letter ${isIG(a.spRating) ? "" : "spec"}">${esc(a.spRating)}</span>
      </div>
      <p class="cmp__lede">
        Distance to default went from <b>${num(b.dd, 3)}</b> to <b>${num(a.dd, 3)}</b> as asset value moved
        <b class="${change(b.asset, a.asset).cls}">${change(b.asset, a.asset).text}</b> against a default point that moved
        <b class="${change(wedgeB, wedgeA).cls}">${change(wedgeB, wedgeA).text}</b> — coverage
        <b>${num(coverB, 2)}×</b> → <b>${num(coverA, 2)}×</b>. Volatility is held at the single
        <b>${esc(row.window)}</b>-day calibration, so nothing here is a change of assumption.
      </p>
    </div>
    <div class="tscroll">
      <table class="entries cmp__table">
        <thead><tr>
          <th>Entry</th><th>${esc(b.date)}</th><th>${esc(a.date)}</th><th>Change</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function moveLabel(move) {
  if (!move) return "no notch change";
  const n = Math.abs(move);
  return `${move > 0 ? "▲" : "▼"} ${n} notch${n === 1 ? "" : "es"}`;
}

function spanLabel(a, b) {
  const days = (a.index ?? 0) - (b.index ?? 0);
  if (!Number.isFinite(days) || days <= 0) return "";
  const months = Math.round((days / 21) * 10) / 10;
  return days < 21 ? `${days} trading days` : `${months} months · ${days} bars`;
}
