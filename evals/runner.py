"""
Run every arm over the frozen eval set, N seeds each, and write results.

    python -m evals.runner                     # everything
    python -m evals.runner --arms random       # one arm
    python -m evals.runner --limit 5           # 5 tickers per date (smoke test)
    python -m evals.runner --seeds 2 --workers 8

Writes results/raw/<arm>__seed<k>.json per run and then results/summary.md.
LLM responses are cached by prompt hash, so a rerun of an unchanged arm costs
nothing and takes seconds.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

from evals import arms as arms_mod
from evals import cache
from evals import config as C
from evals import context as ctx
from evals import metrics as M
from evals import news as news_mod
from evals.asof import neutralise_quality_score
from evals.llm import LLMUnavailable


def load_eval_set(path: str | None = None) -> dict:
    """
    Load a frozen eval set.

    Defaults to the 4-date Stage B fixture. Stages A and C pass
    C.EVAL_SET_WIDE_PATH (12 dates, of which the Stage B four are a strict
    subset) because they cost nothing to run and should not inherit Stage B's
    budget-driven date limit.
    """
    path = path or C.EVAL_SET_PATH
    if not os.path.exists(path):
        raise SystemExit(
            "Missing eval set at " + path + "\nRun: python -m evals.build_fixture"
            + (" --wide" if path == C.EVAL_SET_WIDE_PATH else "")
        )
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def labels_from(fixture: dict) -> dict:
    out = {}
    for p in fixture["pairs"]:
        out[(p["ticker"], p["as_of_date"])] = p
    return out


def have_deepseek_key() -> bool:
    k = os.environ.get("DEEPSEEK_API_KEY", "")
    return bool(k) and len(k) >= 20


def run_arm(arm: str, pairs: list[dict], ranks: dict, seed: int, workers: int,
            progress: bool = True) -> list[dict]:
    """One arm, one seed, all pairs."""
    fn = arms_mod.ARM_FNS[arm]
    total_by_date = defaultdict(int)
    for p in pairs:
        total_by_date[p["as_of_date"]] += 1

    results: list[dict] = []
    errors: list[dict] = []
    t0 = time.perf_counter()

    def one(p):
        as_of = p["as_of_date"]
        return fn(p["ticker"], as_of, ranks[as_of][p["ticker"]],
                  total_by_date[as_of], seed)

    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(one, p): p for p in pairs}
        done = 0
        for fut in as_completed(futs):
            p = futs[fut]
            try:
                results.append(fut.result())
            except LLMUnavailable:
                raise
            except Exception as e:
                errors.append({
                    "ticker": p["ticker"], "as_of_date": p["as_of_date"],
                    "error": type(e).__name__ + ": " + str(e)[:300],
                    "traceback": traceback.format_exc()[-1500:],
                })
            done += 1
            if progress and done % 25 == 0:
                sys.stdout.write("\r    " + arm + " seed " + str(seed) + ": "
                                 + str(done) + "/" + str(len(pairs)))
                sys.stdout.flush()

    if progress:
        sys.stdout.write("\r    " + arm + " seed " + str(seed) + ": "
                         + str(len(results)) + "/" + str(len(pairs))
                         + " ok, " + str(len(errors)) + " errors, "
                         + str(round(time.perf_counter() - t0, 1)) + "s\n")

    os.makedirs(C.RAW_DIR, exist_ok=True)
    path = os.path.join(C.RAW_DIR, arm + "__seed" + str(seed) + ".json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump({
            "arm": arm,
            "seed": seed,
            "n_pairs": len(pairs),
            "n_ok": len(results),
            "n_errors": len(errors),
            "wall_clock_s": round(time.perf_counter() - t0, 2),
            "errors": errors,
            "rows": results,
        }, f, indent=2)

    return results


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="evals.runner")
    ap.add_argument("--arms", nargs="*", default=None,
                    help="subset of arms (default: all)")
    ap.add_argument("--seeds", type=int, default=C.N_SEEDS)
    ap.add_argument("--limit", type=int, default=None,
                    help="cap tickers per as-of date (smoke test)")
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--top-n", type=int, default=5)
    ap.add_argument("--horizons", nargs="*", default=list(C.HORIZONS.keys()))
    ap.add_argument("--no-report", action="store_true")
    ap.add_argument("--budget", type=float, default=None,
                    help="hard USD ceiling; aborts rather than exceeding it")
    args = ap.parse_args(argv)

    note = neutralise_quality_score()

    # Hard spend ceiling before anything can call the API.
    from evals import budget as B
    from evals import llm as _llm
    guard = B.make_guard(args.budget, label="stage_b")
    _llm.set_guard(guard)

    fixture = load_eval_set()
    labels = labels_from(fixture)

    pairs = fixture["pairs"]
    if args.limit:
        capped, seen = [], defaultdict(int)
        for p in sorted(pairs, key=lambda x: (x["as_of_date"], x["ticker"])):
            if seen[p["as_of_date"]] < args.limit:
                capped.append(p)
                seen[p["as_of_date"]] += 1
        pairs = capped

    requested = args.arms or list(C.DEFAULT_ARMS)
    unknown = [a for a in requested if a not in arms_mod.ARM_FNS]
    if unknown:
        raise SystemExit("Unknown arm(s): " + ", ".join(unknown))

    skipped = {}
    if not have_deepseek_key():
        for a in list(requested):
            if a not in C.OFFLINE_ARMS:
                skipped[a] = "DEEPSEEK_API_KEY not set"
        requested = [a for a in requested if a in C.OFFLINE_ARMS]
        print("!! DEEPSEEK_API_KEY is not set. Skipping every LLM arm.")
        print("!! Set it and rerun; cached responses mean you only pay for new calls.\n")

    print("Eval set: " + str(len(pairs)) + " pairs, "
          + str(len(set(p['as_of_date'] for p in pairs))) + " as-of dates, "
          + str(args.seeds) + " seeds")
    print("Arms: " + (", ".join(requested) if requested else "(none runnable)"))
    print()

    # RocketScore ranks are shared across arms and seeds; compute once.
    print("Scoring universe as-of (deterministic, no LLM) ...")
    ranks = {}
    for as_of in sorted(set(p["as_of_date"] for p in pairs)):
        universe = [p["ticker"] for p in pairs if p["as_of_date"] == as_of]
        scored = []
        for t in universe:
            try:
                scored.append((t, ctx.score_as_of(t, as_of)["rocket_score"]))
            except Exception:
                scored.append((t, float("-inf")))
        scored.sort(key=lambda kv: kv[1], reverse=True)
        ranks[as_of] = {t: i + 1 for i, (t, _) in enumerate(scored)}
        print("  " + as_of + ": ranked " + str(len(scored)) + " tickers")
    print()

    all_rows: dict[str, list[dict]] = {}
    per_seed_metrics: dict[str, dict[str, list[dict]]] = {}

    for arm in requested:
        print("Arm: " + arm)
        arm_rows: list[dict] = []
        per_seed_metrics[arm] = {h: [] for h in args.horizons}
        # Deterministic arms need exactly one seed; running more would just
        # duplicate identical rows and overstate the sample.
        n_seeds = min(args.seeds, C.seeds_for(arm))
        for seed in range(1, n_seeds + 1):
            try:
                rows = run_arm(arm, pairs, ranks, seed, args.workers)
            except LLMUnavailable as e:
                print("  ABORT: " + str(e))
                skipped[arm] = str(e).splitlines()[0]
                arm_rows = []
                break
            except B.BudgetExceeded as e:
                print("  BUDGET STOP: " + str(e).splitlines()[0])
                skipped[arm] = "budget ceiling reached"
                break
            arm_rows.extend(rows)
            for h in args.horizons:
                per_seed_metrics[arm][h].append(
                    M.metrics_for_seed(rows, labels, h, top_n=args.top_n)
                )
        if arm_rows:
            all_rows[arm] = arm_rows
        print()

    summary = {
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "config": {
            "model": C.MODEL,
            "temperature": C.TEMPERATURE,
            "max_tokens": C.MAX_TOKENS,
            "seeds": args.seeds,
            "top_n": args.top_n,
            "horizons": args.horizons,
            "as_of_dates": sorted(set(p["as_of_date"] for p in pairs)),
            "n_pairs": len(pairs),
            "n_tickers": len(set(p["ticker"] for p in pairs)),
            "price_pricing_usd_per_mtok": {"in": C.PRICE_IN_PER_MTOK,
                                           "out": C.PRICE_OUT_PER_MTOK},
        },
        "quality_note": note,
        "skipped_arms": skipped,
        "news_audit": news_mod.audit_product_news_path(),
        "news_coverage": news_mod.coverage(),
        "benchmark_forward_returns": fixture.get("benchmark_forward_returns", {}),
        "cache": cache.stats(),
        "budget": guard.snapshot(),
        "arms": {},
        "incremental_information": {},
    }

    for arm, rows in all_rows.items():
        entry = {"cost": M.cost_summary(rows), "horizons": {}}
        for h in args.horizons:
            entry["horizons"][h] = {
                "aggregate": M.aggregate_seeds(per_seed_metrics[arm][h]),
                "per_seed": per_seed_metrics[arm][h],
            }
        summary["arms"][arm] = entry

    # ---- the headline number -------------------------------------------
    # Does an arm know anything the RocketScore it was handed did not? Within
    # each date, residualise the arm's score on rocket_score and correlate the
    # residual with forward excess return. If that interval brackets zero, the
    # arm is re-expressing the screen.
    from evals import stats as S

    dates_used = sorted(set(p["as_of_date"] for p in pairs))
    plan = S.make_plan(dates_used, seed=4242)
    for arm, rows in all_rows.items():
        entry = {}
        for h in args.horizons:
            ii = S.incremental_information(rows, labels, h)
            entry[h] = {
                "total": S.ci(ii["total"], plan),
                "via_screen": S.ci(ii["via_screen"], plan),
                "incremental": S.ci(ii["incremental"], plan),
                "beta_on_rocket_score": S.ci(ii["beta"], plan),
            }
        summary["incremental_information"][arm] = entry

    # ---- paired arm-vs-arm deltas --------------------------------------
    summary["paired_deltas"] = {}
    for h in args.horizons:
        rho = {a: S.rho_by_date(r, labels, h) for a, r in all_rows.items()}
        block = {}
        for a in rho:
            for b in rho:
                if a >= b:
                    continue
                block[a + "_vs_" + b] = S.paired_delta(rho[a], rho[b], plan)
        summary["paired_deltas"][h] = block

    os.makedirs(C.RESULTS_DIR, exist_ok=True)
    with open(os.path.join(C.RESULTS_DIR, "summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)
    print("Wrote " + os.path.join(C.RESULTS_DIR, "summary.json"))

    if not args.no_report:
        from evals.report import write_report
        write_report(summary)
        print("Wrote " + C.SUMMARY_PATH)

    return 0


if __name__ == "__main__":
    sys.exit(main())
