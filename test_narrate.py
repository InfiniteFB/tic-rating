from unittest.mock import patch

import narrate


# ── the ported formatters must agree with web/js/format.js ────────────────

def test_money_k_is_thousands_denominated():
    assert narrate.money_k(4892510000) == "$4.89T"
    assert narrate.money_k(311350) == "$311.35M"
    assert narrate.money_k(None) == narrate.DASH
    assert narrate.money_k(-1000) == "−$1.00M"


def test_pct_switches_precision_by_magnitude():
    assert narrate.pct(0) == "0"
    assert narrate.pct(0.2488) == "24.88%"
    assert narrate.pct(0.01007) == "1.007%"
    assert narrate.pct(0.0001) == "0.0100%"
    assert narrate.pct(1e-8).endswith("%") and "e" in narrate.pct(1e-8)


def test_num_groups_thousands():
    assert narrate.num(131.263, 4) == "131.2630"
    assert narrate.num(1234.5, 2) == "1,234.50"


def test_rank_tolerates_missing_and_unknown_letters():
    assert narrate.rank("AAA") == 0
    assert narrate.rank(None) == len(narrate.SCALE)
    assert narrate.rank("not-a-notch") == len(narrate.SCALE)
    assert narrate.is_ig("BBB-") and not narrate.is_ig("BB+")
    assert not narrate.is_ig(None)


# ── the flags decide what the narration is obliged to discuss ─────────────

def _row(**snap):
    base = {"date": "2026-07-30", "asset": 100.0, "marketCap": 50.0,
            "spRating": "A", "alpha": 1.0, "mu": 5.0, "dd": 5.0}
    return {"ticker": "T", "name": "T Inc", "sector": "Industrials",
            "window": 150, "snaps": [{**base, **snap}]}


def _flags_for(row):
    return narrate._flags(row, row["snaps"][0])


def test_financials_always_flagged():
    row = _row()
    row["sector"] = "Financials"
    assert any("SECTOR ARTIFACT" in f for f in _flags_for(row))


def test_megacap_top_of_scale_flags_optimism_bias():
    # marketCap is in thousands: 6e8 thousands == $600B
    assert any("OPTIMISM BIAS" in f for f in _flags_for(_row(marketCap=6e8, spRating="AAA-")))
    # same size, but a letter well down the scale is not the biased case
    assert not any("OPTIMISM BIAS" in f for f in _flags_for(_row(marketCap=6e8, spRating="BBB")))
    # top of the scale but small: also not the biased case
    assert not any("OPTIMISM BIAS" in f for f in _flags_for(_row(marketCap=1e6, spRating="AAA-")))


def test_speculative_alpha_convergence_and_mu_flags():
    assert any("SPECULATIVE GRADE" in f for f in _flags_for(_row(spRating="CC")))
    assert any("ALPHA CLIPPED" in f for f in _flags_for(_row(alpha=0.99)))
    assert any("DID NOT CONVERGE" in f for f in _flags_for(_row(converged=False)))
    assert any("EXTREME MU" in f for f in _flags_for(_row(mu=4033.126)))
    assert _flags_for(_row()) == []


# ── the fact sheet ────────────────────────────────────────────────────────

def test_fact_sheet_derives_wedge_and_coverage():
    f = narrate.fact_sheet(_row(asset=200.0, marketCap=50.0), {})
    assert f["wedge"] == narrate.money_k(150.0)
    assert f["coverage"] == "1.33×"          # 200 / (200 - 50)


def test_fact_sheet_reads_the_close_at_or_before_the_snapshot():
    series = {"ohlc": {"dates": ["2026-07-28", "2026-07-29", "2026-08-04"],
                       "c": [100.0, 110.0, 999.0]}}
    f = narrate.fact_sheet(_row(), series)
    # the 08-04 bar is after the rating date and must not be picked up
    assert f["close"] == "$110.00" and f["close_date"] == "2026-07-29"
    assert f["day_move"] == "+10.00%"


def test_unrateable_row_yields_a_sheet_not_a_crash():
    row = {"ticker": "ZZ", "name": "Z", "unrateable_reason": "no balance sheet"}
    sheet = narrate.render_sheet(narrate.fact_sheet(row, {}))
    assert "not rateable" in sheet and "no balance sheet" in sheet


def test_render_sheet_carries_prior_snapshot_and_direction():
    row = _row()
    row["snaps"].append({"date": "2025-12-22", "spRating": "AA", "dd": 9.0,
                         "spPd": 0.0002, "marketCap": 40.0, "assetVol": 0.1})
    sheet = narrate.render_sheet(narrate.fact_sheet(row, {}))
    assert "AGAINST THE PRIOR CALIBRATION (2025-12-22)" in sheet
    assert "downgraded" in sheet          # AA -> A is a downgrade


# ── section splitting and the driver ──────────────────────────────────────

def test_split_sections_finds_all_four():
    text = ("### THE MARK\nA.\n### THE BALANCE SHEET\nB.\n"
            "### THE CHAIN\nC.\n### THE CAVEAT\nD.")
    out = narrate.split_sections(text)
    assert [out[k] for k in narrate.SECTIONS] == ["A.", "B.", "C.", "D."]


def test_split_sections_tolerates_missing_and_lowercase_headings():
    out = narrate.split_sections("### the mark\nonly this one.")
    assert out["THE MARK"] == "only this one."
    assert out["THE CHAIN"] == ""


def test_dry_run_makes_no_llm_call():
    with patch("app.llm._chat", side_effect=AssertionError("must not be called")):
        r = narrate.narrate(_row(), {}, dry_run=True)
    assert r["fact_sheet"] and r["sections"] == {} and r["error"] is None


def test_narrate_degrades_when_the_endpoint_fails():
    with patch("app.llm._chat", side_effect=RuntimeError("budget exhausted")):
        r = narrate.narrate(_row(), {})
    assert "budget exhausted" in r["error"]
    assert r["fact_sheet"]          # the deterministic layer survives regardless


def test_narrate_splits_a_successful_response():
    body = ("### THE MARK\nA rating.\n### THE BALANCE SHEET\nAssets.\n"
            "### THE CHAIN\nChain.\n### THE CAVEAT\nCaveat.")
    with patch("app.llm._chat", return_value=body):
        r = narrate.narrate(_row(), {})
    assert r["error"] is None
    assert r["sections"]["THE MARK"] == "A rating."
    assert r["sections"]["THE CAVEAT"] == "Caveat."
