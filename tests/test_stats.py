"""
The statistics have to recover things we already know the answer to.

A negative result is only worth anything if the machinery that produced it can
be shown to detect a positive one.
"""
from __future__ import annotations

import math
import random

from evals import stats as S


# ---------------------------------------------------------------------------
# inverse normal
# ---------------------------------------------------------------------------

def test_inv_norm_known_quantiles():
    for p, want in [(0.5, 0.0), (0.975, 1.959964), (0.025, -1.959964),
                    (0.99, 2.326348), (0.01, -2.326348)]:
        assert abs(S._inv_norm(p) - want) < 1e-5, (p, S._inv_norm(p))


def test_inv_norm_is_monotone_and_bounded():
    prev = -9.0
    for i in range(1, 1000):
        v = S._inv_norm(i / 1000)
        assert v > prev
        prev = v
    assert S._inv_norm(0.0) < -5 and S._inv_norm(1.0) > 5


# ---------------------------------------------------------------------------
# bootstrap
# ---------------------------------------------------------------------------

def test_plan_is_reproducible_from_seed():
    a = S.make_plan(["d1", "d2", "d3"], b=50, seed=7)
    b = S.make_plan(["d1", "d2", "d3"], b=50, seed=7)
    c = S.make_plan(["d1", "d2", "d3"], b=50, seed=8)
    assert a == b
    assert a != c


def test_ci_brackets_the_point_estimate():
    per_date = {"d1": 0.1, "d2": 0.2, "d3": 0.15, "d4": 0.05}
    plan = S.make_plan(sorted(per_date), b=2000, seed=1)
    out = S.ci(per_date, plan)
    assert abs(out["point"] - 0.125) < 1e-9
    assert out["lo"] <= out["point"] <= out["hi"]
    assert out["n_dates"] == 4


def test_paired_delta_of_an_arm_with_itself_is_exactly_zero():
    """The core property that makes pairing worth doing."""
    per_date = {"d1": 0.4, "d2": -0.2, "d3": 0.05, "d4": 0.31}
    plan = S.make_plan(sorted(per_date), b=1000, seed=3)
    out = S.paired_delta(per_date, per_date, plan)
    assert out["point"] == 0.0
    assert out["lo"] == 0.0 and out["hi"] == 0.0
    assert out["excludes_zero"] is False


def test_paired_delta_detects_a_constant_shift():
    a = {"d1": 0.4, "d2": -0.2, "d3": 0.05, "d4": 0.31}
    b = {k: v - 0.5 for k, v in a.items()}
    plan = S.make_plan(sorted(a), b=1000, seed=3)
    out = S.paired_delta(a, b, plan)
    assert abs(out["point"] - 0.5) < 1e-9
    assert out["excludes_zero"] is True


def test_pairing_is_tighter_than_differencing_level_intervals():
    """
    Two arms that co-move have wide level CIs and a narrow difference CI.
    Differencing the level intervals would wrongly call this inconclusive.
    """
    rng = random.Random(11)
    dates = [f"d{i}" for i in range(12)]
    common = {d: rng.uniform(-0.5, 0.5) for d in dates}      # shared date effect
    a = {d: common[d] + 0.05 for d in dates}
    b = dict(common)
    plan = S.make_plan(dates, b=3000, seed=5)

    ca, cb = S.ci(a, plan), S.ci(b, plan)
    delta = S.paired_delta(a, b, plan)

    level_width = min(ca["hi"] - ca["lo"], cb["hi"] - cb["lo"])
    assert delta["hi"] - delta["lo"] < level_width / 10
    assert delta["excludes_zero"] is True
    # the level intervals overlap heavily, i.e. unpaired analysis sees nothing
    assert ca["lo"] < cb["hi"] and cb["lo"] < ca["hi"]


# ---------------------------------------------------------------------------
# incremental information
# ---------------------------------------------------------------------------

def _rows(n_dates, n, score_fn, seed=0):
    rng = random.Random(seed)
    rows, labels = [], {}
    for d in range(n_dates):
        date = f"2026-0{d + 1}-15"
        for i in range(n):
            t = f"T{i}"
            base = rng.gauss(0, 1)
            y = base * 0.5 + rng.gauss(0, 1)
            rows.append({
                "ticker": t, "as_of_date": date,
                "score": score_fn(base, y, rng),
                "provenance": {"rocket_score": base},
            })
            labels[(t, date)] = {"fwd_excess_1M": y}
    return rows, labels


def test_incremental_is_zero_when_the_arm_only_echoes_the_screen():
    """An arm that is a monotone function of rocket_score adds nothing."""
    rows, labels = _rows(8, 40, lambda base, y, rng: base * 3.0 + 1.0, seed=2)
    out = S.incremental_information(rows, labels, "1M")
    plan = S.make_plan(sorted(out["incremental"]), b=2000, seed=1)
    inc = S.ci(out["incremental"], plan)
    assert abs(inc["point"]) < 0.05, inc
    # Inclusive: a PERFECT echo leaves a zero-variance residual, so the interval
    # is exactly [0, 0]. That still means "no new information".
    assert inc["lo"] <= 0 <= inc["hi"], "echo arm must not show new information"
    # and it should be almost entirely explained by the screen
    beta = S.ci(out["beta"], plan)["point"]
    assert beta > 0.95, beta


def test_incremental_is_positive_when_the_arm_knows_something_extra():
    """An arm that peeks at the label adds information beyond the screen."""
    rows, labels = _rows(8, 40, lambda base, y, rng: base + 2.0 * y, seed=4)
    out = S.incremental_information(rows, labels, "1M")
    plan = S.make_plan(sorted(out["incremental"]), b=2000, seed=1)
    inc = S.ci(out["incremental"], plan)
    assert inc["point"] > 0.1, inc
    assert inc["lo"] > 0, "a genuinely informative arm should exclude zero"


def test_decomposition_adds_up():
    """total ~= via_screen + incremental, on normal scores."""
    rows, labels = _rows(6, 50, lambda base, y, rng: base + y, seed=9)
    out = S.incremental_information(rows, labels, "1M")
    for d in out["total"]:
        lhs = out["total"][d]
        rhs = out["via_screen"][d] + out["incremental"][d]
        assert abs(lhs - rhs) < 0.02, (d, lhs, rhs)


# ---------------------------------------------------------------------------
# variance share
# ---------------------------------------------------------------------------

def test_a_constant_component_has_zero_effective_weight():
    """
    The Stage A audit: a component pinned to a constant cannot move a ranking,
    whatever weight it is given.
    """
    rows = {"d1": [{"a": i, "b": 50} for i in range(10)]}
    out = S.variance_share(rows, ["a", "b"], {"a": 0.5, "b": 0.5})
    assert out["b"]["share"] == 0.0
    assert out["a"]["share"] == 1.0
    assert out["b"]["advertised_weight"] == 0.5, "advertised weight is still reported"


def test_variance_share_tracks_dispersion_not_just_weight():
    rows = {"d1": [{"a": i, "b": i * 10} for i in range(10)]}
    out = S.variance_share(rows, ["a", "b"], {"a": 0.5, "b": 0.5})
    assert out["b"]["share"] > out["a"]["share"]
    assert abs(out["a"]["share"] + out["b"]["share"] - 1.0) < 1e-9
