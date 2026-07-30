/* ═══════════════════════════════════════════════════════════════════════
   fields.js — the canonical inventory of every entry the model emits, and
   the S&P scale it maps onto.

   This file is the contract. Views iterate these lists instead of naming
   fields inline, so a field can never be silently dropped from the UI, and
   adding one to the pipeline surfaces it everywhere at once.
   ═══════════════════════════════════════════════════════════════════════ */

import { moneyK, num, pct, usd, DASH, isNum } from "./format.js";

/* ── company-level: one value per ticker ──────────────────────────────── */
export const HEADER_FIELDS = [
  { key: "ticker", label: "Ticker", gloss: "symbol as filed", f: (v) => v },
  { key: "sector", label: "Sector", gloss: "GICS sector", f: (v) => v ?? DASH },
  { key: "asof", label: "As of", gloss: "cutoff of the current snapshot", f: (v) => v },
  { key: "window", label: "Window", gloss: "trading days in the calibration", f: (v) => `${v} d` },
];

/* ── calibration: fitted once per ticker, shared by both snapshots ────── */
export const CALIB_FIELDS = [
  { key: "assetVol", label: "AssetVol", gloss: "σ_A — calibrated asset volatility", f: pct },
  { key: "assetRet", label: "AssetRet", gloss: "R_A — annualised asset drift", f: (v) => num(v, 4) },
  { key: "stockVol", label: "StockVol", gloss: "σ_E — observed equity volatility", f: pct },
];

/* ── snapshot: repeated at the current and the prior cutoff ───────────── */
export const SNAP_FIELDS = [
  { key: "asset", label: "Asset", gloss: "market value of assets V_A", f: moneyK, better: "up" },
  { key: "marketCap", label: "MarketCap", gloss: "market value of equity E", f: moneyK, better: "up" },
  { key: "price", label: "Price", gloss: "dividend-adjusted close on the cutoff", f: usd, better: "up" },
  { key: "mu", label: "Mu", gloss: "μ — implied life expectancy, years", f: (v) => num(v, 4), better: "up" },
  { key: "ccm", label: "CCM", gloss: "credit corrosion measure, point-in-time", f: (v) => num(v, 6), better: "down" },
  { key: "rs", label: "RS", gloss: "RiskScore = 100 · TiC", f: (v) => num(v, 4), better: "down" },
  { key: "fpPd", label: "FP_PD", gloss: "first-passage probability of default", f: pct, better: "down" },
  { key: "alpha", label: "Alpha", gloss: "α — common confidence level, PIT ↔ TTC", f: (v) => num(v, 6) },
  { key: "spCcm", label: "SP_CCM", gloss: "CCM* rebased to the S&P through-the-cycle scale", f: (v) => num(v, 6) },
  { key: "spPd", label: "SP_PD", gloss: "through-the-cycle PD on the S&P scale", f: pct, better: "down" },
  { key: "spRating", label: "SP_Rating", gloss: "letter grade, fine notch", f: (v) => v ?? DASH, rating: true },
  { key: "dd", label: "DD", gloss: "distance to default, σ units", f: (v) => num(v, 4), better: "up" },
  { key: "edf", label: "EDF", gloss: "expected default frequency, Merton closed form", f: pct, better: "down" },
  { key: "outlook", label: "Outlook", gloss: "sign of the credit-outlook derivative", f: (v) => v ?? DASH, flag: true },
];

/* ── the conversion chain the verdict draws, in order ─────────────────── */
export const CHAIN = [
  { key: "ccm", label: "CCM", f: (v) => num(v, 6) },
  { key: "rs", label: "RS", f: (v) => num(v, 4) },
  { key: "fpPd", label: "FP_PD", f: pct },
  { key: "alpha", label: "Alpha", f: (v) => num(v, 6) },
  { key: "spCcm", label: "SP_CCM", f: (v) => num(v, 6) },
  { key: "spPd", label: "SP_PD", f: pct },
  { key: "spRating", label: "SP_Rating", f: (v) => v ?? DASH },
];

/* ── S&P scale ────────────────────────────────────────────────────────── */
// "AAA-" is not a real S&P notch; it is what the course's fine scale emits and
// is kept verbatim so the UI never disagrees with the model output.
export const SCALE = [
  "AAA", "AAA-", "AA+", "AA", "AA-", "A+", "A", "A-",
  "BBB+", "BBB", "BBB-", "BB+", "BB", "BB-", "B+", "B", "B-",
  "CCC+", "CCC", "CCC-", "CC+", "CC", "CC-", "C+", "C", "C-", "D",
];

const IG_EDGE = SCALE.indexOf("BBB-");

export function ratingIdx(letter) {
  const i = SCALE.indexOf(String(letter ?? "").trim());
  return i < 0 ? SCALE.length - 1 : i;
}

export const isIG = (letter) => ratingIdx(letter) <= IG_EDGE;

/** notch move between the two snapshots; positive = upgrade */
export function migration(row) {
  const [cur, prior] = row.snaps ?? [];
  if (!cur?.spRating || !prior?.spRating) return { notches: 0, dir: "flat", known: false };
  const notches = ratingIdx(prior.spRating) - ratingIdx(cur.spRating);
  return { notches, dir: notches > 0 ? "up" : notches < 0 ? "down" : "flat", known: true };
}

export function outlook(sign) {
  const s = String(sign ?? "").trim();
  if (s === "+") return { sym: "▲", label: "positive", cls: "up", raw: "+" };
  if (s === "-") return { sym: "▼", label: "negative", cls: "down", raw: "−" };
  return { sym: "■", label: "stable", cls: "flat", raw: s || DASH };
}

/**
 * Change in one field between snapshots, with a direction class that already
 * knows which way is good news — a higher DD is reassuring, a higher SP_PD is not.
 */
export function deltaInfo(field, cur, prior) {
  if (field.rating) {
    if (!cur || !prior) return { text: DASH, cls: "flat" };
    const n = ratingIdx(prior) - ratingIdx(cur);
    if (!n) return { text: "unchanged", cls: "flat" };
    const word = Math.abs(n) === 1 ? "notch" : "notches";
    return { text: `${n > 0 ? "+" : "−"}${Math.abs(n)} ${word}`, cls: n > 0 ? "up" : "down" };
  }
  if (field.flag) {
    const a = outlook(cur);
    const b = outlook(prior);
    return { text: a.raw === b.raw ? "unchanged" : `${b.raw} → ${a.raw}`, cls: a.cls };
  }
  if (!isNum(cur) || !isNum(prior)) return { text: DASH, cls: "flat" };
  const d = cur - prior;
  if (d === 0) return { text: "±0", cls: "flat" };
  let cls = "flat";
  if (field.better === "up") cls = d > 0 ? "up" : "down";
  else if (field.better === "down") cls = d < 0 ? "up" : "down";
  const magnitude = String(field.f(Math.abs(d))).replace(/^[−+]/, "");
  return { text: `${d > 0 ? "+" : "−"}${magnitude}`, cls };
}
