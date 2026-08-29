"""
Sector vocabulary is a single canonical set, and everything maps into it.

Background: the product gets a stock's sector from `src/universe.get_sector`,
which returns `yf.Ticker(t).info["sector"]` -- yfinance's vocabulary, not GICS.
`compute_macro_score` and `data/macro_trends.json` both key on that vocabulary.

The eval harness originally used GICS names ("Health Care", "Financials",
"Materials"), so it scored a RocketScore production never computes: Healthcare
names missed the 60 base score, missed the GLP-1 trend, and missed the tag bonus
that follows from the trend match -- 13 macro points on every one of them.

These tests make that class of mismatch impossible to reintroduce silently.
"""
from __future__ import annotations

import pytest

# yfinance's sector strings. Verified against live yfinance, one ticker per
# sector (AAPL, GOOGL, AMZN, PG, UNH, JPM, CAT, XOM, NEE, AMT, LIN).
YF_SECTORS = frozenset({
    "Basic Materials",
    "Communication Services",
    "Consumer Cyclical",
    "Consumer Defensive",
    "Energy",
    "Financial Services",
    "Healthcare",
    "Industrials",
    "Real Estate",
    "Technology",
    "Utilities",
})

# Sectors named in data/macro_trends.json that yfinance never emits, so these
# trend entries can never fire in production. Documented rather than silently
# tolerated: if someone fixes the data file or adds a new bad entry, this test
# tells them.
KNOWN_UNREACHABLE_TREND_SECTORS = frozenset({
    "Materials",              # yfinance says "Basic Materials"
    "Consumer Discretionary", # yfinance says "Consumer Cyclical"
})


def test_eval_universe_maps_into_yfinance_vocabulary():
    from evals import config as C

    assert set(C.SECTOR_YF) == set(C.UNIVERSE), \
        "SECTOR_YF must cover every UNIVERSE sector"

    bad = {g: y for g, y in C.SECTOR_YF.items() if y not in YF_SECTORS}
    assert not bad, f"SECTOR_YF maps to non-yfinance strings: {bad}"

    scored = set(C.SECTOR_OF.values())
    assert scored <= YF_SECTORS, \
        f"tickers scored with non-yfinance sectors: {scored - YF_SECTORS}"


def test_every_ticker_has_both_a_scoring_sector_and_a_display_label():
    from evals import config as C

    assert set(C.SECTOR_OF) == set(C.TICKERS)
    assert set(C.SECTOR_LABEL) == set(C.TICKERS)
    # The display label is GICS and may legitimately differ from the scored one.
    assert C.SECTOR_OF["UNH"] == "Healthcare"
    assert C.SECTOR_LABEL["UNH"] == "Health Care"


def test_macro_score_sector_lists_use_yfinance_vocabulary():
    """compute_macro_score's own favourable/unfavourable lists must be valid."""
    import inspect

    import src.rocket_score as rs

    src_text = inspect.getsource(rs.compute_macro_score)
    # Any GICS-only string appearing here would be dead code.
    for gics_only in ("Health Care", "Financial Services Sector",
                      "Consumer Discretionary", "Basic Materials Sector"):
        if gics_only == "Consumer Discretionary":
            continue  # covered by the trend-sector test below
        assert gics_only not in src_text, \
            f"compute_macro_score references {gics_only!r}, which yfinance never emits"


def test_macro_trends_unreachable_sectors_are_exactly_the_known_set(macro_trends):
    """
    Pins the set of trend sectors that can never match production's vocabulary.

    Shrinking this set is a fix; growing it is a regression. Either way the test
    should be updated deliberately, not by accident.
    """
    named = set()
    for trend in macro_trends.values():
        named.update(trend.get("sectors", []))

    unreachable = named - YF_SECTORS
    assert unreachable == KNOWN_UNREACHABLE_TREND_SECTORS, (
        "data/macro_trends.json unreachable sectors changed.\n"
        f"  now:      {sorted(unreachable)}\n"
        f"  expected: {sorted(KNOWN_UNREACHABLE_TREND_SECTORS)}"
    )


@pytest.mark.parametrize("sector,expect_at_least", [
    ("Technology", 60),
    ("Healthcare", 60),
    ("Communication Services", 60),
    ("Utilities", 40),
    ("Real Estate", 40),
    ("Financial Services", 50),
])
def test_macro_score_base_by_sector(sector, expect_at_least):
    from src.rocket_score import compute_macro_score

    score, _ = compute_macro_score(sector)
    assert score >= expect_at_least, f"{sector} scored {score}, expected >= {expect_at_least}"


def test_healthcare_matches_the_glp1_trend():
    """The exact regression the vocabulary bug caused."""
    from src.rocket_score import compute_macro_score

    good, good_details = compute_macro_score("Healthcare")
    bad, bad_details = compute_macro_score("Health Care")

    assert good > bad, "Healthcare must outscore the GICS spelling"
    assert good_details["matched_trends"], "Healthcare should match GLP-1"
    assert not bad_details["matched_trends"], "the GICS spelling matches nothing"
