/* ═══════════════════════════════════════════════════════════════════════
   views/reading.js — plain-language reading of the numbers already on the
   page. Assembled in the browser from the model output; nothing here is a
   language-model call, and nothing here introduces a figure the tables above
   do not already show.
   ═══════════════════════════════════════════════════════════════════════ */

import { esc, moneyK, num, pct } from "../format.js";
import { notches, outlook } from "../fields.js";

export function renderReading(headMount, bodyMount, row, cur, prior) {
  if (!row?.snaps || !cur) {
    headMount.textContent = "";
    bodyMount.innerHTML = "";
    return;
  }
  const n = prior ? notches(cur.spRating, prior.spRating) : 0;
  const move = { known: Boolean(prior), dir: n > 0 ? "up" : n < 0 ? "down" : "flat" };
  const look = outlook(cur.outlook);
  const wedge = cur.asset - cur.marketCap;
  const coverage = wedge ? cur.asset / wedge : NaN;

  headMount.innerHTML = `${esc(row.ticker)}<br>prints<br>${esc(cur.spRating)}`;

  const lead = !move.known
    ? "No comparison date is selected, so there is no migration to read."
    : move.dir === "flat"
      ? "Across the selected span the letter held."
      : move.dir === "up"
        ? "The upgrade is a clearance story, not an earnings story."
        : "The downgrade is priced in volatility, not in leverage.";

  const alphaClause = cur.alpha >= 0.999
    ? "effectively unsmoothed — the point-in-time signal passes straight through"
    : "blended back toward the S&amp;P central tendency";

  bodyMount.innerHTML = `
    <p class="reading__lead">${lead}</p>
    <p>Assets of <b>${moneyK(cur.asset)}</b> stand against a default point of <b>${moneyK(wedge)}</b> —
    <b>${num(coverage, 2)}×</b> coverage, and <b>${num(cur.dd, 4)}</b> asset-volatility units of clearance.
    The rating date's own ${row.window}-day calibration puts AssetVol at <b>${pct(cur.assetVol ?? row.assetVol)}</b> against StockVol of
    <b>${pct(cur.stockVol ?? row.stockVol)}</b>, with drift <b>${num(cur.assetRet ?? row.assetRet, 4)}</b> and implied life expectancy
    <b>${num(cur.mu, 3)}</b> years.</p>
    <p>${prior
      ? `Between the two dates the cycle multiplier went ${cur.ccm > prior.ccm ? "up" : "down"} from
         <b>${num(prior.ccm, 6)}</b> to <b>${num(cur.ccm, 6)}</b>, carrying RS to <b>${num(cur.rs, 4)}</b>.`
      : `The cycle multiplier stands at <b>${num(cur.ccm, 6)}</b>, with RS at <b>${num(cur.rs, 4)}</b>.`}
    With α at <b>${num(cur.alpha, 6)}</b> the through-the-cycle figure is ${alphaClause}, and SP_CCM of
    <b>${num(cur.spCcm, 6)}</b> resolves SP_PD to <b>${pct(cur.spPd)}</b> — that is the
    <b>${esc(cur.spRating)}</b>.</p>
    <p>The recorded outlook is <b>${look.raw} (${look.label})</b>, which is the sign of the credit-outlook
    derivative on the rating date itself, not a comparison with any earlier day. It can disagree with the notch
    move over the selected span, and across the index it frequently does — one is a statement about level, the
    other about slope.</p>`;
}
