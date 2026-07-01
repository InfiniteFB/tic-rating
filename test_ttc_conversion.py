#!/usr/bin/env python3
"""Tests for ttc_conversion -- PIT -> S&P TTC conversion (paper Section 5.3).

Validation targets are taken directly from the source paper "Universal
Time-Consistent (TiC) Credit Rating" (Yimin Yang): the confidence-level anchors
of Section 5.3 and the worked Tables 13-14.
"""

import unittest

import ttc_conversion as ttc
from ttc_conversion import (
    cl_fh,
    cl_sp,
    convert_fh_to_sp,
    pd_first_passage,
    rs_first_passage,
    solve_ccm_star,
    sp_letter,
    sp_riskscore,
)


class ConfidenceLevelTests(unittest.TestCase):
    """Anchor values for CL_FH (paper Section 5.3)."""

    def test_cl_fh_at_1_5(self):
        self.assertAlmostEqual(cl_fh(1.5), 0.91906, places=5)

    def test_cl_fh_at_5(self):
        self.assertAlmostEqual(cl_fh(5.0), 0.72749, places=5)

    def test_cl_sp_is_monotonically_decreasing(self):
        # Needed for solve_ccm_star's bisection to be well defined.
        prev = cl_sp(0.5)
        for ccm in (1.0, 1.35, 2.0, 5.0, 20.0):
            val = cl_sp(ccm)
            self.assertLess(val, prev)
            prev = val

    def test_cl_fh_overflow_guard_for_tiny_ccm(self):
        # e^{2/CCM} overflows for very small CCM; must not raise.
        val = cl_fh(1e-3)
        self.assertTrue(0.0 <= val <= 1.0)


class CcmStarTests(unittest.TestCase):
    """No-Regulatory-Arbitrage map CCM_FH -> CCM* (Prop 5.2.1/5.2.2)."""

    def test_ccm_star_from_1_5(self):
        self.assertAlmostEqual(solve_ccm_star(1.5), 1.35373, places=4)

    def test_ccm_star_from_5(self):
        self.assertAlmostEqual(solve_ccm_star(5.0), 2.22928, places=4)

    def test_ccm_star_matches_confidence(self):
        # By construction CL_SP(CCM*) == CL_FH(CCM_FH) == alpha.
        for ccm_fh in (1.5, 5.0, 3.0):
            ccm_star = solve_ccm_star(ccm_fh)
            self.assertAlmostEqual(cl_sp(ccm_star), cl_fh(ccm_fh), places=6)


class Table13Tests(unittest.TestCase):
    """Reproduce paper Table 13 rows (CCM_FH = 1.5, CCM* = 1.35373)."""

    CCM_FH = 1.5

    def setUp(self):
        self.ccm_star = solve_ccm_star(self.CCM_FH)

    def _row(self, mu):
        pd = pd_first_passage(self.CCM_FH, mu)
        rs_sp = sp_riskscore(pd, self.ccm_star)
        return pd, rs_sp

    def test_rs_fh_self_check(self):
        # RS_FH = 100 * CCM / mu (paper eq 5).
        self.assertAlmostEqual(rs_first_passage(self.CCM_FH, 1), 150.0, places=6)
        self.assertAlmostEqual(rs_first_passage(self.CCM_FH, 5), 30.0, places=6)
        self.assertAlmostEqual(rs_first_passage(self.CCM_FH, 10), 15.0, places=6)
        self.assertAlmostEqual(rs_first_passage(self.CCM_FH, 15), 10.0, places=6)

    def test_mu_1(self):
        pd, rs_sp = self._row(1)
        self.assertAlmostEqual(pd, 0.6940, places=3)   # ~69.40%
        self.assertAlmostEqual(rs_sp / 139.0, 1.0, delta=0.02)  # RS_SP ~= 139
        self.assertEqual(sp_letter(rs_sp), "CCC/C")

    def test_mu_5(self):
        pd, rs_sp = self._row(5)
        self.assertAlmostEqual(pd, 0.1260, places=3)   # ~12.60%
        self.assertAlmostEqual(rs_sp / 53.35, 1.0, delta=0.02)  # RS_SP ~= 53.35
        self.assertEqual(sp_letter(rs_sp), "B")

    def test_mu_10(self):
        pd, rs_sp = self._row(10)
        self.assertAlmostEqual(pd, 0.0190, places=3)   # ~1.90%
        self.assertAlmostEqual(rs_sp / 30.99, 1.0, delta=0.02)  # RS_SP ~= 30.99
        # Paper labels this BB- ; Table 8's coarse buckets resolve it to BB.
        self.assertEqual(sp_letter(rs_sp), "BB")

    def test_mu_15(self):
        pd, rs_sp = self._row(15)
        self.assertAlmostEqual(pd, 0.0030, places=3)   # ~0.30%
        self.assertAlmostEqual(rs_sp / 21.08, 1.0, delta=0.02)  # RS_SP ~= 21.08
        self.assertEqual(sp_letter(rs_sp), "BB")


class Table14Tests(unittest.TestCase):
    """Spot-check paper Table 14 (CCM_FH = 5, CCM* = 2.22928)."""

    CCM_FH = 5.0

    def setUp(self):
        self.ccm_star = solve_ccm_star(self.CCM_FH)

    def test_ccm_star(self):
        self.assertAlmostEqual(self.ccm_star, 2.22928, places=4)

    def test_riskscore_is_finite_and_ordered(self):
        # Safer credit (larger mu) -> lower RS_SP, monotone.
        prev = None
        for mu in (1, 5, 10, 20):
            pd = pd_first_passage(self.CCM_FH, mu)
            rs_sp = sp_riskscore(pd, self.ccm_star)
            self.assertTrue(rs_sp > 0.0)
            if prev is not None:
                self.assertLess(rs_sp, prev)
            prev = rs_sp


class ConvertEntryPointTests(unittest.TestCase):
    def test_convert_returns_expected_keys(self):
        pd = pd_first_passage(1.5, 5)
        out = convert_fh_to_sp(1.5, 5, pd)
        for key in ("ccm_star", "alpha", "rs_sp", "sp_letter", "sp_ttc_pd", "credit_outlook"):
            self.assertIn(key, out)
        self.assertAlmostEqual(out["ccm_star"], 1.35373, places=4)
        self.assertAlmostEqual(out["alpha"], cl_fh(1.5), places=9)
        self.assertEqual(out["sp_letter"], "B")
        # credit_outlook = pd_fh - sp_ttc_pd (paper eq 28).
        self.assertAlmostEqual(out["credit_outlook"], pd - out["sp_ttc_pd"], places=12)

    def test_ttc_pd_is_between_table8_extremes(self):
        pd = pd_first_passage(1.5, 5)
        out = convert_fh_to_sp(1.5, 5, pd)
        self.assertGreater(out["sp_ttc_pd"], 0.0001)
        self.assertLess(out["sp_ttc_pd"], 0.3359)


if __name__ == "__main__":
    unittest.main()
