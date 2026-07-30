/* ═══════════════════════════════════════════════════════════════════════
   views/reading.js — plain-language reading of the numbers already on the
   page. Assembled in the browser from the model output; nothing here is a
   language-model call, and nothing here introduces a figure the tables above
   do not already show.
   ═══════════════════════════════════════════════════════════════════════ */

import { esc, moneyK, num, pct } from "../format.js";
import { migration, outlook } from "../fields.js";

export function renderReading(headMount, bodyMount, row) {
  if (!row?.snaps) {
    headMount.textContent = "";
    bodyMount.innerHTML = "";
    return;
  }
  const [cur, prior] = row.snaps;
  const move = migration(row);
  const look = outlook(cur.outlook);
  const wedge = cur.asset - cur.marketCap;
  const coverage = wedge ? cur.asset / wedge : NaN;

  headMount.innerHTML = `${esc(row.ticker)}<br>prints<br>${esc(cur.spRating)}`;

  const lead = !move.known
    ? "Only one snapshot resolves for this name, so there is no migration to read."
    : move.dir === "flat"
      ? "Six months of market noise, and the letter held."
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
    Calibration over ${row.window} trading days puts AssetVol at <b>${pct(row.assetVol)}</b> against StockVol of
    <b>${pct(row.stockVol)}</b>, with drift <b>${num(row.assetRet, 4)}</b> and implied life expectancy
    <b>${num(cur.mu, 3)}</b> years.</p>
    <p>${prior
      ? `Between snapshots the cycle multiplier went ${cur.ccm > prior.ccm ? "up" : "down"} from
         <b>${num(prior.ccm, 6)}</b> to <b>${num(cur.ccm, 6)}</b>, carrying RS to <b>${num(cur.rs, 4)}</b>.`
      : `The cycle multiplier stands at <b>${num(cur.ccm, 6)}</b>, with RS at <b>${num(cur.rs, 4)}</b>.`}
    With α at <b>${num(cur.alpha, 6)}</b> the through-the-cycle figure is ${alphaClause}, and SP_CCM of
    <b>${num(cur.spCcm, 6)}</b> resolves SP_PD to <b>${pct(cur.spPd)}</b> — that is the
    <b>${esc(cur.spRating)}</b>.</p>
    <p>The recorded outlook is <b>${look.raw} (${look.label})</b>, which is the sign of the credit-outlook
    derivative at this snapshot. It can disagree with the realised notch move over the same six months, and
    across the index it frequently does — the two are different statements, one about level and one about slope.</p>`;
}
