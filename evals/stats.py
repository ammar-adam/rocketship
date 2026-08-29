"""
Statistics shared by all three eval stages.

Deliberately small. Everything here earns its place by changing the answer to
"does the debate add value"; anything that would only make the write-up look
more academic is left out (see evals/README.md, Future work).

Three ideas:

1. **Cluster bootstrap by as-of date.** Metrics are computed within a date and
   then averaged, so the resampling unit is the date. Returns inside one date
   are cross-correlated through the market and through sectors; resampling
   individual tickers as if they were independent would understate uncertainty.

2. **Paired resampling.** Every arm scores the SAME (ticker, as-of) pairs, so a
   single resample index is drawn per replicate and applied to every arm. The
   interval on the DIFFERENCE is then far narrower than differencing two
   independent level intervals, and the difference is what answers the question.

3. **Incremental information.** Within each date, residualise an arm's score on
   rocket_score and correlate the residual with forward excess return. If that
   is zero, the arm is re-expressing the screen it was handed.
"""
from __future__ import annotations

import math
import random
from collections import defaultdict

from evals.metrics import _avg_ranks, mean, pearson, spearman

# With 4 as-of dates there are only 35 distinct date multisets, so a date-level
# bootstrap is coarse by construction. That is a fact about the data, not a bug:
# the report prints the raw per-date values alongside every interval.
DEFAULT_B = 2000


# ---------------------------------------------------------------------------
# resampling
# ---------------------------------------------------------------------------

def make_plan(dates: list[str], b: int = DEFAULT_B, seed: int = 12345) -> list[list[str]]:
    """
    b draws of len(dates) dates, sampled with replacement.

    Generated once and shared by every arm and every metric in a run, so all
    comparisons are paired and the whole analysis is reproducible from `seed`.
    """
    rng = random.Random(seed)
    n = len(dates)
    return [[dates[rng.randrange(n)] for _ in range(n)] for _ in range(b)]


def _agg(per_date: dict[str, float], draw: list[str]) -> float | None:
    vals = [per_date[d] for d in draw if per_date.get(d) is not None]
    return sum(vals) / len(vals) if vals else None


def ci(per_date: dict[str, float], plan: list[list[str]],
       alpha: float = 0.05) -> dict:
    """Percentile CI for the across-date mean of a per-date statistic."""
    point = mean(list(per_date.values()))
    if point is None:
        return {"point": None, "lo": None, "hi": None, "n_dates": 0, "per_date": per_date}

    reps = [v for v in (_agg(per_date, d) for d in plan) if v is not None]
    if len(reps) < 20:
        return {"point": point, "lo": None, "hi": None,
                "n_dates": len(per_date), "per_date": per_date}
    reps.sort()
    lo = reps[int((alpha / 2) * len(reps))]
    hi = reps[min(len(reps) - 1, int((1 - alpha / 2) * len(reps)))]
    return {"point": point, "lo": lo, "hi": hi,
            "n_dates": len(per_date), "per_date": dict(sorted(per_date.items()))}


def paired_delta(a_per_date: dict[str, float], b_per_date: dict[str, float],
                 plan: list[list[str]], alpha: float = 0.05) -> dict:
    """
    CI for (a - b), resampled with the SAME date draws for both arms.

    Not the difference of two independent intervals: because both arms see the
    same pairs their per-date statistics move together, and pairing removes that
    shared movement. `excludes_zero` is the decision-relevant flag.
    """
    common = sorted(set(a_per_date) & set(b_per_date))
    diff = {d: a_per_date[d] - b_per_date[d] for d in common
            if a_per_date.get(d) is not None and b_per_date.get(d) is not None}
    out = ci(diff, plan, alpha)
    out["excludes_zero"] = (
        out["lo"] is not None and out["hi"] is not None
        and (out["lo"] > 0 or out["hi"] < 0)
    )
    return out


# ---------------------------------------------------------------------------
# per-date statistics
# ---------------------------------------------------------------------------

def rho_by_date(rows: list[dict], labels: dict, horizon: str,
                score_key: str = "score") -> dict[str, float]:
    """Within-date Spearman of an arm's score against forward excess return."""
    key = "fwd_excess_" + horizon
    by_date: dict[str, list] = defaultdict(list)
    for r in rows:
        lab = labels.get((r["ticker"], r["as_of_date"]))
        if lab is None or lab.get(key) is None or r.get(score_key) is None:
            continue
        by_date[r["as_of_date"]].append((r[score_key], lab[key]))

    out = {}
    for d, pairs in by_date.items():
        if len(pairs) < 3:
            continue
        rho = spearman([p[0] for p in pairs], [p[1] for p in pairs])
        if rho is not None:
            out[d] = rho
    return out


def top_decile_by_date(rows: list[dict], labels: dict, horizon: str,
                       score_key: str = "score") -> dict[str, float]:
    """Mean forward excess of the top 10% by score, within each date."""
    key = "fwd_excess_" + horizon
    by_date: dict[str, list] = defaultdict(list)
    for r in rows:
        lab = labels.get((r["ticker"], r["as_of_date"]))
        if lab is None or lab.get(key) is None or r.get(score_key) is None:
            continue
        by_date[r["as_of_date"]].append((r[score_key], lab[key], r["ticker"]))

    out = {}
    for d, trip in by_date.items():
        if len(trip) < 3:
            continue
        ranked = sorted(trip, key=lambda t: (-t[0], t[2]))
        k = max(1, round(len(ranked) * 0.10))
        out[d] = sum(t[1] for t in ranked[:k]) / k
    return out


# ---------------------------------------------------------------------------
# incremental information
# ---------------------------------------------------------------------------

def _rank_z(xs: list[float]) -> list[float]:
    """
    Van der Waerden normal scores: Phi^-1(rank / (n+1)).

    Makes a linear projection meaningful while staying rank-based and robust to
    the outliers that single-name returns are full of.
    """
    n = len(xs)
    ranks = _avg_ranks(xs)
    return [_inv_norm(r / (n + 1)) for r in ranks]


def _inv_norm(p: float) -> float:
    """Acklam's inverse normal CDF. Accurate to ~1e-9; avoids a scipy dependency."""
    if p <= 0.0:
        return -8.0
    if p >= 1.0:
        return 8.0
    a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
         1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00]
    b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
         6.680131188771972e+01, -1.328068155288572e+01]
    c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
         -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00]
    d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
         3.754408661907416e+00]
    plow, phigh = 0.02425, 1 - 0.02425
    if p < plow:
        q = math.sqrt(-2 * math.log(p))
        return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / \
               ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    if p > phigh:
        q = math.sqrt(-2 * math.log(1 - p))
        return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / \
                ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1)
    q = p - 0.5
    r = q * q
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / \
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1)


def incremental_information(rows: list[dict], labels: dict, horizon: str,
                            baseline_key: str = "rocket_score") -> dict:
    """
    Does this arm know anything the RocketScore it was handed did not?

    Within each date, convert the arm score X, the baseline R and the label Y to
    normal scores. Project X on R, take the residual e, and correlate e with Y.

    Returns per-date series for:
      total       corr(X, Y)          the arm's raw ranking power
      via_screen  beta * corr(R, Y)   the part that is a re-expression of R
      incremental corr(e_hat, Y)      the part that is new
      beta        loading of X on R   how much of the arm IS the screen

    If `incremental`'s interval brackets zero, the arm is re-expressing the
    screen. That is the headline sentence of the whole suite.
    """
    key = "fwd_excess_" + horizon
    by_date: dict[str, list] = defaultdict(list)
    for r in rows:
        lab = labels.get((r["ticker"], r["as_of_date"]))
        base = (r.get("provenance") or {}).get(baseline_key, r.get(baseline_key))
        if lab is None or lab.get(key) is None or r.get("score") is None or base is None:
            continue
        by_date[r["as_of_date"]].append((r["score"], base, lab[key]))

    total, via, incr, betas = {}, {}, {}, {}
    for d, trip in by_date.items():
        if len(trip) < 5:
            continue
        X = _rank_z([t[0] for t in trip])
        R = _rank_z([t[1] for t in trip])
        Y = _rank_z([t[2] for t in trip])

        rXY, rRY, rXR = pearson(X, Y), pearson(R, Y), pearson(X, R)
        if rXY is None or rRY is None or rXR is None:
            continue

        # X and R are both standardised normal scores, so the OLS slope of X on
        # R is just their correlation.
        beta = rXR
        resid = [x - beta * r_ for x, r_ in zip(X, R)]
        rEY = pearson(resid, Y)

        # A residual with no variance means the arm is a perfect monotone
        # re-expression of the screen. pearson() returns None there (zero
        # denominator), but the correct answer is not "undefined" -- it is
        # exactly zero new information. Treating it as missing would silently
        # drop the most clear-cut null case from the average.
        if rEY is None:
            rEY = 0.0

        total[d] = rXY
        via[d] = beta * rRY
        incr[d] = rEY * math.sqrt(max(0.0, 1.0 - beta * beta))
        betas[d] = beta

    return {"total": total, "via_screen": via, "incremental": incr, "beta": betas}


# ---------------------------------------------------------------------------
# variance share (Stage A's effective-weight audit)
# ---------------------------------------------------------------------------

def variance_share(rows_by_date: dict[str, list[dict]], components: list[str],
                   weights: dict[str, float]) -> dict:
    """
    How much each weighted component actually moves the ranking, within date.

    A component with no cross-sectional variance contributes nothing to ranking
    no matter what weight it carries. In this harness `quality` is pinned to the
    neutral 50, so its 20% is a constant offset -- the advertised weights and the
    effective ones are not the same thing, and the report shows both.
    """
    tot = {c: 0.0 for c in components}
    n_dates = 0
    for _d, rows in rows_by_date.items():
        if len(rows) < 3:
            continue
        n_dates += 1
        for c in components:
            vals = [float(r.get(c) or 0.0) for r in rows]
            m = sum(vals) / len(vals)
            sd = math.sqrt(sum((v - m) ** 2 for v in vals) / max(1, len(vals) - 1))
            tot[c] += sd * weights.get(c, 0.0)

    if not n_dates:
        return {c: None for c in components}
    avg = {c: tot[c] / n_dates for c in components}
    s = sum(avg.values())
    return {
        c: {"weighted_sd": round(avg[c], 4),
            "share": (round(avg[c] / s, 4) if s > 0 else 0.0),
            "advertised_weight": weights.get(c, 0.0)}
        for c in components
    }
