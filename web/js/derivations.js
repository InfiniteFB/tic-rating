/* ═══════════════════════════════════════════════════════════════════════
   derivations.js — how every number on the page is arrived at.

   One entry per model field: the general formula, the same formula with the
   selected day's numbers substituted, a one-line reading, and the anchor of
   the method-page section that teaches it. The workings table and the
   conversion chain open these; method.html prints the general forms. One
   source, two consumers — the general form and the worked instance can
   never drift apart.

   Nothing here recomputes the model. Substituted values come straight off
   the snapshot the engine produced; the only arithmetic is displaying
   identities like ln(A/D) that connect one engine value to the next.
   Formulas mirror kmv_engine.py / ttc_conversion.py (the paper's forms);
   where the course deck disagrees with itself the engine's corrected form
   is shown and the note says so.
   ═══════════════════════════════════════════════════════════════════════ */

import { A, CCM, CCMS, D, E, LNAD, MU, RA, SIGA, SIGE, TAU, block, fr, nm, rs, sb, sq, sup, vr } from "./formula.js";
import { moneyK, num, pct, shares as fmtShares, usd } from "./format.js";
import { FINE_SCALE } from "./fields.js";

const PHI = (x) => `Φ(${x})`;
const PHIINV = (x) => `Φ<sup>−1</sup>(${x})`;
const EXP = (x) => `${vr("e")}<sup>${x}</sup>`;
const lnAD = (s) => (s?.asset > 0 && s?.debt > 0 ? Math.log(s.asset / s.debt) : null);
const ok = (...vals) => vals.every((v) => typeof v === "number" && Number.isFinite(v));

/* the fine-scale bucket a TTC PD falls in — closed-left / open-right,
   mirroring ttc_conversion.sp_letter_fine via the same anchors */
function fineBucket(pd) {
  if (typeof pd !== "number" || !Number.isFinite(pd)) return null;
  let i = 0;
  for (let k = 0; k < FINE_SCALE.length; k++) if (pd >= FINE_SCALE[k][1]) i = k;
  return { letter: FINE_SCALE[i][0], lo: FINE_SCALE[i][1], hi: FINE_SCALE[i + 1]?.[1] ?? null };
}

export const DERIVATIONS = {
  /* ── inputs ─────────────────────────────────────────────────────────── */
  price: {
    anchor: "s-option",
    note: "Dividend-adjusted close — dividends paid are added back so the equity series measures what shareholders hold, not just the quote.",
    formula: () => block(`${sb(vr("P"), vr("t"))} = adjusted close`),
    plugged: (s) => (ok(s.price) ? block(`${sb(vr("P"), vr("t"))} = ${rs(usd(s.price))} on ${s.date}`) : null),
  },
  marketCap: {
    anchor: "s-option",
    note: "The observable side of the option: market equity is the day's adjusted close times that quarter's basic share count — a 2017 market cap uses 2017's float.",
    formula: () => block(`${E} = ${sb(vr("P"), vr("t"))} × shares${sb("", vr("t(Q)"))}`),
    plugged: (s) => {
      if (!ok(s.marketCap, s.price) || s.price <= 0) return null;
      return block(`${E} = ${nm(usd(s.price))} × ${nm(fmtShares(s.marketCap / s.price))} shares = ${rs(moneyK(s.marketCap))}`);
    },
  },
  asset: {
    anchor: "s-invert",
    note: "Assets are not observable. Each day the engine solves the normalised Merton equation for x by bisection — g is monotone, so the solution is unique.",
    formula: () =>
      block(`${vr("g")}(${vr("x")}, ${SIGA}, ${TAU}) = ${fr(E, `${D}·${EXP(`−${vr("r")}${TAU}`)}`)}${
        ""} , &nbsp; ${A} = ${vr("x")} · ${D} · ${EXP(`−${vr("r")}${TAU}`)}`),
    plugged: (s) => {
      if (!ok(s.asset, s.marketCap, s.debt)) return null;
      return block(`${E} = ${nm(moneyK(s.marketCap))}, ${D} = ${nm(moneyK(s.debt))} ⇒ ${A} = ${rs(moneyK(s.asset))}`);
    },
  },

  /* ── calibration ────────────────────────────────────────────────────── */
  assetVol: {
    anchor: "s-em",
    note: "The EM fixed point: asset volatility is the stdev of √250-scaled daily log asset returns, recomputed from the recovered asset path until it stops moving.",
    formula: () =>
      block(`${SIGA} = stdev{ ${sb(vr("R"), vr("i"))} }, &nbsp; ${sb(vr("R"), vr("i"))} = ${sq("250")} · ln ${fr(sb(A, `${vr("i")}+1`), sb(A, vr("i")))}`),
    plugged: (s) => (ok(s.assetVol) ? block(`${SIGA} = ${rs(pct(s.assetVol))} on this day's trailing window`) : null),
  },
  assetRet: {
    anchor: "s-dd",
    note: "Annualised asset drift: √250 × mean of the scaled returns (the deck's literal mean is off by √250 — the engine annualises, which is what reproduces the professor's workbook). Equals η_A − ½σ_A².",
    formula: () =>
      block(`${RA} = ${sq("250")} · mean{ ${sb(vr("R"), vr("i"))} } = ${sb(vr("η"), vr("A"))} − ${fr(`${SIGA}<sup>2</sup>`, "2")}`),
    plugged: (s) => (ok(s.assetRet) ? block(`${RA} = ${rs(num(s.assetRet, 4))}`) : null),
  },
  stockVol: {
    anchor: "s-em",
    note: "Equity volatility — the same estimator applied to the observed equity series; it is EM's starting point (iteration zero uses A = E).",
    formula: () =>
      block(`${SIGE} = stdev{ ${sq("250")} · ln ${fr(sb(E, `${vr("i")}+1`), sb(E, vr("i")))} }`),
    plugged: (s) => (ok(s.stockVol) ? block(`${SIGE} = ${rs(pct(s.stockVol))}`) : null),
  },

  /* ── the first-passage read ─────────────────────────────────────────── */
  mu: {
    anchor: "s-ttc",
    note: "Implied life expectancy E[τ]: the log cushion divided by the absolute drift — how many years the current corrosion rate takes to eat the distance.",
    formula: () => block(`${MU} = ${fr(LNAD, `|${RA}|`)}`),
    plugged: (s) => {
      const l = lnAD(s);
      if (!ok(l, s.assetRet, s.mu)) return null;
      return block(`${MU} = ${fr(nm(num(l, 4)), nm(num(Math.abs(s.assetRet), 4)))} = ${rs(num(s.mu, 4))} years`);
    },
  },
  ccm: {
    anchor: "s-ttc",
    note: "Credit Corrosion Measure, E[τ]·E[1/τ] − 1 — under first passage it collapses to this closed form (paper eq 11). Deterioration beyond what the expected level implies.",
    formula: () => block(`${CCM} = ${fr(`${SIGA}<sup>2</sup>`, `${LNAD} · |${RA}|`)}`),
    plugged: (s) => {
      const l = lnAD(s);
      if (!ok(l, s.assetVol, s.assetRet, s.ccm)) return null;
      return block(`${CCM} = ${fr(`${nm(num(s.assetVol, 4))}<sup>2</sup>`, `${nm(num(l, 4))} · ${nm(num(Math.abs(s.assetRet), 4))}`)} = ${rs(num(s.ccm, 6))}`);
    },
  },
  rs: {
    anchor: "s-ttc",
    note: "The Time-Consistent rating itself, ×100. At Q = 1 the drift cancels out of CCM/μ — which is why this number holds still while the stock price does not.",
    formula: () => block(`${vr("RS")} = 100 · ${fr(CCM, MU)} = 100 · ${fr(`${SIGA}<sup>2</sup>`, `ln<sup>2</sup>(${A}/${D})`)}`),
    plugged: (s) => {
      const l = lnAD(s);
      if (!ok(l, s.assetVol, s.rs)) return null;
      return block(`${vr("RS")} = 100 · ${fr(`${nm(num(s.assetVol, 4))}<sup>2</sup>`, `${nm(num(l, 4))}<sup>2</sup>`)} = ${rs(num(s.rs, 4))}`);
    },
  },
  fpPd: {
    anchor: "s-pd",
    note: "First-passage default probability over one year (paper eq 13, T = 1): the chance the asset path touches the default point at any moment, not only at maturity.",
    formula: () =>
      block(`${sb(vr("PD"), vr("FH"))} = ${PHI(`${sq(fr("1", CCM))}(${sq(fr("1", MU))} − ${sq(MU)})`)} + ${EXP(fr("2", CCM))} ${PHI(`−${sq(fr("1", CCM))}(${sq(fr("1", MU))} + ${sq(MU)})`)}`),
    plugged: (s) =>
      ok(s.ccm, s.mu, s.fpPd)
        ? block(`${CCM} = ${nm(num(s.ccm, 4))}, ${MU} = ${nm(num(s.mu, 2))} ⇒ ${sb(vr("PD"), vr("FH"))} = ${rs(pct(s.fpPd))}`)
        : null,
  },

  /* ── the conversion to the S&P scale ────────────────────────────────── */
  alpha: {
    anchor: "s-ttc",
    note: "The confidence level the first-passage CCM implies (inverse-Gaussian form, CML = e^1.35). Capital-side identity: α depends on CCM alone, never on μ.",
    formula: () =>
      block(`${vr("α")} = ${PHI(`${fr(sq(vr("CML")), CCM)} − ${fr("1", sq(vr("CML")))}`)} + ${EXP(fr("2", CCM))} ${PHI(`−${fr(sq(vr("CML")), CCM)} − ${fr("1", sq(vr("CML")))}`)} , &nbsp; ${vr("CML")} = ${EXP("1.35")}`),
    plugged: (s) =>
      ok(s.ccm, s.alpha)
        ? block(`${vr("α")} = ${vr("CL")}${sb("", vr("FH"))}(${nm(num(s.ccm, 4))}) = ${rs(num(s.alpha, 6))}`)
        : null,
  },
  spCcm: {
    anchor: "s-ttc",
    note: "No-regulatory-arbitrage step: find the S&P-system corrosion CCM* that carries the same confidence level. Solved numerically — CL_SP is strictly decreasing, so the root is unique.",
    formula: () =>
      block(`solve &nbsp; ${vr("CL")}${sb("", vr("SP"))}(${CCMS}) = ${vr("α")} , &nbsp; ${vr("CL")}${sb("", vr("SP"))}(${vr("c")}) = ${PHI(fr(`1.35 − ${fr(`ln ${vr("c")}`, sb(vr("Q"), vr("SP")))} + ${fr(`ln(${vr("c")}+1)`, "2")}`, sq(`ln(${vr("c")}+1)`)))}`),
    plugged: (s) =>
      ok(s.alpha, s.spCcm)
        ? block(`${vr("CL")}${sb("", vr("SP"))}(${CCMS}) = ${nm(num(s.alpha, 6))} ⇒ ${CCMS} = ${rs(num(s.spCcm, 6))}`)
        : null,
  },
  spPd: {
    anchor: "s-ttc",
    note: "The S&P RiskScore evaluated at CCM* with the first-passage PD (Q_SP = 0.625913), then read against the Table 8 anchors — log-linear in both RS and PD between anchors.",
    formula: () =>
      block(`ln ${vr("TiC")}${sb("", vr("SP"))} = ${sb(vr("Q"), vr("SP"))} ${PHIINV(sb(vr("PD"), vr("FH")))} ${sq(`ln(${CCMS}+1)`)} − ${fr(sb(vr("Q"), vr("SP")), "2")} ln(${CCMS}+1) + ln ${CCMS} → Table 8 → ${sb(vr("PD"), vr("TTC"))}`),
    plugged: (s) =>
      ok(s.rsSp, s.spPd)
        ? block(`${vr("RS")}${sb("", vr("SP"))} = ${nm(num(s.rsSp, 4))} → Table 8 → ${sb(vr("PD"), vr("TTC"))} = ${rs(pct(s.spPd))}`)
        : null,
  },
  spRating: {
    anchor: "s-ttc",
    note: "The letter is the finest grade whose anchor PD does not exceed the through-the-cycle PD (closed-left buckets). “AAA-” is the course scale's artifact, kept verbatim.",
    formula: () => block(`letter = finest grade with &nbsp; ${sb(vr("PD"), vr("grade"))} ≤ ${sb(vr("PD"), vr("TTC"))}`),
    plugged: (s) => {
      const b = fineBucket(s.spPd);
      if (!b || !s.spRating) return null;
      const hi = b.hi === null ? "" : ` &lt; ${nm(pct(b.hi))}`;
      return block(`${nm(pct(b.lo))} ≤ ${sb(vr("PD"), vr("TTC"))} ${nm(pct(s.spPd))}${hi} ⇒ ${rs(s.spRating)}`);
    },
  },

  /* ── the KMV pair, kept for reference ───────────────────────────────── */
  dd: {
    anchor: "s-dd",
    note: "Distance to default: how many σ_A the log cushion plus one year's drift covers. Carries η_A, so it moves with the market — the number TiC was built to stabilise.",
    formula: () => block(`${vr("DD")} = ${fr(`${LNAD} + ${RA}`, SIGA)}`),
    plugged: (s) => {
      const l = lnAD(s);
      if (!ok(l, s.assetRet, s.assetVol, s.dd)) return null;
      return block(`${vr("DD")} = ${fr(`${nm(num(l, 4))} + ${nm(num(s.assetRet, 4))}`, nm(num(s.assetVol, 4)))} = ${rs(num(s.dd, 4))}`);
    },
  },
  edf: {
    anchor: "s-pd",
    note: "Merton's closed form: default only at maturity, so the path is free to dip below the default point mid-year. First passage counts those paths; EDF does not.",
    formula: () => block(`${vr("EDF")} = ${PHI(`−${vr("DD")}`)}`),
    plugged: (s) =>
      ok(s.dd, s.edf) ? block(`${vr("EDF")} = ${PHI(nm(`−${num(s.dd, 4)}`))} = ${rs(pct(s.edf))}`) : null,
  },
  outlook: {
    anchor: "s-ttc",
    note: "Paper Prop 5.3: if risk reverts to the cycle, today's gap is tomorrow's trend. PIT above TTC reads as positive — the pressure is expected to decay toward the long-run level.",
    formula: () => block(`Outlook = sign( ${sb(vr("PD"), vr("FH"))} − ${sb(vr("PD"), vr("TTC"))} )`),
    plugged: (s) =>
      ok(s.fpPd, s.spPd)
        ? block(`sign( ${nm(pct(s.fpPd))} − ${nm(pct(s.spPd))} ) = ${rs(s.outlook === "+" ? "+ positive" : s.outlook === "-" ? "− negative" : "0 neutral")}`)
        : null,
  },
};

/* ── the assembled panel both pages mount ─────────────────────────────── */
export function renderDerivation(key, ctx) {
  const d = DERIVATIONS[key];
  if (!d) return "";
  const plugged = ctx ? d.plugged(ctx) : null;
  return `<div class="derive__panel">
    <div class="derive__general">${d.formula()}</div>
    ${plugged ? `<div class="derive__plug"><span class="label">with ${ctx.date ?? "this day"}'s numbers</span>${plugged}</div>` : ""}
    <p class="derive__note">${d.note}
      <a class="derive__link" href="./method.html#${d.anchor}">Read the method →</a></p>
  </div>`;
}

/* ── teaching forms only method.html prints ───────────────────────────── */
export const TEACH = {
  bsm: () =>
    block(`${E} = ${A} ${PHI(sb(vr("d"), "1"))} − ${D} ${EXP(`−${vr("r")}${TAU}`)} ${PHI(sb(vr("d"), "2"))} , &nbsp; ${sb(vr("d"), "1,2")} = ${fr(`${LNAD} + (${vr("r")} ± ${fr(`${vr("σ")}<sup>2</sup>`, "2")})${TAU}`, `${vr("σ")}${sq(TAU)}`)}`),
  g: () =>
    block(`${vr("g")}(${vr("x")}, ${vr("σ")}, ${TAU}) = ${vr("x")} ${PHI(fr(`ln ${vr("x")} + ${fr(`${vr("σ")}<sup>2</sup>${TAU}`, "2")}`, `${vr("σ")}${sq(TAU)}`))} − ${PHI(fr(`ln ${vr("x")} − ${fr(`${vr("σ")}<sup>2</sup>${TAU}`, "2")}`, `${vr("σ")}${sq(TAU)}`))}`),
  z: () =>
    block(`${vr("z")}${sb("", vr("t"))} = ${fr(sb(E, vr("t")), `${sb(D, vr("t(Q)"))} · ${EXP(`−${vr("r")}${TAU}`)}`)} , &nbsp; ${TAU} ≈ 1 − ${fr(`${vr("t")} − ${vr("t(Q)")}`, "365")}`),
  em0: () => block(`${sup(A, "(0)")} = ${E} , &nbsp; ${sup(vr("σ"), "(0)")} = stdev{ ${sq("250")} · ln ${fr(sb(E, `${vr("i")}+1`), sb(E, vr("i")))} }`),
  emE: () => block(`E-step: &nbsp; solve &nbsp; ${vr("g")}(${sb(vr("x"), vr("i"))}, ${sup(vr("σ"), `(${vr("m")}−1)`)}, ${sb(TAU, vr("i"))}) = ${sb(vr("z"), vr("i"))} &nbsp; ⇒ &nbsp; ${sup(A, `(${vr("m")})`)}`),
  emM: () => block(`M-step: &nbsp; ${sup(vr("σ"), `(${vr("m")})`)} = stdev{ ${sq("250")} · ln ${fr(sb(sup(A, `(${vr("m")})`), `${vr("i")}+1`), sb(sup(A, `(${vr("m")})`), vr("i")))} }`),
  ticQ: () => block(`${vr("TiC")} = ${fr(CCM, `${MU}<sup>${vr("Q")}</sup>`)} , &nbsp; ${CCM} = E[${TAU}]·E[1/${TAU}] − 1 , &nbsp; ${MU} = E[${TAU}]`),
  ticFp: () => block(`${vr("Q")} = 1: &nbsp; ${vr("TiC")} = ${fr(CCM, MU)} = ${fr(`${SIGA}<sup>2</sup>`, `ln<sup>2</sup>(${A}/${D})`)} — ${sb(vr("η"), vr("A"))} cancels`),
  ccmMu: () =>
    block(`${CCM} = ${fr(`${SIGA}<sup>2</sup>`, `${LNAD} · |${sb(vr("η"), vr("A"))} − ${fr(`${SIGA}<sup>2</sup>`, "2")}|`)} , &nbsp; ${MU} = ${fr(LNAD, `|${sb(vr("η"), vr("A"))} − ${fr(`${SIGA}<sup>2</sup>`, "2")}|`)}`),
  ddEdf: () => block(`${vr("DD")} = ${fr(`${LNAD} + ${RA}`, SIGA)} , &nbsp; ${vr("EDF")} = ${PHI(`−${vr("DD")}`)}`),
};
