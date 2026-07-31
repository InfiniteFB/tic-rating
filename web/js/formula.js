/* ═══════════════════════════════════════════════════════════════════════
   formula.js — HTML formula primitives, no dependencies.

   Formulas render in a serif face against the site's grotesque so they read
   as mathematics, not prose. Two inks: <i> variables carry the general form,
   .fx-n carries a number substituted from the model output — the substituted
   view never recomputes anything, it only places engine values into the
   slots of the same expression.
   ═══════════════════════════════════════════════════════════════════════ */

/** a variable or symbol, italic */
export const vr = (s) => `<i>${s}</i>`;

/** a number substituted from the model output */
export const nm = (s) => `<b class="fx-n">${s}</b>`;

/** the value the formula produces — the row's own number */
export const rs = (s) => `<b class="fx-r">${s}</b>`;

export const sb = (b, s) => `${b}<sub>${s}</sub>`;
export const sup = (b, s) => `${b}<sup>${s}</sup>`;

/** stacked fraction */
export const fr = (n, d) =>
  `<span class="fx-fr"><span>${n}</span><span>${d}</span></span>`;

/** square root with a vinculum */
export const sq = (x) =>
  `<span class="fx-sqrt"><span class="fx-rad">√</span><span class="fx-sq">${x}</span></span>`;

/** one displayed formula line */
export const block = (inner) => `<span class="fx">${inner}</span>`;

/* shorthands the derivations use constantly */
export const A = vr("A");
export const D = vr("D");
export const E = vr("E");
export const TAU = vr("τ");
export const SIGA = sb(vr("σ"), vr("A"));
export const SIGE = sb(vr("σ"), vr("E"));
export const RA = sb(vr("R"), vr("A"));
export const MU = vr("μ");
export const CCM = vr("CCM");
export const CCMS = `${vr("CCM")}<sup>*</sup>`;
export const LNAD = `ln(${A}/${D})`;
