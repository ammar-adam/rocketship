"""
Stage C: does portfolio construction add anything, out of sample?

Zero LLM cost.

The product ships a backtest (src/optimizer.py::compute_backtest) that is
in-sample three separate ways:

  1. SELECTION LEAKAGE - the tickers were chosen by RocketScore computed on the
     trailing 252 days, and the backtest then replays those same 252 days.
  2. OPTIMISATION LEAKAGE - the covariance is estimated on that same window, the
     weights are solved against it, and the backtest replays it again.
  3. NO REBALANCING OR COSTS - today's weights are applied to every past day.

Its equal-weight benchmark also uses the SAME selected tickers, so it can only
ever isolate the weighting scheme; it cannot show that the screen adds value.

This module runs the product's own optimizer with the covariance fitted strictly
on data ending at the as-of date, then evaluates the resulting weights on
realised FORWARD returns. Putting the two numbers side by side gives the
look-ahead premium in basis points, which is the most quotable artifact here.

    python -m evals.stages.portfolio
"""
from __future__ import annotations

import json
import math
import os
import sys
from collections import defaultdict

import numpy as np
import pandas as pd

from evals import config as C
from evals import stats as S
from evals.asof import as_of_window, load_panel, neutralise_quality_score, score_as_of
from evals.runner import labels_from, load_eval_set

sys.path.insert(0, C.REPO_ROOT)

BASKET_SIZE = 12
LAMBDA_SWEEP = [0.0, 0.25, 1.0, 4.0, 16.0, 64.0, 256.0]


# ---------------------------------------------------------------------------
# returns, strictly as-of
# ---------------------------------------------------------------------------

def _adj(panel: pd.DataFrame, ticker: str) -> pd.Series | None:
    col = f"Adj Close|{ticker}"
    return panel[col].dropna() if col in panel.columns else None


def trailing_returns(tickers: list[str], as_of: str, lookback: int = 252) -> pd.DataFrame:
    """Daily returns ENDING at the as-of session. Nothing after it is visible."""
    panel = load_panel()
    cols = {}
    for t in tickers:
        s = _adj(panel, t)
        if s is None:
            continue
        s = s.loc[s.index <= pd.Timestamp(as_of)].tail(lookback + 1)
        if len(s) > 30:
            cols[t] = s.pct_change().dropna()
    return pd.DataFrame(cols).dropna(how="all")


def forward_returns(tickers: list[str], as_of: str, horizon_td: int) -> pd.DataFrame:
    """Daily returns AFTER the as-of session, for evaluation only."""
    panel = load_panel()
    cols = {}
    for t in tickers:
        s = _adj(panel, t)
        if s is None:
            continue
        pos = s.index.searchsorted(pd.Timestamp(as_of), side="right") - 1
        window = s.iloc[pos: pos + horizon_td + 1]
        if len(window) > 2:
            cols[t] = window.pct_change().dropna()
    return pd.DataFrame(cols).dropna(how="all")


# ---------------------------------------------------------------------------
# weighting schemes
# ---------------------------------------------------------------------------

def w_equal(tickers, **_) -> dict:
    return {t: 1.0 / len(tickers) for t in tickers}


def w_score(tickers, scores=None, **_) -> dict:
    vals = {t: max(1e-6, float(scores.get(t, 0.0))) for t in tickers}
    tot = sum(vals.values())
    return {t: v / tot for t, v in vals.items()}


def w_inverse_vol(tickers, trailing=None, **_) -> dict:
    inv = {}
    for t in tickers:
        if trailing is not None and t in trailing.columns:
            sd = float(trailing[t].std())
            inv[t] = 1.0 / sd if sd > 1e-9 else 0.0
        else:
            inv[t] = 0.0
    tot = sum(inv.values())
    return w_equal(tickers) if tot <= 0 else {t: v / tot for t, v in inv.items()}


def w_optimizer(tickers, scores=None, trailing=None, risk_lambda=1.0,
                max_weight=0.12, sector_cap=0.35, sectors=None, **_) -> dict:
    """
    The product's optimizer, with the covariance fitted only on as-of data.

    Calls src.optimizer's own compute_covariance_matrix so the shipped estimator
    (sample covariance + hardcoded 0.2 shrinkage, annualised) is what gets
    tested, not a reimplementation.
    """
    import cvxpy as cp

    from src.optimizer import compute_covariance_matrix

    cols = [t for t in tickers if trailing is not None and t in trailing.columns]
    if len(cols) < 3:
        return w_equal(tickers)

    R = trailing[cols].dropna()
    cov = compute_covariance_matrix(R) * 252.0
    mu = np.array([float(scores.get(t, 50.0)) / 100.0 for t in cols])

    n = len(cols)
    w = cp.Variable(n)
    min_w = min(0.01, 1.0 / n / 2)
    cons = [cp.sum(w) >= 0.95, cp.sum(w) <= 1.0, w >= min_w, w <= max_weight]

    if sectors:
        by_sector = defaultdict(list)
        for i, t in enumerate(cols):
            by_sector[sectors.get(t, "Unknown")].append(i)
        for _s, idx in by_sector.items():
            if len(idx) > 1:
                cons.append(cp.sum(w[idx]) <= sector_cap)

    prob = cp.Problem(
        cp.Maximize(mu @ w - risk_lambda * cp.quad_form(w, cp.psd_wrap(cov))), cons
    )
    for solver in ("OSQP", "CLARABEL", None):
        try:
            prob.solve(solver=solver) if solver else prob.solve()
            if prob.status in ("optimal", "optimal_inaccurate"):
                break
        except Exception:
            continue

    if w.value is None:
        return w_equal(tickers)

    raw = np.maximum(np.array(w.value).flatten(), 0.0)
    tot = raw.sum()
    if tot <= 0:
        return w_equal(tickers)
    return {t: float(v / tot) for t, v in zip(cols, raw)}


SCHEMES = {
    "optimizer": w_optimizer,
    "equal_weight": w_equal,
    "inverse_vol": w_inverse_vol,
    "score_weighted": w_score,
}


# ---------------------------------------------------------------------------
# evaluation
# ---------------------------------------------------------------------------

def _path_stats(daily: pd.Series) -> dict:
    if daily is None or len(daily) < 2:
        return {"total_return": None, "vol_ann": None, "sharpe": None, "max_dd": None}
    cum = (1 + daily).cumprod()
    total = float(cum.iloc[-1] - 1)
    sd = float(daily.std())
    vol = sd * math.sqrt(252)
    sharpe = (float(daily.mean()) * 252 / vol) if vol > 1e-12 else None
    run_max = cum.expanding().max()
    max_dd = float(((cum - run_max) / run_max).min())
    return {"total_return": total, "vol_ann": vol, "sharpe": sharpe, "max_dd": max_dd}


def _apply(weights: dict, rets: pd.DataFrame) -> pd.Series | None:
    cols = [t for t in weights if t in rets.columns]
    if not cols:
        return None
    w = pd.Series({t: weights[t] for t in cols})
    w = w / w.sum()
    return (rets[cols] * w).sum(axis=1)


def hhi(weights: dict) -> float:
    return float(sum(v * v for v in weights.values()))


def run(horizons: list[str] | None = None, b: int = S.DEFAULT_B) -> dict:
    neutralise_quality_score()
    horizons = horizons or list(C.HORIZONS.keys())

    wide = os.path.exists(C.EVAL_SET_WIDE_PATH)
    fixture = load_eval_set(C.EVAL_SET_WIDE_PATH if wide else None)
    labels = labels_from(fixture)
    dates = sorted({p["as_of_date"] for p in fixture["pairs"]})
    plan = S.make_plan(dates, b=b)
    panel = load_panel()

    per_date: dict = {}
    for as_of in dates:
        rows = []
        for t in C.TICKERS:
            try:
                rows.append(score_as_of(t, as_of))
            except Exception:
                continue
        rows.sort(key=lambda r: -r["rocket_score"])
        basket = [r["ticker"] for r in rows[:BASKET_SIZE]]
        scores = {r["ticker"]: r["rocket_score"] for r in rows}
        sectors = {r["ticker"]: r.get("sector", "Unknown") for r in rows}

        trailing = trailing_returns(basket, as_of)
        entry: dict = {"basket": basket, "weights": {}, "forward": {}, "in_sample": {}}

        for name, fn in SCHEMES.items():
            wts = fn(basket, scores=scores, trailing=trailing, sectors=sectors)
            entry["weights"][name] = {
                "w": {k: round(v, 5) for k, v in wts.items()},
                "hhi": round(hhi(wts), 4),
                "max_weight": round(max(wts.values()), 4),
                "n_at_cap": sum(1 for v in wts.values() if v > 0.1199),
            }

            # honest: forward-only evaluation
            for h, td in C.HORIZONS.items():
                fwd = forward_returns(basket, as_of, td)
                series = _apply(wts, fwd)
                entry["forward"].setdefault(h, {})[name] = _path_stats(series)

            # the product's own framing: replay the SAME trailing window the
            # weights and the selection were both derived from
            entry["in_sample"][name] = _path_stats(_apply(wts, trailing))

        # SPY, same forward windows
        spy = _adj(panel, C.BENCHMARK)
        for h, td in C.HORIZONS.items():
            pos = spy.index.searchsorted(pd.Timestamp(as_of), side="right") - 1
            win = spy.iloc[pos: pos + td + 1].pct_change().dropna()
            entry["forward"].setdefault(h, {})["spy"] = _path_stats(win)
        entry["in_sample"]["spy"] = _path_stats(
            spy.loc[spy.index <= pd.Timestamp(as_of)].tail(253).pct_change().dropna()
        )

        # lambda sweep: is the risk term doing anything at the shipped lambda?
        sweep = {}
        for lam in LAMBDA_SWEEP:
            wts = w_optimizer(basket, scores=scores, trailing=trailing,
                              sectors=sectors, risk_lambda=lam)
            sweep[str(lam)] = {"hhi": round(hhi(wts), 4),
                               "max_weight": round(max(wts.values()), 4),
                               "n_at_cap": sum(1 for v in wts.values() if v > 0.1199)}
        entry["lambda_sweep"] = sweep

        per_date[as_of] = entry

    # ---- aggregate ----------------------------------------------------
    out: dict = {
        "stage": "C",
        "question": "Does portfolio construction beat equal weight, out of sample?",
        "basket": f"top {BASKET_SIZE} by RocketScore",
        "n_dates": len(dates),
        "fixture": "wide" if wide else "stage_b",
        "bootstrap_B": b,
        "horizons": {},
        "lookahead_premium": {},
        "lambda_sweep": {},
        "per_date": per_date,
    }

    for h in horizons:
        block = {}
        for name in list(SCHEMES) + ["spy"]:
            tr = {d: per_date[d]["forward"][h][name]["total_return"]
                  for d in dates
                  if per_date[d]["forward"][h][name]["total_return"] is not None}
            block[name] = S.ci(tr, plan)
        # paired: optimizer minus equal weight, same dates, same basket
        block["optimizer_minus_equal"] = S.paired_delta(
            {d: per_date[d]["forward"][h]["optimizer"]["total_return"] for d in dates},
            {d: per_date[d]["forward"][h]["equal_weight"]["total_return"] for d in dates},
            plan,
        )
        block["optimizer_minus_spy"] = S.paired_delta(
            {d: per_date[d]["forward"][h]["optimizer"]["total_return"] for d in dates},
            {d: per_date[d]["forward"][h]["spy"]["total_return"] for d in dates},
            plan,
        )
        out["horizons"][h] = block

    # look-ahead premium: in-sample Sharpe minus honest forward Sharpe
    for name in SCHEMES:
        ins = {d: per_date[d]["in_sample"][name]["sharpe"] for d in dates
               if per_date[d]["in_sample"][name]["sharpe"] is not None}
        fwd = {d: per_date[d]["forward"]["3M"][name]["sharpe"] for d in dates
               if per_date[d]["forward"]["3M"][name]["sharpe"] is not None}
        common = sorted(set(ins) & set(fwd))
        out["lookahead_premium"][name] = {
            "in_sample_sharpe": S.ci({d: ins[d] for d in common}, plan),
            "forward_sharpe": S.ci({d: fwd[d] for d in common}, plan),
            "premium": S.paired_delta({d: ins[d] for d in common},
                                      {d: fwd[d] for d in common}, plan),
        }

    for lam in LAMBDA_SWEEP:
        k = str(lam)
        out["lambda_sweep"][k] = {
            "mean_hhi": S.mean([per_date[d]["lambda_sweep"][k]["hhi"] for d in dates]),
            "mean_max_weight": S.mean(
                [per_date[d]["lambda_sweep"][k]["max_weight"] for d in dates]),
            "mean_n_at_cap": S.mean(
                [per_date[d]["lambda_sweep"][k]["n_at_cap"] for d in dates]),
        }

    os.makedirs(C.RESULTS_DIR, exist_ok=True)
    with open(os.path.join(C.RESULTS_DIR, "stage_c.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    return out


def _f(c, pct=True):
    if not c or c.get("point") is None:
        return "n/a"
    def g(v):
        return "n/a" if v is None else (f"{v * 100:+.2f}%" if pct else f"{v:+.2f}")
    return f"{g(c['point'])}  [{g(c['lo'])}, {g(c['hi'])}]"


def main() -> int:
    res = run()
    print("=" * 78)
    print("STAGE C - portfolio construction, evaluated out of sample")
    print("=" * 78)
    print(f"basket: {res['basket']}, {res['n_dates']} as-of dates, "
          f"CIs = cluster bootstrap over dates")
    print()

    for h, block in res["horizons"].items():
        print(f"--- {h} forward total return " + "-" * 44)
        for name in ["optimizer", "equal_weight", "inverse_vol", "score_weighted", "spy"]:
            print(f"  {name:<18}{_f(block[name]):>40}")
        d = block["optimizer_minus_equal"]
        print(f"  {'optimizer - equal':<18}{_f(d):>40}"
              + ("  SEPARATES" if d.get("excludes_zero") else "  inside the noise"))
        d2 = block["optimizer_minus_spy"]
        print(f"  {'optimizer - SPY':<18}{_f(d2):>40}"
              + ("  SEPARATES" if d2.get("excludes_zero") else "  inside the noise"))
        print()

    print("--- look-ahead premium (in-sample Sharpe minus honest forward Sharpe) ---")
    print(f"  {'scheme':<18}{'in-sample':>20}{'forward':>20}{'premium':>20}")
    for name, v in res["lookahead_premium"].items():
        print(f"  {name:<18}"
              f"{_f(v['in_sample_sharpe'], pct=False):>20}"
              f"{_f(v['forward_sharpe'], pct=False):>20}"
              f"{_f(v['premium'], pct=False):>20}")
    print()

    print("--- lambda sweep: is the risk term doing anything? ---")
    print(f"  {'lambda':>8}{'mean HHI':>12}{'max weight':>14}{'names at 12% cap':>20}")
    for lam, v in res["lambda_sweep"].items():
        print(f"  {lam:>8}{v['mean_hhi']:>12.4f}{v['mean_max_weight']:>14.4f}"
              f"{v['mean_n_at_cap']:>20.1f}")
    print()
    print(f"Wrote {os.path.join(C.RESULTS_DIR, 'stage_c.json')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
