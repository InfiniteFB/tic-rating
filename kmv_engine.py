#!/usr/bin/env python3
"""KMV / Merton structural credit-rating engine (PFPA Course #2).

Implements the market-based rating pipeline taught on slides 90-108 of the
course deck:

  * Equity is a call option on the firm's assets, struck at the default point.
  * The unobservable asset value A_t and asset volatility sigma_A are recovered
    from the observable equity series via an EM algorithm.
  * Outputs: Distance-to-Default (DD), PIT PD (EDF = Phi(-DD)) and the TiC
    rating (sigma_A^2 / ln^2(A/D)).

The module is pure stdlib (math / statistics) so it matches the dependency-free
style of ``test_massive_api.py`` and can run against the existing raw samples.

Conventions (finalized 2026-07-29 against the professor's answer workbook
"TiC Rating(Prof 更新).xlsx"; every item below reproduces his numbers):

  * sigma_A       = stdev of sqrt(250)-scaled daily log asset returns (deck).
  * R_A           = ANNUALIZED drift estimate eta_A - sigma_A^2/2
                    = sqrt(250) * mean(scaled returns) = 250 * mean(daily ln-return).
                    The deck's literal mean is 1/sqrt(250) of this; the extra
                    sqrt(250) is required dimensionally and matches the answer key.
  * DD            = (ln(A/D) + R_A) / sigma_A          (no-tau approximation,
                    professor's in-class rule), EDF = Phi(-DD).
  * CCM, mu       use |R_A|;  TiC = CCM/mu = sigma_A^2 / ln^2(A/D).
  * PIT PD        = first-passage PD at T = 1 year (``pd_fh``), NOT the EDF.
  * Default point = total liabilities (see rating_inputs.debt_basis).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from statistics import NormalDist, stdev
from typing import Sequence

_NORM = NormalDist()

# Trading days per year used by the deck (slides 100 / 104).
TRADING_DAYS = 250
# Default calendar convention for time-to-maturity (slide 100/101).
CALENDAR_DAYS = 365.0


def norm_cdf(x: float) -> float:
    """Standard normal CDF, Phi(x)."""
    return _NORM.cdf(x)


# --------------------------------------------------------------------------- #
# Per-day model inputs
# --------------------------------------------------------------------------- #
@dataclass
class DayInput:
    """One trading day of model inputs.

    Attributes
    ----------
    date:
        ISO price date, ascending.
    equity:
        Observed equity value E = dividend_adjusted_close * shares_outstanding.
    debt:
        Default point D for the as-of quarter (short-term debt + 0.5 * long-term).
    rate:
        Annualized 1-year risk-free rate (decimal) for the as-of quarter.
    tau:
        Time-to-maturity of the debt in years, tau ~= 1 - (t - quarter_end)/365,
        clamped to (0, 1].
    """

    date: str
    equity: float
    debt: float
    rate: float
    tau: float

    @property
    def discounted_debt(self) -> float:
        """D * e^{-r * tau} -- the strike, discounted to the price date."""
        return self.debt * math.exp(-self.rate * self.tau)

    @property
    def z(self) -> float:
        """z = E / (D * e^{-r*tau}) -- target of the g-function inversion."""
        return self.equity / self.discounted_debt


@dataclass
class EMResult:
    """Output of the EM asset-recovery plus the derived rating metrics."""

    sigma_a: float                     # asset volatility (annualized)
    eta_a: float                       # asset growth rate (annualized drift)
    r_a: float                         # ANNUALIZED eta_a - sigma_a^2/2 (= sqrt(250) * mean scaled return)
    assets: list[float]                # recovered asset value per trading day
    iterations: int
    sigma_history: list[float]
    converged: bool
    sigma_e: float = 0.0               # equity volatility (initial-step stdev, "StockVol")
    # Rating metrics evaluated at the latest day.
    asset_latest: float = 0.0
    equity_latest: float = 0.0
    debt_latest: float = 0.0
    tau_latest: float = 0.0
    dd: float = 0.0                    # distance to default, (ln(A/D) + R_A) / sigma_A
    pit_pd: float = 0.0                # EDF = Phi(-DD) (Merton, default at maturity)
    pd_fh: float = 0.0                 # first-passage PD at T=1y (the course's "PIT PD")
    tic: float = 0.0                   # TiC rating = sigma_a^2 / ln^2(A/D) (paper eq 12)
    risk_score: float = 0.0            # RiskScore = 100 * TiC (paper eq 5)
    ccm: float = 0.0                   # Credit Corrosion Measure (paper eq 11)
    mu: float = 0.0                    # Life Expectancy E[tau] in years (paper eq 11)


# --------------------------------------------------------------------------- #
# The g-function and its inverse (slides 102-103)
# --------------------------------------------------------------------------- #
def g_function(x: float, sigma: float, tau: float) -> float:
    """g(x, sigma, tau) = x*Phi(d1) - Phi(d2), monotonically increasing in x.

    d1 = (ln x + sigma^2/2 * tau) / (sigma*sqrt(tau))
    d2 = (ln x - sigma^2/2 * tau) / (sigma*sqrt(tau))

    This is the normalized Black-Scholes equity price where
    x = A / (D e^{-r tau}); solving g(x)=z recovers the normalized asset value.
    """
    if x <= 0:
        return -1.0  # below any attainable equity/strike ratio
    s = sigma * math.sqrt(tau)
    d1 = (math.log(x) + 0.5 * sigma * sigma * tau) / s
    d2 = d1 - s
    return x * norm_cdf(d1) - norm_cdf(d2)


def inverse_g(
    z: float,
    sigma: float,
    tau: float,
    *,
    tol: float = 1e-10,
    max_iter: int = 200,
) -> float:
    """Solve g(x, sigma, tau) = z for x via bisection (slide 103).

    g is strictly increasing in x, so bisection converges reliably.  The lower
    bound is 0; the upper bound is grown geometrically until g exceeds z.
    """
    if z <= 0:
        return 0.0
    lo, hi = 0.0, max(z + 1.0, 2.0)
    # Expand hi until g(hi) >= z.
    while g_function(hi, sigma, tau) < z:
        hi *= 2.0
        if hi > 1e12:  # runaway guard
            break
    for _ in range(max_iter):
        mid = 0.5 * (lo + hi)
        val = g_function(mid, sigma, tau)
        if abs(val - z) < tol or (hi - lo) < tol:
            return mid
        if val < z:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


# --------------------------------------------------------------------------- #
# EM algorithm (slides 104-108)
# --------------------------------------------------------------------------- #
def _annualized_log_returns(assets: Sequence[float]) -> list[float]:
    """R_i = sqrt(250) * ln(A_{i+1} / A_i), following slide 104 exactly.

    Note: the deck scales each daily log-return by sqrt(250).  Std of these gives
    the annualized volatility; the deck also averages them for R_A and treats
    that mean as eta_A - sigma_A^2/2 (slide 108).
    """
    scale = math.sqrt(TRADING_DAYS)
    out: list[float] = []
    for prev, nxt in zip(assets, assets[1:]):
        if prev <= 0 or nxt <= 0:
            continue
        out.append(scale * math.log(nxt / prev))
    return out


def run_em(
    days: Sequence[DayInput],
    *,
    tol: float = 1e-6,
    max_iter: int = 100,
) -> EMResult:
    """Recover asset value / volatility from the equity series via EM.

    Parameters
    ----------
    days:
        Ascending-by-date list of :class:`DayInput`.  At least ~2 rows are
        required to compute a return series; the course recommends ~60+.
    tol:
        Convergence tolerance on sigma_A between iterations.
    max_iter:
        Iteration cap (the deck's MSFT example converges in 2-3 rounds).
    """
    if len(days) < 2:
        raise ValueError("EM requires at least 2 trading days of equity data")

    # --- Initial step (m=0): use equity itself as the asset proxy. -----------
    assets = [d.equity for d in days]
    returns = _annualized_log_returns(assets)
    sigma = stdev(returns) if len(returns) > 1 else abs(returns[0]) if returns else 0.30
    sigma_e = sigma  # equity volatility ("StockVol" in the answer workbook)
    sigma_history = [sigma]

    converged = False
    iterations = 0
    for iterations in range(1, max_iter + 1):
        prev_sigma = sigma
        # --- E-step: recover asset value per day from equity given sigma. ----
        assets = []
        for d in days:
            x = inverse_g(d.z, prev_sigma, d.tau)
            assets.append(x * d.discounted_debt)
        # --- M-step: update volatility / drift from the asset series. --------
        returns = _annualized_log_returns(assets)
        sigma = stdev(returns) if len(returns) > 1 else prev_sigma
        sigma_history.append(sigma)
        if abs(sigma - prev_sigma) < tol:
            converged = True
            break

    returns = _annualized_log_returns(assets)
    # The scaled-return mean is (eta - sigma^2/2)/sqrt(250); multiply by
    # sqrt(250) so r_a is the annualized drift term (professor's answer key).
    mean_scaled = sum(returns) / len(returns) if returns else 0.0
    r_a = math.sqrt(TRADING_DAYS) * mean_scaled
    eta_a = r_a + 0.5 * sigma * sigma

    result = EMResult(
        sigma_a=sigma,
        eta_a=eta_a,
        r_a=r_a,
        assets=assets,
        iterations=iterations,
        sigma_history=sigma_history,
        converged=converged,
        sigma_e=sigma_e,
    )
    _attach_rating(result, days[-1])
    return result


def _attach_rating(result: EMResult, last: DayInput) -> None:
    """Evaluate DD / EDF / TiC at the latest trading day (slide 108)."""
    a = result.assets[-1]
    d = last.debt
    result.asset_latest = a
    result.equity_latest = last.equity
    result.debt_latest = d
    result.tau_latest = last.tau
    if a <= 0 or d <= 0:
        return
    ln_ad = math.log(a / d)
    sigma = result.sigma_a
    # DD = (ln(A/D) + R_A) / sigma_A -- the professor's no-tau approximation
    # (in class, 2026-07-15: "the second term is R_A, directly from your
    # algorithm"; matches the answer workbook exactly).
    result.dd = (ln_ad + result.r_a) / sigma
    result.pit_pd = norm_cdf(-result.dd)  # EDF = Phi(-DD): Merton, default at maturity

    # TiC rating = sigma_A^2 / ln^2(A/D).
    #
    # VERIFIED against BOTH the deck (slides 88 & 108) and the source paper
    # "Universal Time-Consistent (TiC) Credit Rating" (Yimin Yang), eq (11)-(12):
    #   CCM = sigma_A^2 / (ln(A/D) * |eta - sigma_A^2/2|)     (eq 11)
    #   mu  = ln(A/D) / |eta - sigma_A^2/2|                   (eq 11, Life Expectancy E[tau])
    #   TiC = CCM / mu = sigma_A^2 / ln^2(A/D)                (eq 12, Q=1, eta-invariant)
    # TiC is invariant under Girsanov (risk-neutral vs empirical), so it does NOT
    # depend on the risk-free rate. The MSFT worked example prints TiC=0.08531 while
    # this formula with that page's (A, D, sigma_A) yields 0.00976; DD/EDF reproduce
    # exactly, so the printed 0.08531 is a slide-number inconsistency, not a code bug.
    # RiskScore RS = 100 * TiC (paper eq 5) is the practical reporting scale.
    result.tic = (sigma ** 2) / (ln_ad ** 2) if ln_ad != 0 else float("inf")
    result.risk_score = 100.0 * result.tic
    drift = abs(result.r_a)  # |R_A| = |eta_A - sigma_A^2/2|, annualized (paper eq 11)
    if drift > 0 and ln_ad != 0:
        result.ccm = (sigma ** 2) / (ln_ad * drift)
        result.mu = ln_ad / drift

    # First-passage default probability (paper eq 13) at the fixed 1-year
    # horizon T=1 (the answer workbook's FP_PD): unlike EDF (default only at
    # maturity), this allows default at any time up to T. Generally >= EDF.
    #   PD_FH = Phi(sqrt(1/CCM)*(sqrt(T/mu) - sqrt(mu/T)))
    #         + exp(2/CCM) * Phi(-sqrt(1/CCM)*(sqrt(T/mu) + sqrt(mu/T)))
    if result.ccm > 0 and result.mu > 0:
        horizon = 1.0
        c = math.sqrt(1.0 / result.ccm)
        s_tm, s_mt = math.sqrt(horizon / result.mu), math.sqrt(result.mu / horizon)
        term1 = norm_cdf(c * (s_tm - s_mt))
        # exp(2/CCM) overflows for extremely safe credits (CCM -> 0), but it
        # multiplies Phi(hugely-negative) which decays far faster, so the product
        # is ~0. Guard the overflow and treat that term as 0.
        try:
            term2 = math.exp(2.0 / result.ccm) * norm_cdf(-c * (s_tm + s_mt))
        except OverflowError:
            term2 = 0.0
        result.pd_fh = term1 + term2

    # PIT -> S&P TTC conversion: the deck slide 113 is blank, but the source paper
    # fully specifies it (Section 5.3, Prop 5.2.1/5.2.2, Tables 13-14) via the
    # No-Regulatory-Arbitrage method with S&P constant Q=0.625913, CML=e^1.35.
    # See ttc_conversion (to be implemented) and the project notes.


def rate_company(days: Sequence[DayInput], **kwargs) -> EMResult:
    """Convenience wrapper: run EM and return the full rating result."""
    return run_em(days, **kwargs)
