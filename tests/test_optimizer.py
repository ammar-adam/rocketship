"""
Optimizer constraints, and the two ways they quietly fail.

Both findings below were verified by running the code, not by reading it.
"""
from __future__ import annotations

import numpy as np
import pytest

from src.optimizer import compute_covariance_matrix, optimize_fallback

pd = pytest.importorskip("pandas")
cp = pytest.importorskip("cvxpy")


def _scores(n=12, n_tech=6):
    return [
        {
            "ticker": f"T{i}",
            "rocket_score": 90 - i,
            "sector": "Technology" if i < n_tech else f"Sector{i}",
            "breakdown": {"quality": 50},
        }
        for i in range(n)
    ]


def _final_buys(scores):
    return {"items": [{"ticker": s["ticker"]} for s in scores]}


# ---------------------------------------------------------------------------
# covariance
# ---------------------------------------------------------------------------

def test_covariance_is_symmetric_and_psd():
    rng = np.random.default_rng(0)
    rets = pd.DataFrame(rng.normal(0, 0.01, size=(250, 6)),
                        columns=[f"T{i}" for i in range(6)])
    cov = compute_covariance_matrix(rets)
    assert np.allclose(cov, cov.T), "covariance must be symmetric"
    assert np.linalg.eigvalsh(cov).min() >= -1e-9, "covariance must be PSD"


def test_covariance_shrinkage_pulls_off_diagonals_toward_zero():
    """The shipped estimator applies a hardcoded 0.2 shrinkage, not an estimated one."""
    rng = np.random.default_rng(1)
    base = rng.normal(0, 0.01, size=(250, 1))
    rets = pd.DataFrame(np.hstack([base, base * 0.99 + rng.normal(0, 0.001, (250, 1))]),
                        columns=["A", "B"])
    cov = compute_covariance_matrix(rets)
    sample = np.cov(rets.values, rowvar=False)
    assert abs(cov[0, 1]) < abs(sample[0, 1]), "shrinkage must reduce off-diagonal magnitude"


# ---------------------------------------------------------------------------
# finding 1: the constraint set is infeasible in a case the pipeline can produce
# ---------------------------------------------------------------------------

def test_sector_cap_and_position_limits_are_mutually_infeasible():
    """
    apply_position_limits permits up to MAX_PER_SECTOR=6 names in one sector and
    a floor of 8 positions. With max_weight=0.12 and sum(w) >= 0.95 that is
    arithmetically impossible:

        one sector <= 0.35, the other 2 names <= 2 * 0.12 = 0.24
        maximum attainable sum = 0.59, required 0.95

    So the solver returns `infeasible` and optimize_portfolio silently takes the
    equal-weight fallback path - which produces a structurally different result
    (no backtest, different optimization_params) with no warning.
    """
    n, k, max_weight, sector_cap = 8, 6, 0.12, 0.35
    w = cp.Variable(n)
    cons = [cp.sum(w) >= 0.95, cp.sum(w) <= 1.0, w >= 0.01, w <= max_weight,
            cp.sum(w[:k]) <= sector_cap]
    prob = cp.Problem(cp.Maximize(cp.sum(w)), cons)
    prob.solve()

    assert prob.status == "infeasible"
    assert sector_cap + (n - k) * max_weight < 0.95, "the arithmetic, spelled out"


def test_twelve_positions_is_feasible():
    """The same constraints are satisfiable at 12 positions, so the bug is size-dependent."""
    n, k, max_weight, sector_cap = 12, 6, 0.12, 0.35
    w = cp.Variable(n)
    cons = [cp.sum(w) >= 0.95, cp.sum(w) <= 1.0, w >= 0.01, w <= max_weight,
            cp.sum(w[:k]) <= sector_cap]
    prob = cp.Problem(cp.Maximize(cp.sum(w)), cons)
    prob.solve()
    assert prob.status in ("optimal", "optimal_inaccurate")


# ---------------------------------------------------------------------------
# finding 2: the fallback violates the cap it just enforced
# ---------------------------------------------------------------------------

def test_fallback_renormalisation_breaches_its_own_sector_cap():
    """
    optimize_fallback scales an over-weight sector down to sector_cap, then
    renormalises ALL weights so they sum to 1 - which scales the capped sector
    straight back up.

    Worked example, n=12 with 6 in one sector, cap 0.35:
      sector -> 0.35, others -> 0.50, total 0.85
      renormalised sector share -> 0.35 / 0.85 = 0.412, over the cap again.
    """
    scores = _scores(12, 6)
    pf = optimize_fallback("test", 10000, 0.12, 0.35, 12, 12,
                           scores_data=scores, final_buys_data=_final_buys(scores))

    tech = sum(a["weight"] for a in pf["allocations"] if a["sector"] == "Technology")
    assert tech > 0.35, "the cap is undone by the later renormalisation"
    assert abs(tech - 0.4116) < 0.01, f"expected ~0.412, got {tech:.4f}"
    assert abs(sum(a["weight"] for a in pf["allocations"]) - 1.0) < 0.01


def test_fallback_reports_no_backtest():
    """The fallback path always returns backtest=None, so a silent fall-through
    also silently removes the backtest the UI expects."""
    scores = _scores(9, 2)
    pf = optimize_fallback("test", 10000, 0.12, 0.35, 9, 9,
                           scores_data=scores, final_buys_data=_final_buys(scores))
    assert pf.get("backtest") is None


# ---------------------------------------------------------------------------
# no disk IO when both inputs are supplied
# ---------------------------------------------------------------------------

def test_fallback_does_not_touch_disk_when_data_is_passed(monkeypatch, tmp_path):
    """
    optimize_portfolio/optimize_fallback read run_dir from disk unless BOTH
    scores_data and final_buys_data are supplied. Tests and the eval must always
    pass both; this pins that the supported no-IO path really is IO-free.
    """
    import src.optimizer as opt

    def _boom(*a, **k):
        raise AssertionError("optimizer touched the filesystem")

    monkeypatch.setattr(opt, "open", _boom, raising=False)
    monkeypatch.chdir(tmp_path)

    scores = _scores(9, 2)
    pf = optimize_fallback("test", 10000, 0.12, 0.35, 9, 9,
                           scores_data=scores, final_buys_data=_final_buys(scores))
    assert pf["allocations"]


# ---------------------------------------------------------------------------
# caps yielding to feasibility
# ---------------------------------------------------------------------------

def test_small_book_solves_instead_of_falling_back():
    """
    Five positions with a 12% cap cannot deploy 95% - 5 x 0.12 = 0.60. The
    solver used to return `infeasible` and the code silently took the
    equal-weight fallback, which renormalises AFTER capping and so breaches the
    cap it was enforcing. Observed live: a 12% cap producing a 25.5% position,
    and no backtest.

    A five-name book is a legitimate request, so the cap now yields by the
    minimum amount that admits a solution, and says so.
    """
    scores = [
        {"ticker": t, "rocket_score": 70 - i * 3,
         "sector": "Technology" if i < 4 else "Communication Services",
         "breakdown": {"quality": 50}}
        for i, t in enumerate(["AAPL", "MSFT", "NVDA", "AMD", "GOOGL"])
    ]
    fb = {"items": [{"ticker": s["ticker"]} for s in scores]}

    from src.optimizer import optimize_portfolio
    pf = optimize_portfolio("t", 10000, 0.12, 0.35, 5, 5,
                            scores_data=scores, final_buys_data=fb)

    assert pf["methodology"]["optimizer"] == "CVXPY", "should solve, not fall back"

    relaxed = pf["constraints"].get("relaxed") or {}
    assert "max_weight" in relaxed, "the relaxation must be reported, not silent"
    assert relaxed["max_weight"]["requested"] == 0.12
    assert relaxed["max_weight"]["applied"] >= 0.95 / 5 - 1e-9

    weights = [a["weight"] for a in pf["allocations"]]
    applied = pf["constraints"]["max_weight"]
    assert max(weights) <= applied + 1e-6, "the APPLIED cap must still bind"
    assert 0.94 <= sum(weights) <= 1.01
    assert pf.get("backtest") is not None, "the solved path emits a backtest"


def test_a_large_enough_book_keeps_the_requested_caps():
    """The relaxation is the minimum needed; it must not fire when unnecessary."""
    scores = [
        {"ticker": f"T{i}", "rocket_score": 80 - i,
         "sector": f"S{i % 6}", "breakdown": {"quality": 50}}
        for i in range(12)
    ]
    fb = {"items": [{"ticker": s["ticker"]} for s in scores]}

    from src.optimizer import optimize_portfolio
    pf = optimize_portfolio("t", 10000, 0.12, 0.35, 12, 12,
                            scores_data=scores, final_buys_data=fb)

    assert not (pf["constraints"].get("relaxed") or {}),         "12 positions at a 12% cap can reach 95%; nothing should be relaxed"
    assert pf["constraints"]["max_weight"] == 0.12
