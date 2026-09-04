"""
Stage A2: does a properly specified factor model rank forward returns?

This is the gate. If a conventional, sector-neutral, walk-forward-fitted factor
model on a real universe cannot rank forward returns, then no amount of agent
design rescues the product, and building an LLM layer on top of it is expensive
elaborate nothing.

Zero LLM cost.

What it fixes relative to Stage A:
  - sample:  600 pairs -> ~20,000
  - scoring: hand-set absolute thresholds -> sector-neutral z-scores
  - weights: hardcoded 45/25/20/10 -> walk-forward ridge on ranks
  - leakage: naive splits -> purged, so overlapping 3-month labels cannot leak

    python -m evals.stages.model
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
import pandas as pd

from evals import config as C
from evals import factors as F
from evals import stats as S
from evals.build_wide import LABELS_PATH, PANEL_PATH, UNIVERSE_PATH

SECTOR_PATH = os.path.join(C.FIXTURE_DIR, "sectors_wide.json")
COST_BPS = [0, 5, 10, 25]


def load_sectors() -> pd.Series:
    if os.path.exists(SECTOR_PATH):
        with open(SECTOR_PATH, encoding="utf-8") as f:
            return pd.Series(json.load(f))
    return pd.Series(dtype=object)


def build_factor_panel(sector_neutral: bool = True) -> pd.DataFrame:
    """One row per (ticker, as-of date) with standardised factors and labels."""
    labels = pd.read_parquet(LABELS_PATH)
    panel = pd.read_parquet(PANEL_PATH)
    with open(UNIVERSE_PATH, encoding="utf-8") as f:
        meta = json.load(f)

    adj = pd.DataFrame({c.split("|", 1)[1]: panel[c]
                        for c in panel.columns if c.startswith("Adj Close|")}).sort_index()
    close = pd.DataFrame({c.split("|", 1)[1]: panel[c]
                          for c in panel.columns if c.startswith("Close|")}).sort_index()
    vol = pd.DataFrame({c.split("|", 1)[1]: panel[c]
                        for c in panel.columns if c.startswith("Volume|")}).sort_index()

    sectors = load_sectors()
    out = []
    for as_of, grp in labels.groupby("as_of_date"):
        ts = pd.Timestamp(as_of)
        pos = adj.index.searchsorted(ts, side="right") - 1
        if pos < 252:
            continue
        tick = [t for t in grp["ticker"].tolist() if t in adj.columns]
        raw = F.compute_factors(adj, close, vol, pos, tick)
        z = F.standardise(raw, sectors if len(sectors) else None,
                          sector_neutral=sector_neutral and len(sectors) > 0)
        z["ticker"] = z.index
        z["as_of_date"] = as_of
        merged = z.merge(grp, on=["ticker", "as_of_date"], how="inner")
        out.append(merged)

    return pd.concat(out, ignore_index=True) if out else pd.DataFrame()


def turnover(scored: pd.DataFrame, top_n: int = 30) -> float:
    """Mean fraction of the top-N basket replaced between consecutive dates."""
    dates = sorted(scored["as_of_date"].unique())
    prev, tos = None, []
    for d in dates:
        g = scored[scored["as_of_date"] == d].nlargest(top_n, "score")
        cur = set(g["ticker"])
        if prev is not None and prev:
            tos.append(len(cur - prev) / max(1, len(cur)))
        prev = cur
    return float(np.mean(tos)) if tos else 0.0


def decile_spread(scored: pd.DataFrame) -> dict[str, float]:
    """Top-decile minus bottom-decile mean label, per date."""
    per = {}
    for d, g in scored.groupby("as_of_date"):
        if len(g) < 20:
            continue
        k = max(1, len(g) // 10)
        top = g.nlargest(k, "score")["label"].mean()
        bot = g.nsmallest(k, "score")["label"].mean()
        per[d] = float(top - bot)
    return per


def ic_by_date(scored: pd.DataFrame) -> dict[str, float]:
    per = {}
    for d, g in scored.groupby("as_of_date"):
        ic = F.rank_ic(pd.Series(g["score"].to_numpy()), pd.Series(g["label"].to_numpy()))
        if ic is not None:
            per[d] = ic
    return per


def run(horizon: str = "3M", sector_neutral: bool = True) -> dict:
    label_col = f"fwd_excess_{horizon}"
    horizon_days = C.HORIZONS[horizon]

    panel = build_factor_panel(sector_neutral=sector_neutral)
    if panel.empty:
        raise SystemExit("empty factor panel - run: python -m evals.build_wide")

    factor_cols = [c for c in F.FACTORS if c in panel.columns]
    dates = sorted(panel["as_of_date"].unique())
    plan = S.make_plan(dates, b=2000, seed=99)

    out: dict = {
        "stage": "A2",
        "question": "Does a properly specified factor model rank forward returns?",
        "horizon": horizon,
        "sector_neutral": bool(sector_neutral and os.path.exists(SECTOR_PATH)),
        "n_pairs": int(len(panel)),
        "n_dates": len(dates),
        "n_tickers": int(panel["ticker"].nunique()),
        "factors": {k: F.FACTORS[k] for k in factor_cols},
        "arms": {},
    }

    # --- individual factors, exploratory --------------------------------
    for fc in factor_cols:
        sub = panel[["as_of_date", "ticker", fc, label_col]].rename(
            columns={fc: "score", label_col: "label"})
        per = ic_by_date(sub)
        out["arms"][f"factor:{fc}"] = {
            "ic": S.ci(per, plan),
            "kind": "single factor (exploratory)",
        }

    # --- equal-weight composite: no fitting, so nothing to overfit ------
    ew = panel.copy()
    ew["score"] = ew[factor_cols].mean(axis=1)
    ew_scored = ew[["as_of_date", "ticker", "score", label_col]].rename(
        columns={label_col: "label"})
    out["arms"]["equal_weight_composite"] = {
        "ic": S.ci(ic_by_date(ew_scored), plan),
        "decile_spread": S.ci(decile_spread(ew_scored), plan),
        "turnover": turnover(ew_scored),
        "kind": "unfitted composite",
    }

    # --- fitted, purged walk-forward ------------------------------------
    wf = F.purged_walk_forward(
        panel.rename(columns={label_col: "_label"}).assign(**{label_col: panel[label_col]}),
        factor_cols, label_col, horizon_days)
    if not wf.empty:
        wf_plan = S.make_plan(sorted(wf["as_of_date"].unique()), b=2000, seed=99)
        per_ic = ic_by_date(wf)
        spread = decile_spread(wf)
        to = turnover(wf)
        out["arms"]["fitted_walk_forward"] = {
            "ic": S.ci(per_ic, wf_plan),
            "decile_spread": S.ci(spread, wf_plan),
            "turnover": to,
            "n_test_dates": int(wf["as_of_date"].nunique()),
            "purged_dates": int(wf["purged_dates"].iloc[0]),
            "kind": "fitted, purged walk-forward (out of sample)",
            "cost_drag": {
                str(b): {
                    "gross": S.mean(list(spread.values())),
                    "net": (S.mean(list(spread.values())) or 0) - 2 * to * (b / 10000.0),
                }
                for b in COST_BPS
            },
        }

    # --- random floor ----------------------------------------------------
    rng = np.random.default_rng(0)
    rnd = panel[["as_of_date", "ticker", label_col]].rename(columns={label_col: "label"}).copy()
    rnd["score"] = rng.normal(size=len(rnd))
    out["arms"]["random"] = {"ic": S.ci(ic_by_date(rnd), plan), "kind": "floor"}

    os.makedirs(C.RESULTS_DIR, exist_ok=True)
    with open(os.path.join(C.RESULTS_DIR, "stage_a2.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, default=float)
    return out


def _f(c) -> str:
    if not c or c.get("point") is None:
        return "n/a"
    star = " *" if (c["lo"] is not None and (c["lo"] > 0 or c["hi"] < 0)) else "  "
    return f"{c['point']:+.4f} [{c['lo']:+.4f},{c['hi']:+.4f}]{star}"


def main() -> int:
    horizon = sys.argv[1] if len(sys.argv) > 1 else "3M"
    res = run(horizon)

    print("=" * 78)
    print("STAGE A2 - does a properly specified factor model rank forward returns?")
    print("=" * 78)
    print(f"{res['n_pairs']:,} pairs | {res['n_dates']} dates | "
          f"{res['n_tickers']} tickers | {res['horizon']} horizon")
    print(f"sector-neutral: {res['sector_neutral']}")
    print()
    print(f"{'arm':<34}{'rank IC (95% CI)':>30}  kind")
    print("-" * 78)
    for name, v in res["arms"].items():
        print(f"{name:<34}{_f(v['ic']):>30}  {v['kind']}")
    print("\n* = interval excludes zero")

    wf = res["arms"].get("fitted_walk_forward")
    if wf:
        print(f"\nFitted model, out of sample ({wf['n_test_dates']} test dates, "
              f"{wf['purged_dates']} purged):")
        print(f"  top-decile minus bottom-decile: {_f(wf['decile_spread'])}")
        print(f"  turnover per rebalance:         {wf['turnover']:.1%}")
        print("  net of costs:")
        for b, d in wf["cost_drag"].items():
            print(f"    {b:>3}bp: gross {d['gross']:+.4f}  net {d['net']:+.4f}")
    print(f"\nWrote {os.path.join(C.RESULTS_DIR, 'stage_a2.json')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
