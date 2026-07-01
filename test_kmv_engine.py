import math
import unittest

import kmv_engine as kmv
from kmv_engine import DayInput, g_function, inverse_g, run_em


class GFunctionTests(unittest.TestCase):
    def test_g_is_monotonically_increasing_in_x(self):
        sigma, tau = 0.3, 1.0
        prev = g_function(0.5, sigma, tau)
        for x in (1.0, 2.0, 5.0, 20.0):
            val = g_function(x, sigma, tau)
            self.assertGreater(val, prev)
            prev = val

    def test_inverse_g_round_trips(self):
        sigma, tau = 0.2864, 1.0
        for x in (1.5, 3.0, 10.0, 18.15):
            z = g_function(x, sigma, tau)
            recovered = inverse_g(z, sigma, tau)
            self.assertAlmostEqual(recovered, x, places=5)

    def test_inverse_g_handles_nonpositive_target(self):
        self.assertEqual(inverse_g(0.0, 0.3, 1.0), 0.0)
        self.assertEqual(inverse_g(-1.0, 0.3, 1.0), 0.0)


class RatingMetricTests(unittest.TestCase):
    """Validate DD / EDF against the course's MSFT benchmark (slide 108-112)."""

    def test_dd_and_edf_match_msft_benchmark(self):
        a = 2_265_617_704_382
        d = 124_819_000_000
        sigma, eta, tau = 0.2864, 0.1285, 1.0
        r_a = eta - 0.5 * sigma * sigma
        ln_ad = math.log(a / d)
        dd = (ln_ad + r_a * tau) / (sigma * math.sqrt(tau))
        edf = kmv.norm_cdf(-dd)
        # Slide reports DD = 10.426, PIT PD = 0.0000%.
        self.assertAlmostEqual(dd, 10.426, places=2)
        self.assertLess(edf, 1e-6)


class EMConvergenceTests(unittest.TestCase):
    def _series(self, closes, shares, debt, rate=0.045):
        n = len(closes)
        days = []
        for i, c in enumerate(closes):
            # tau shrinks slightly across the window, staying near 1y.
            tau = max(1e-3, 1.0 - (n - 1 - i) * 0.0 - i / 3650.0)
            days.append(DayInput(date=f"2026-01-{i+1:02d}", equity=c * shares, debt=debt, rate=rate, tau=tau))
        return days

    def test_em_converges_and_recovers_low_vol_for_stable_equity(self):
        # Nearly flat equity, far above debt -> low asset vol, huge DD, PD ~ 0.
        closes = [100.0 + 0.01 * i for i in range(80)]
        days = self._series(closes, shares=1_000_000_000, debt=5_000_000_000)
        result = run_em(days)
        self.assertTrue(result.converged)
        self.assertLess(result.iterations, 20)
        self.assertGreater(result.dd, 5.0)
        self.assertLess(result.pit_pd, 1e-3)
        self.assertGreater(result.sigma_a, 0.0)

    def test_em_requires_two_days(self):
        with self.assertRaises(ValueError):
            run_em([DayInput("2026-01-01", 1.0, 1.0, 0.04, 1.0)])


if __name__ == "__main__":
    unittest.main()
