#!/usr/bin/env python3
"""PIT (first-passage / KMV) -> S&P TTC rating conversion (PFPA Course #2).

Implements the "No-Regulatory-Arbitrage" conversion from the source paper
"Universal Time-Consistent (TiC) Credit Rating" (Yimin Yang), Section 5.3 and
Propositions 5.2.1 / 5.2.2, reproducing Tables 13-14.

The idea: a first-passage (FH) rating and an S&P through-the-cycle (TTC) rating
each carry an implied *confidence level* CL(CCM) at their respective Credit
Corrosion Measures.  Requiring the two confidence levels to agree (so that no
regulatory arbitrage exists between the two rating scales) maps a first-passage
``CCM_FH`` onto an equivalent S&P ``CCM*``.  The S&P RiskScore is then evaluated
at ``CCM*`` using the first-passage PD, and finally mapped to an S&P letter and
a TTC PD via the paper's Table 8 anchors.

Pure stdlib (math / statistics.NormalDist) to match the dependency-free style of
``kmv_engine.py``.  All conversion functions take plain ``float`` inputs (ccm,
mu, pd_fh); this module deliberately does *not* import ``kmv_engine``.
"""

from __future__ import annotations

import math
from statistics import NormalDist
from typing import Dict, List, Tuple

_NORM = NormalDist()
Phi = _NORM.cdf          # standard normal CDF, Phi
Phi_inv = _NORM.inv_cdf  # standard normal quantile, Phi^{-1}

# --------------------------------------------------------------------------- #
# Constants (paper Section 5.3)
# --------------------------------------------------------------------------- #
# Credit Migration Limit CML = e^1.35, with maturity parameter theta = 1.
CML: float = math.exp(1.35)         # ~= 3.857425530696
THETA: float = 1.0
# System constants calibrated to each agency's historical default study.
Q_SP: float = 0.625913              # Standard & Poor's
Q_MD: float = 0.746                 # Moody's (kept for reference / future use)

# S&P Table 8 anchors: (letter, RiskScore, one-year PD as decimal).
# Ordered from best (AAA) to worst (CCC/C).
_SP_TABLE8: List[Tuple[str, float, float]] = [
    ("AAA", 2.7, 0.0001),
    ("AA", 3.5, 0.0003),
    ("A", 5.2, 0.0007),
    ("BBB", 9.9, 0.0023),
    ("BB", 22.2, 0.0088),
    ("B", 50.7, 0.0441),
    ("CCC/C", 154.8, 0.3359),
]


# --------------------------------------------------------------------------- #
# Confidence-level functions
# --------------------------------------------------------------------------- #
def cl_fh(ccm: float) -> float:
    """First-passage confidence level CL_FH(CCM) (paper Section 5.3).

    Inverse-Gaussian survival form evaluated with the Credit Migration Limit::

        CL_FH(CCM) = Phi( sqrt(CML)/CCM - 1/sqrt(CML) )
                   + e^{2/CCM} * Phi( -sqrt(CML)/CCM - 1/sqrt(CML) )

    The ``e^{2/CCM}`` factor overflows for very small ``CCM`` (extremely safe
    credits), but it multiplies ``Phi(<< 0)`` which decays far faster, so the
    product is ~0.  The overflow is caught and that term set to 0.
    """
    root = math.sqrt(CML)
    term1 = Phi(root / ccm - 1.0 / root)
    try:
        term2 = math.exp(2.0 / ccm) * Phi(-root / ccm - 1.0 / root)
    except OverflowError:
        term2 = 0.0
    return term1 + term2


def cl_sp(ccm: float) -> float:
    """S&P confidence level CL_SP(CCM) (paper Section 5.3).

    Log-normal form with the S&P system constant ``Q_SP``::

        CL_SP(CCM) = Phi( (1.35 - (1/Q_SP)*ln(CCM) + ln(CCM+1)/2)
                          / sqrt(ln(CCM+1)) )

    Strictly *decreasing* in ``CCM`` (a larger corrosion measure means a worse
    credit, hence a lower confidence level), which makes it invertible by
    bisection in :func:`solve_ccm_star`.
    """
    ln_ccm = math.log(ccm)
    ln_ccm1 = math.log(ccm + 1.0)
    numerator = 1.35 - (1.0 / Q_SP) * ln_ccm + ln_ccm1 / 2.0
    return Phi(numerator / math.sqrt(ln_ccm1))


# --------------------------------------------------------------------------- #
# CCM* solver (No-Regulatory-Arbitrage matching, Prop 5.2.1 / 5.2.2)
# --------------------------------------------------------------------------- #
def solve_ccm_star(
    ccm_fh: float,
    *,
    lo: float = 1e-9,
    hi: float = 1.0e6,
    tol: float = 1e-12,
    max_iter: int = 300,
) -> float:
    """Solve CL_SP(CCM*) = CL_FH(CCM_FH) for the equivalent S&P ``CCM*``.

    First evaluates the target confidence ``alpha = CL_FH(CCM_FH)`` and then
    inverts the (monotonically decreasing) ``CL_SP`` by bisection.  This is the
    No-Regulatory-Arbitrage map of Prop 5.2.1 / 5.2.2: the S&P scale must report
    the same confidence at ``CCM*`` as the first-passage scale reports at
    ``CCM_FH``.
    """
    alpha = cl_fh(ccm_fh)
    left, right = lo, hi
    # cl_sp is decreasing: cl_sp(left) high, cl_sp(right) low.  Find CCM* where
    # cl_sp(CCM*) == alpha.
    for _ in range(max_iter):
        mid = 0.5 * (left + right)
        val = cl_sp(mid)
        if abs(val - alpha) < tol or (right - left) < tol:
            return mid
        if val < alpha:
            # confidence too low -> CCM too large -> move right bound down
            right = mid
        else:
            left = mid
    return 0.5 * (left + right)


# --------------------------------------------------------------------------- #
# S&P RiskScore at CCM* (paper Section 5.3)
# --------------------------------------------------------------------------- #
def sp_riskscore(pd_fh: float, ccm_star: float) -> float:
    """S&P RiskScore evaluated at ``CCM*`` using the first-passage PD.

    Paper Section 5.3::

        ln(TiC_SP) = Q_SP * Phi^{-1}(PD) * sqrt(ln(CCM*+1))
                     - (Q_SP/2) * ln(CCM*+1)
                     + ln(CCM*)
        RS_SP      = 100 * exp( ln(TiC_SP) )

    ``PD`` here is the first-passage default probability ``pd_fh`` (paper eq 13).
    """
    ln_ccm1 = math.log(ccm_star + 1.0)
    ln_tic = (
        Q_SP * Phi_inv(pd_fh) * math.sqrt(ln_ccm1)
        - (Q_SP / 2.0) * ln_ccm1
        + math.log(ccm_star)
    )
    return 100.0 * math.exp(ln_tic)


# --------------------------------------------------------------------------- #
# RiskScore -> S&P letter / TTC PD (paper Table 8)
# --------------------------------------------------------------------------- #
def sp_letter(rs_sp: float) -> str:
    """Map an S&P RiskScore to a letter grade via the Table 8 breakpoints.

    Each row of Table 8 anchors a letter to a RiskScore; a score falling
    between two anchors is assigned to the *nearer* anchor's letter.  Scores at
    or beyond the extremes clamp to ``AAA`` / ``CCC/C``.

    Note: Table 8 provides only the 7 coarse grades (no +/- notches), so this
    function returns coarse letters.  A RiskScore that the paper labels e.g.
    ``BB-`` resolves here to ``BB`` (the same coarse bucket).
    """
    letters = [row[0] for row in _SP_TABLE8]
    scores = [row[1] for row in _SP_TABLE8]
    if rs_sp <= scores[0]:
        return letters[0]
    if rs_sp >= scores[-1]:
        return letters[-1]
    for i in range(len(scores) - 1):
        if scores[i] <= rs_sp < scores[i + 1]:
            # nearer anchor wins
            if (rs_sp - scores[i]) <= (scores[i + 1] - rs_sp):
                return letters[i]
            return letters[i + 1]
    return letters[-1]


def sp_ttc_pd(rs_sp: float) -> float:
    """Map an S&P RiskScore to a through-the-cycle PD via Table 8.

    Uses log-linear interpolation in *both* RiskScore and PD between adjacent
    Table 8 anchors (PD spans several orders of magnitude, so interpolating
    ln(PD) against ln(RS) is the natural monotone choice).  Scores outside the
    anchor range clamp to the endpoint PDs.
    """
    scores = [row[1] for row in _SP_TABLE8]
    pds = [row[2] for row in _SP_TABLE8]
    if rs_sp <= scores[0]:
        return pds[0]
    if rs_sp >= scores[-1]:
        return pds[-1]
    for i in range(len(scores) - 1):
        if scores[i] <= rs_sp <= scores[i + 1]:
            frac = (math.log(rs_sp) - math.log(scores[i])) / (
                math.log(scores[i + 1]) - math.log(scores[i])
            )
            ln_pd = math.log(pds[i]) + frac * (math.log(pds[i + 1]) - math.log(pds[i]))
            return math.exp(ln_pd)
    return pds[-1]


# --------------------------------------------------------------------------- #
# Top-level entry point
# --------------------------------------------------------------------------- #
def convert_fh_to_sp(ccm_fh: float, mu: float, pd_fh: float) -> Dict[str, float]:
    """Convert a first-passage rating to its S&P TTC equivalent.

    Parameters
    ----------
    ccm_fh:
        First-passage Credit Corrosion Measure (paper eq 11).
    mu:
        Life Expectancy E[tau] in years (paper eq 11).  Retained for the
        Credit Outlook / self-check; the S&P mapping itself uses ``ccm_star``.
    pd_fh:
        First-passage default probability (paper eq 13), a decimal in (0, 1).

    Returns
    -------
    dict with keys:
        ``ccm_star``      -- equivalent S&P CCM (Prop 5.2.1/5.2.2)
        ``alpha``         -- common confidence level CL_FH(CCM_FH) = CL_SP(CCM*)
        ``rs_sp``         -- S&P RiskScore at CCM*
        ``sp_letter``     -- S&P letter grade (Table 8)
        ``sp_ttc_pd``     -- S&P through-the-cycle PD (Table 8 interpolation)
        ``credit_outlook``-- pd_fh - S&P_TTC_PD (paper eq 28): > 0 positive
                             trend, < 0 negative trend
    """
    alpha = cl_fh(ccm_fh)
    ccm_star = solve_ccm_star(ccm_fh)
    rs = sp_riskscore(pd_fh, ccm_star)
    letter = sp_letter(rs)
    ttc_pd = sp_ttc_pd(rs)
    return {
        "ccm_star": ccm_star,
        "alpha": alpha,
        "rs_sp": rs,
        "sp_letter": letter,
        "sp_ttc_pd": ttc_pd,
        "credit_outlook": pd_fh - ttc_pd,  # paper eq 28
    }


# --------------------------------------------------------------------------- #
# Self-check helpers (paper eq 13 first-passage PD; eq 5 first-passage RiskScore)
# --------------------------------------------------------------------------- #
def pd_first_passage(ccm: float, mu: float, T: float = 1.0) -> float:
    """First-passage default probability (paper eq 13), T-horizon (default 1y).

        PD_FH = Phi( sqrt(1/CCM) * (sqrt(T/mu) - sqrt(mu/T)) )
              + e^{2/CCM} * Phi( -sqrt(1/CCM) * (sqrt(T/mu) + sqrt(mu/T)) )

    The ``e^{2/CCM}`` overflow guard mirrors :func:`cl_fh`.
    """
    c = math.sqrt(1.0 / ccm)
    s_tm = math.sqrt(T / mu)
    s_mt = math.sqrt(mu / T)
    term1 = Phi(c * (s_tm - s_mt))
    try:
        term2 = math.exp(2.0 / ccm) * Phi(-c * (s_tm + s_mt))
    except OverflowError:
        term2 = 0.0
    return term1 + term2


def rs_first_passage(ccm: float, mu: float) -> float:
    """First-passage RiskScore self-check: RS_FH = 100 * CCM / mu (paper eq 5)."""
    return 100.0 * ccm / mu
