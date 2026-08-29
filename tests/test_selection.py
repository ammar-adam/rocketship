"""
Position limits: the largest deterministic lever on the final portfolio.

It can promote stocks the judge declined, drop stocks it chose, and always emits
8-12 names whatever the debate concluded. Until now it was ~90 lines inline in a
470-line pipeline function and had no tests at all.
"""
from __future__ import annotations

import random

import pytest

from src.selection import apply_position_limits, selection_breakdown


def mk(n, *, verdict="HOLD", conf=50, base_score=50.0, sector="Technology", start=0):
    """n tickers with descending rocket_score."""
    return {
        f"T{start + i}": {
            "verdict": verdict,
            "confidence": conf,
            "rocket_score": base_score - i,
            "sector": sector,
            "selection_group": "top23",
        }
        for i in range(n)
    }


def summary_from(by_ticker):
    buy = [t for t, d in by_ticker.items() if d["verdict"] == "BUY"]
    hold = [t for t, d in by_ticker.items() if d["verdict"] == "HOLD"]
    sell = [t for t, d in by_ticker.items() if d["verdict"] == "SELL"]
    return {"buy": buy, "hold": hold, "sell": sell, "byTicker": by_ticker}


# ---------------------------------------------------------------------------
# promotion
# ---------------------------------------------------------------------------

def test_promotes_exactly_enough_holds_to_reach_the_floor():
    bt = {}
    bt.update(mk(3, verdict="BUY", conf=90, base_score=80, start=0))
    bt.update(mk(10, verdict="HOLD", conf=60, base_score=70, start=100))
    final, summary, trace = apply_position_limits(summary_from(bt))

    assert len(trace["promoted"]) == 5, "3 BUY + 5 promoted = MIN_BUY 8"
    assert len(final) == 8
    for t in trace["promoted"]:
        assert summary["byTicker"][t]["promoted_from_hold"] is True
        assert t not in summary["hold"]


def test_promotion_order_is_confidence_then_rocket_score():
    bt = {
        "HI_CONF": {"verdict": "HOLD", "confidence": 80, "rocket_score": 10, "sector": "A"},
        "HI_SCORE": {"verdict": "HOLD", "confidence": 40, "rocket_score": 99, "sector": "B"},
    }
    _final, _s, trace = apply_position_limits(summary_from(bt), min_buy=1)
    assert trace["promoted"] == ["HI_CONF"], "confidence outranks rocket_score"


def test_equal_confidence_collapses_to_rocket_score_ranking():
    """
    The exact failure mode behind the five-week outage.

    When every LLM call fails, each verdict falls back to the synthetic HOLD
    with confidence 50. The sort key's first term is then constant, so the
    tiebreak takes over and final_buys becomes the top N of the deterministic
    screen -- presented as the output of a five-agent debate.
    """
    # Spread across sectors so the 6-per-sector cap does not bind and the
    # confidence tiebreak is isolated.
    bt = {}
    sectors = ["A", "B", "C", "D", "E"]
    for i in range(20):
        bt[f"T{i}"] = {
            "verdict": "HOLD", "confidence": 50, "rocket_score": 90.0 - i,
            "sector": sectors[i % len(sectors)], "selection_group": "top23",
        }
    final, _s, _t = apply_position_limits(summary_from(bt))

    picked = [f["ticker"] for f in final]
    expected = [f"T{i}" for i in range(8)]                   # highest rocket_score
    assert picked == expected, (
        "with equal confidences the selection is pure top-N by rocket_score; "
        "this is why a dead LLM produced a normal-looking portfolio"
    )


def test_no_promotion_when_already_at_the_floor():
    bt = mk(9, verdict="BUY", conf=70, sector="A")
    _final, _s, trace = apply_position_limits(summary_from(bt))
    assert trace["promoted"] == []


# ---------------------------------------------------------------------------
# sector cap and clamp
# ---------------------------------------------------------------------------

def test_sector_cap_drops_the_seventh_name_of_a_sector():
    bt = mk(9, verdict="BUY", conf=70, sector="Technology")
    final, _s, trace = apply_position_limits(summary_from(bt))
    assert len(trace["sector_dropped"]) == 3, "9 tech names, cap 6"
    sectors = [f["sector"] for f in final]
    assert sectors.count("Technology") <= 6


def test_hard_clamp_to_max_buy():
    bt = {}
    for i, sec in enumerate(["A", "B", "C", "D"]):
        bt.update(mk(5, verdict="BUY", conf=90 - i, sector=sec, start=i * 10))
    final, _s, trace = apply_position_limits(summary_from(bt))
    assert len(final) == 12
    assert trace["clamped"], "the excess must be recorded, not silently dropped"


def test_padding_can_breach_the_sector_cap():
    """
    Padding from remaining HOLDs is NOT sector-capped. Documented rather than
    fixed, because it is shipped behaviour; Stage C measures what it costs.
    """
    bt = {}
    bt.update(mk(2, verdict="BUY", conf=90, sector="Technology", start=0))
    bt.update(mk(10, verdict="HOLD", conf=50, sector="Technology", start=100))
    final, _s, _t = apply_position_limits(summary_from(bt))
    assert len(final) == 8
    assert sum(1 for f in final if f["sector"] == "Technology") == 8


# ---------------------------------------------------------------------------
# the invariant
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("seed", range(40))
def test_always_between_min_and_max_when_enough_candidates(seed):
    rng = random.Random(seed)
    n = rng.randint(10, 40)
    sectors = ["Technology", "Healthcare", "Energy", "Financial Services", "Utilities"]
    bt = {
        f"T{i}": {
            "verdict": rng.choice(["BUY", "HOLD", "SELL"]),
            "confidence": rng.randint(0, 100),
            "rocket_score": rng.uniform(0, 100),
            "sector": rng.choice(sectors),
            "selection_group": "top23",
        }
        for i in range(n)
    }
    s = summary_from(bt)
    n_selectable = len(s["buy"]) + len(s["hold"])
    final, _s, _t = apply_position_limits(s)

    if n_selectable >= 8:
        assert 8 <= len(final) <= 12, (len(final), n_selectable)
    assert len(final) <= 12, "the hard clamp must never be exceeded"
    assert len({f["ticker"] for f in final}) == len(final), "no duplicates"


def test_sell_verdicts_are_never_selected():
    bt = {}
    bt.update(mk(8, verdict="BUY", conf=70, sector="A", start=0))
    bt.update(mk(5, verdict="SELL", conf=95, base_score=100, sector="B", start=50))
    sells = {f"T{50 + i}" for i in range(5)}
    final, _s, _t = apply_position_limits(summary_from(bt))
    assert not (sells & {f["ticker"] for f in final}), \
        "a high-confidence SELL must not reach the portfolio"


def test_padding_undoes_the_sector_cap_it_just_enforced():
    """
    Found by a failing test, not by reading the code.

    20 same-sector HOLDs: promotion takes the top 8, the cap then drops 2 of
    them back to 6, and the pad step -- which is NOT sector-capped -- tops back
    up to 8 from the names ranked BELOW the ones the cap just rejected.

    So the cap does not reduce sector concentration here at all. It only swaps
    two higher-ranked names for two lower-ranked ones in the same sector.
    """
    bt = mk(20, verdict="HOLD", conf=50, base_score=90.0, sector="Technology")
    final, _s, trace = apply_position_limits(summary_from(bt))

    assert len(final) == 8
    assert sum(1 for f in final if f["sector"] == "Technology") == 8, \
        "cap enforced 6, padding put it straight back to 8"
    assert set(trace["sector_dropped"]) == {"T6", "T7"}
    assert set(trace["padded"]) == {"T8", "T9"}, \
        "padded names rank BELOW the ones the cap rejected"


# ---------------------------------------------------------------------------
# ablation flags (used by Stage C)
# ---------------------------------------------------------------------------

def test_promotion_can_be_disabled():
    bt = {}
    bt.update(mk(3, verdict="BUY", conf=90, start=0))
    bt.update(mk(10, verdict="HOLD", conf=60, start=100))
    final, _s, trace = apply_position_limits(summary_from(bt), promote_holds=False)
    # No promotion, but the pad step still tops up to the floor.
    assert trace["promoted"] == []
    assert trace["padded"], "padding is a separate rule from promotion"


def test_sector_cap_can_be_disabled():
    bt = mk(9, verdict="BUY", conf=70, sector="Technology")
    final, _s, trace = apply_position_limits(summary_from(bt), apply_sector_cap=False)
    assert trace["sector_dropped"] == []
    assert sum(1 for f in final if f["sector"] == "Technology") == 9


def test_breakdown_counts_groups():
    final = [{"selection_group": "top23"}, {"selection_group": "edge"},
             {"selection_group": "top23"}, {"selection_group": "extra"}]
    assert selection_breakdown(final) == {
        "top23": 2, "edge": 1, "best_of_worst": 0, "extra": 1
    }
