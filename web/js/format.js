/* ═══════════════════════════════════════════════════════════════════════
   format.js — every value that reaches the screen passes through here.
   Two things the model demands and a naive formatter gets wrong:
     · money arrives in THOUSANDS of USD (the workbook's unit)
     · probabilities span 1e-27 … 0.97, so rounding to 4 dp would print
       "0.0000%" for most of the investment-grade universe
   ═══════════════════════════════════════════════════════════════════════ */

export const DASH = "—";

export const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/** thousands of USD → $1.23T / $45.6B / $789M */
export function moneyK(v) {
  if (!isNum(v)) return DASH;
  const a = Math.abs(v) * 1e3;
  const sign = v < 0 ? "−" : "";
  for (const [div, suffix] of [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]]) {
    if (a >= div) return `${sign}$${(a / div).toFixed(2)}${suffix}`;
  }
  return `${sign}$${a.toFixed(0)}`;
}

export const usd = (v) => (isNum(v) ? `$${v.toFixed(2)}` : DASH);

/** shares in thousands → 21.7M */
export function shares(v) {
  if (!isNum(v)) return DASH;
  const a = v * 1e3;
  for (const [div, suffix] of [[1e9, "B"], [1e6, "M"], [1e3, "K"]]) {
    if (a >= div) return `${(a / div).toFixed(a / div < 10 ? 2 : 1)}${suffix}`;
  }
  return String(Math.round(a));
}

export function pct(v) {
  if (!isNum(v)) return DASH;
  if (v === 0) return "0";
  const p = v * 100;
  const abs = Math.abs(p);
  if (abs < 1e-3) return `${p.toExponential(2)}%`;
  if (abs < 1) return `${p.toFixed(4)}%`;
  if (abs < 10) return `${p.toFixed(3)}%`;
  return `${p.toFixed(2)}%`;
}

export function num(v, digits = 2) {
  if (!isNum(v)) return DASH;
  return v.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** signed percentage change between two prices */
export function change(from, to) {
  if (!isNum(from) || !isNum(to) || from === 0) return { text: DASH, cls: "flat" };
  const d = (to - from) / from;
  return {
    text: `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d * 100).toFixed(2)}%`,
    cls: d > 0 ? "up" : d < 0 ? "down" : "flat",
  };
}

export const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** 2026-07-29 → 29 Jul 26 */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortDate(iso) {
  if (!iso || iso.length < 10) return String(iso ?? DASH);
  const [y, m, d] = iso.split("-");
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
}
