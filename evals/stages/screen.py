"""
Stage A: does the deterministic RocketScore screen rank forward returns?

Zero LLM cost. Everything here is computation over the frozen fixture, so it
can be re-run for free as often as the scoring code changes.

This runs BEFORE any paid stage on purpose. If the screen carries no signal,
that reframes every later result: the debate would be building on sand, and the
`rank_by_rocket_score` baseline it has to beat is a low bar for a bad reason.

    python -m evals.stages.screen
"""
from __future__ import annotations

import json
import os
from collections import defaultdict

from evals import config as C
from evals import stats as S
from evals.asof import neutralise_quality_score, score_as_of
from evals.runner import labels_from, load_eval_set

# The screen's four components, with the weights compute_rocket_score locks in.
COMPONENTS = {
    "technical_score": 0.45,
    "volume_score": 0.25,
    "quality_score": 0.20,
    "macro_score": 0.10,
}


def build_rows(pairs: list[dict]) -> list[dict]:
    """Score every (ticker, as-of) pair with the product's own scorer."""
    rows = []
    for p in pairs:
        r = score_as_of(p["ticker"], p["as_of_date"])
        r["as_of_date"] = p["as_of_date"]
        rows.append(r)
    return rows


def decile_table(rows: list[dict], labels: dict, horizon: str,
                 score_key: str = "rocket_score", n_buckets: int = 5) -> list[dict]:
    """
    Mean forward excess by within-date score bucket.

    Monotonicity here is the plain-language version of the rank correlation: if
    the screen works, higher buckets should earn more.
    """
    key = "fwd_excess_" + horizon
    by_date: dict[str, list] = defaultdict(list)
    for r in rows:
        lab = labels.get((r["ticker"], r["as_of_date"]))
        if lab is None or lab.get(key) is None:
            continue
        by_date[r["as_of_date"]].append((r[score_key], lab[key]))

    buckets: dict[int, list[float]] = defaultdict(list)
    for _d, trip in by_date.items():
        ranked = sorted(trip, key=lambda t: t[0])
        n = len(ranked)
        for i, (_score, exc) in enumerate(ranked):
            b = min(n_buckets - 1, int(i * n_buckets / n))
            buckets[b].append(exc)

    return [
        {
            "bucket": b + 1,
            "label": f"{b + 1} of {n_buckets}" + (" (lowest)" if b == 0 else
                                                  " (highest)" if b == n_buckets - 1 else ""),
            "n": len(buckets[b]),
            "mean_excess": (sum(buckets[b]) / len(buckets[b])) if buckets[b] else None,
        }
        for b in range(n_buckets)
    ]


def run(horizons: list[str] | None = None, b: int = S.DEFAULT_B) -> dict:
    note = neutralise_quality_score()
    horizons = horizons or list(C.HORIZONS.keys())

    # Stage A costs nothing, so it runs on the wide 12-date grid rather than
    # Stage B's budget-limited 4. With 4 dates a date-cluster bootstrap has only
    # 35 distinct multisets, which is not enough to separate "no signal" from
    # "not enough data". Falls back if the wide fixture has not been built.
    wide = os.path.exists(C.EVAL_SET_WIDE_PATH)
    fixture = load_eval_set(C.EVAL_SET_WIDE_PATH if wide else None)
    labels = labels_from(fixture)
    pairs = fixture["pairs"]
    dates = sorted({p["as_of_date"] for p in pairs})
    plan = S.make_plan(dates, b=b)

    rows = build_rows(pairs)
    rows_by_date: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        rows_by_date[r["as_of_date"]].append(r)

    out: dict = {
        "stage": "A",
        "question": "Does the deterministic RocketScore screen rank forward excess returns?",
        "n_pairs": len(rows),
        "n_dates": len(dates),
        "as_of_dates": dates,
        "bootstrap_B": b,
        "fixture": "wide" if wide else "stage_b",
        "quality_note": note,
        "horizons": {},
    }

    # ---- effective vs advertised weights -------------------------------
    out["variance_share"] = S.variance_share(rows_by_date, list(COMPONENTS), COMPONENTS)

    for h in horizons:
        entry: dict = {}

        # ---- the screen itself, and each component alone ----------------
        scored = {}
        for key in ["rocket_score", "weighted_score_before_tags", *COMPONENTS]:
            per_date = S.rho_by_date(rows, labels, h, score_key=key)
            scored[key] = S.ci(per_date, plan)
        entry["spearman"] = scored

        # ---- top decile ------------------------------------------------
        entry["top_decile_excess"] = S.ci(
            S.top_decile_by_date(rows, labels, h, score_key="rocket_score"), plan
        )

        # ---- tag bonus ablation ----------------------------------------
        entry["tag_bonus_delta"] = S.paired_delta(
            S.rho_by_date(rows, labels, h, score_key="rocket_score"),
            S.rho_by_date(rows, labels, h, score_key="weighted_score_before_tags"),
            plan,
        )

        # ---- buckets ---------------------------------------------------
        entry["buckets"] = decile_table(rows, labels, h)

        out["horizons"][h] = entry

    os.makedirs(C.RESULTS_DIR, exist_ok=True)
    with open(os.path.join(C.RESULTS_DIR, "stage_a.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    return out


def _fmt(c: dict, pct: bool = False) -> str:
    if c is None or c.get("point") is None:
        return "n/a"
    def f(v):
        return "n/a" if v is None else (f"{v * 100:+.2f}%" if pct else f"{v:+.3f}")
    if c.get("lo") is None:
        return f(c["point"])
    return f"{f(c['point'])}  [{f(c['lo'])}, {f(c['hi'])}]"


def main() -> int:
    res = run()

    print("=" * 74)
    print("STAGE A - does the deterministic screen rank forward returns?")
    print("=" * 74)
    print(f"{res['n_pairs']} pairs over {res['n_dates']} as-of dates "
          f"({', '.join(res['as_of_dates'])})")
    print(f"CIs: 95% cluster bootstrap resampling as-of dates, B={res['bootstrap_B']}")
    print()

    print("Advertised weights vs how much each component actually moves the ranking")
    print("-" * 74)
    print(f"{'component':<20}{'advertised':>12}{'effective':>12}{'weighted sd':>14}")
    for comp, v in res["variance_share"].items():
        if not v:
            continue
        print(f"{comp:<20}{v['advertised_weight']:>11.0%}{v['share']:>12.1%}"
              f"{v['weighted_sd']:>14.2f}")
    print()

    for h, e in res["horizons"].items():
        print(f"--- {h} horizon, excess of SPY " + "-" * 40)
        print(f"{'score':<32}{'Spearman rho (95% CI)':>40}")
        for key, c in e["spearman"].items():
            print(f"{key:<32}{_fmt(c):>40}")
        print()
        print(f"{'top-decile mean excess':<32}{_fmt(e['top_decile_excess'], pct=True):>40}")
        td = e["tag_bonus_delta"]
        print(f"{'tag bonus effect on rho':<32}{_fmt(td):>40}"
              + ("  SEPARATES" if td.get("excludes_zero") else "  inside the noise"))
        print()
        print("  mean forward excess by score bucket (within date):")
        for b in e["buckets"]:
            me = "n/a" if b["mean_excess"] is None else f"{b['mean_excess'] * 100:+.2f}%"
            print(f"    bucket {b['label']:<16} n={b['n']:<5} {me:>9}")
        print()
        print("  per-date rho (raw - with 4 dates these matter more than any interval):")
        for d, v in e["spearman"]["rocket_score"]["per_date"].items():
            print(f"    {d}  {v:+.3f}")
        print()

    print(f"Wrote {os.path.join(C.RESULTS_DIR, 'stage_a.json')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
