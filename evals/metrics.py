"""
Metrics.

Everything is computed WITHIN an as-of date and then averaged across dates.
Pooling all 200 pairs into one correlation would let market direction dominate:
on a date when SPY ran +13%, almost everything has a positive raw return, and
an arm that simply says BUY a lot would look prescient. Excess-of-SPY labels
remove the level; per-date computation removes the rest.

No scipy dependency -- Spearman is Pearson on average-tied ranks.
"""
from __future__ import annotations

import math
from collections import defaultdict


# ---------------------------------------------------------------------------
# primitives
# ---------------------------------------------------------------------------

def _avg_ranks(xs: list[float]) -> list[float]:
    """Average ranks, ties shared."""
    order = sorted(range(len(xs)), key=lambda i: xs[i])
    ranks = [0.0] * len(xs)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and xs[order[j + 1]] == xs[order[i]]:
            j += 1
        shared = (i + j) / 2.0 + 1.0
        for k in range(i, j + 1):
            ranks[order[k]] = shared
        i = j + 1
    return ranks


def pearson(xs: list[float], ys: list[float]):
    n = len(xs)
    if n < 3:
        return None
    mx, my = sum(xs) / n, sum(ys) / n
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    dx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    dy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if dx == 0 or dy == 0:
        return None          # a constant arm has no rank information
    return num / (dx * dy)


def spearman(xs: list[float], ys: list[float]):
    if len(xs) < 3:
        return None
    return pearson(_avg_ranks(xs), _avg_ranks(ys))


def mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else None


def stdev(xs):
    xs = [x for x in xs if x is not None]
    if len(xs) < 2:
        return 0.0
    m = sum(xs) / len(xs)
    return math.sqrt(sum((x - m) ** 2 for x in xs) / (len(xs) - 1))


# ---------------------------------------------------------------------------
# per-seed metrics
# ---------------------------------------------------------------------------

def metrics_for_seed(rows: list[dict], labels: dict, horizon: str, top_n: int = 5) -> dict:
    """
    rows: one arm, one seed, all (ticker, as_of) pairs.
    labels: {(ticker, as_of): {"fwd_excess_1M": .., "fwd_ret_1M": .., ...}}

    Returns per-date-averaged metrics for one horizon.
    """
    by_date = defaultdict(list)
    for r in rows:
        by_date[r["as_of_date"]].append(r)

    excess_key = "fwd_excess_" + horizon

    rhos, hits, decile_excess, briers, buy_rates, score_sd = [], [], [], [], [], []
    n_scored = 0

    for as_of, drows in sorted(by_date.items()):
        pairs = []
        for r in drows:
            lab = labels.get((r["ticker"], as_of))
            if lab is None or lab.get(excess_key) is None:
                continue
            pairs.append((r, lab[excess_key]))
        if len(pairs) < 3:
            continue
        n_scored += len(pairs)

        scores = [p[0]["score"] for p in pairs]
        exc = [p[1] for p in pairs]

        rho = spearman(scores, exc)
        if rho is not None:
            rhos.append(rho)

        score_sd.append(stdev(scores))
        buy_rates.append(sum(1 for p in pairs if p[0]["verdict"] == "BUY") / len(pairs))

        # Top-N hit rate: of the N highest-scored names, how many beat SPY.
        # Ties are broken deterministically by ticker so the metric is stable.
        ranked = sorted(pairs, key=lambda p: (-p[0]["score"], p[0]["ticker"]))
        top = ranked[: min(top_n, len(ranked))]
        hits.append(sum(1 for p in top if p[1] > 0) / len(top))

        # Top decile mean excess return.
        k = max(1, round(len(ranked) * 0.10))
        decile_excess.append(sum(p[1] for p in ranked[:k]) / k)

        # Brier, only over rows that actually returned a probability.
        bp = [(p[0]["prob_beat_spy_1m"], 1.0 if p[1] > 0 else 0.0)
              for p in pairs if p[0].get("prob_beat_spy_1m") is not None]
        if bp:
            briers.append(sum((pr - o) ** 2 for pr, o in bp) / len(bp))

    return {
        "spearman": mean(rhos),
        "hit_rate_top_n": mean(hits),
        "top_decile_excess": mean(decile_excess),
        "brier": mean(briers) if briers else None,
        "brier_coverage": len(briers) / max(1, len(by_date)),
        "buy_rate": mean(buy_rates),
        "score_dispersion": mean(score_sd),
        "n_pairs_scored": n_scored,
        "n_dates": len(by_date),
    }


# ---------------------------------------------------------------------------
# across-seed aggregation
# ---------------------------------------------------------------------------

METRIC_KEYS = ["spearman", "hit_rate_top_n", "top_decile_excess", "brier",
               "buy_rate", "score_dispersion"]


def aggregate_seeds(per_seed: list[dict]) -> dict:
    """mean / sd / min / max across seeds, plus operational totals."""
    out = {}
    for k in METRIC_KEYS:
        vals = [s[k] for s in per_seed if s.get(k) is not None]
        out[k] = {
            "mean": mean(vals),
            "sd": stdev(vals) if len(vals) > 1 else 0.0,
            "min": min(vals) if vals else None,
            "max": max(vals) if vals else None,
            "n_seeds": len(vals),
        }
    return out


def separated(a: dict, b: dict, key: str) -> bool:
    """
    True only if the two arms' seed RANGES do not overlap on `key`.

    Deliberately strict: with 5 seeds there is no honest parametric test, so the
    bar is "the worst run of the better arm still beats the best run of the
    worse arm". Anything less is reported as inside the noise.
    """
    A, B = a.get(key, {}), b.get(key, {})
    if A.get("min") is None or B.get("min") is None:
        return False
    return A["min"] > B["max"] or B["min"] > A["max"]


def cost_summary(rows: list[dict]) -> dict:
    """Totals over every row of one arm (all seeds)."""
    n = max(1, len(rows))
    return {
        "total_cost_usd": sum(r.get("cost_usd", 0.0) for r in rows),
        "incremental_cost_usd": sum(r.get("incremental_cost_usd", 0.0) for r in rows),
        "cost_per_decision_usd": sum(r.get("cost_usd", 0.0) for r in rows) / n,
        "llm_calls": sum(r.get("n_calls", 0) for r in rows),
        "calls_per_decision": sum(r.get("n_calls", 0) for r in rows) / n,
        "mean_latency_s": mean([r.get("latency_critical_path_s") for r in rows]) or 0.0,
        "prompt_tokens": sum(r.get("prompt_tokens", 0) for r in rows),
        "completion_tokens": sum(r.get("completion_tokens", 0) for r in rows),
        "fallbacks": sum(r.get("fallbacks", 0) for r in rows),
        "cached_calls": sum(r.get("cached_calls", 0) for r in rows),
        "n_decisions": len(rows),
    }
