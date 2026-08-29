"""
The six arms under comparison.

Every arm receives the same context object and returns the same result shape,
so metrics.py never needs to know which arm produced a row.

Scoring convention
------------------
Each arm emits a single ordinal `score` used for rank correlation and top-N
selection. For verdict-emitting arms it is lexicographic (verdict, confidence):

    ENTER/BUY  ->  200 + confidence
    HOLD       ->  100 + confidence
    EXIT/SELL  ->    0 + confidence

Disjoint bands, so verdict dominates and confidence orders within it - exactly
how production ranks, since apply_position_limits sorts by
(-confidence, -rocket_score) inside a verdict class.

Only the ORDER matters; Spearman is scale-invariant, so the deterministic arms
can emit their own natural scale (rocket_score, or a uniform draw) without
rescaling. `prob_beat_spy_1m` is carried separately for the Brier score.
"""
from __future__ import annotations

import random
import time
from concurrent.futures import ThreadPoolExecutor

from evals import config as C
from evals import context as ctx
from evals import llm
from evals import prompts as P

AGENT_ORDER = ["bull", "bear", "regime", "value"]


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _norm_verdict(raw) -> str:
    v = str(raw or "HOLD").strip().upper()
    if v in ("ENTER", "BUY"):
        return "BUY"
    if v in ("EXIT", "SELL", "WAIT"):
        return "SELL"
    return "HOLD"


def _clamp(x, lo, hi):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    if x != x:  # NaN
        return None
    return max(lo, min(hi, x))


def _to_score(verdict: str, confidence) -> float:
    """
    Lexicographic (verdict, confidence), flattened to one number.

    This mirrors production exactly: apply_position_limits sorts by
    (-confidence, -rocket_score) within a verdict class, and the BUY set is
    ranked by confidence.

    The earlier convention mapped every HOLD to a flat 50, discarding the
    confidence attached to it. That is a real information loss, not a cosmetic
    one: in the pilot the de-biased judge returned HOLD on 41 of 48 pairs, so 41
    scores collapsed onto an identical value and the arm was measured as having
    no ranking information when its confidences in fact varied. Production would
    have ranked those 41 by confidence, because the forced-buy floor promotes
    HOLDs in exactly that order.

    Bands are disjoint, so verdict dominates and confidence orders within it.
    """
    c = _clamp(confidence, 0, 100)
    if c is None:
        c = 50.0
    base = {"BUY": 200.0, "HOLD": 100.0}.get(verdict, 0.0)
    return base + c


def _prob(parsed: dict):
    """The eval-only calibrated probability, if the model returned one."""
    p = _clamp(parsed.get("prob_beat_spy_1m"), 0, 100)
    return None if p is None else p / 100.0


def _agg(records: list[dict], critical_path_s: float) -> dict:
    return {
        "n_calls": len(records),
        "cost_usd": round(sum(r.get("cost_usd", 0.0) for r in records), 8),
        "incremental_cost_usd": round(
            sum(r.get("incremental_cost_usd", r.get("cost_usd", 0.0)) for r in records), 8
        ),
        "latency_critical_path_s": round(critical_path_s, 3),
        "latency_total_compute_s": round(sum(r.get("latency_s", 0.0) for r in records), 3),
        "prompt_tokens": sum(r.get("usage", {}).get("prompt_tokens", 0) for r in records),
        "completion_tokens": sum(r.get("usage", {}).get("completion_tokens", 0) for r in records),
        "fallbacks": sum(1 for r in records if r.get("fallback")),
        "cached_calls": sum(1 for r in records if r.get("cached")),
    }


def _result(arm, ticker, as_of, seed, verdict, confidence, prob, records,
            critical_path_s, provenance, detail):
    return {
        "arm": arm,
        "ticker": ticker,
        "as_of_date": as_of,
        "seed": seed,
        "verdict": verdict,
        "confidence": confidence,
        "prob_beat_spy_1m": prob,
        "score": _to_score(verdict, confidence),
        "provenance": provenance,
        "detail": detail,
        **_agg(records, critical_path_s),
    }


def _run_agents(names, context, seed):
    """Fan out the analyst agents the way production's asyncio.gather does."""
    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=len(names)) as ex:
        futs = {
            n: ex.submit(
                llm.call,
                P.AGENT_PROMPTS[n],
                context,
                agent_type=n,
                seed=seed,
            )
            for n in names
        }
        recs = {n: f.result() for n, f in futs.items()}
    wall = time.perf_counter() - t0
    # On a fully cached rerun the real fan-out cost is the recorded max, not the
    # near-zero wall clock of reading files.
    fan_out = max([r.get("latency_s", 0.0) for r in recs.values()] + [0.0])
    return recs, max(fan_out, 0.0), wall


def _judge_context(agent_recs: dict, names, context: str = "") -> str:
    """
    Mirror of backend/main.py's judge input: the underlying data, then each memo
    truncated to production's limits.

    Production used to pass memos ONLY -- the code comment read "no metrics, no
    news" -- so the final decision maker refereed prose it had no way to check
    against the numbers. `context` is now prepended to match.
    """
    import json

    limits = {"bull": 2000, "bear": 2000, "regime": 1500, "value": 2000}
    parts = []
    for n in names:
        blob = json.dumps(agent_recs[n]["parsed"], indent=2)[: limits.get(n, 2000)]
        parts.append(n.capitalize() + " Agent Output:\n" + blob)
    memos = "\n\n".join(parts)
    return (context + "\n\n" + memos) if context else memos


# ---------------------------------------------------------------------------
# arms
# ---------------------------------------------------------------------------

def _debate(arm, ticker, as_of, rank, total, seed, names, include_news):
    context, provenance = ctx.build(ticker, as_of, rank, total, include_news=include_news)

    agent_recs, fan_out_s, _ = _run_agents(names, context, seed)

    judge_rec = llm.call(
        P.JUDGE + P.BRIER_EXTENSION,
        _judge_context(agent_recs, names, context),
        agent_type="judge",
        seed=seed,
    )

    records = list(agent_recs.values()) + [judge_rec]
    parsed = judge_rec["parsed"]
    verdict = _norm_verdict(parsed.get("verdict"))
    confidence = _clamp(parsed.get("confidence"), 0, 100)

    detail = {
        "agents": {n: agent_recs[n]["parsed"] for n in names},
        "judge": parsed,
        "judge_saw": "context + agent memos (matches production)",
    }
    return _result(arm, ticker, as_of, seed, verdict, confidence, _prob(parsed),
                   records, fan_out_s + judge_rec.get("latency_s", 0.0),
                   provenance, detail)


def full_debate(ticker, as_of, rank, total, seed):
    """Production: bull + bear + regime + value in parallel, then judge."""
    return _debate("full_debate", ticker, as_of, rank, total, seed,
                   AGENT_ORDER, include_news=True)


def debate_no_bear(ticker, as_of, rank, total, seed):
    """Ablation: remove the adversary."""
    return _debate("debate_no_bear", ticker, as_of, rank, total, seed,
                   ["bull", "regime", "value"], include_news=True)


def debate_no_news(ticker, as_of, rank, total, seed):
    """Ablation: identical debate, news block replaced by 'no recent news'."""
    return _debate("debate_no_news", ticker, as_of, rank, total, seed,
                   AGENT_ORDER, include_news=False)


def single_call(ticker, as_of, rank, total, seed):
    """One call carrying the same four lenses and the same decision rule."""
    context, provenance = ctx.build(ticker, as_of, rank, total, include_news=True)
    rec = llm.call(P.SINGLE_CALL + P.BRIER_EXTENSION, context,
                   agent_type="single_call", seed=seed)
    parsed = rec["parsed"]
    verdict = _norm_verdict(parsed.get("verdict"))
    return _result("single_call", ticker, as_of, seed, verdict,
                   _clamp(parsed.get("confidence"), 0, 100), _prob(parsed),
                   [rec], rec.get("latency_s", 0.0), provenance,
                   {"single": parsed})


def judge_only(ticker, as_of, rank, total, seed):
    """
    The judge prompt fed the context directly.

    NOTE: this is NOT production's judge. Production's judge sees only the four
    agent memos and never the underlying data (backend/main.py:1573, comment:
    "no metrics, no news"). A judge with no memos and no data would have nothing
    to read, so the honest analogue is the judge prompt over the same context
    every other arm gets. Recorded in results/summary.md.
    """
    context, provenance = ctx.build(ticker, as_of, rank, total, include_news=True)
    rec = llm.call(P.JUDGE + P.BRIER_EXTENSION, context,
                   agent_type="judge_only", seed=seed)
    parsed = rec["parsed"]
    verdict = _norm_verdict(parsed.get("verdict"))
    return _result("judge_only", ticker, as_of, seed, verdict,
                   _clamp(parsed.get("confidence"), 0, 100), _prob(parsed),
                   [rec], rec.get("latency_s", 0.0), provenance,
                   {"judge": parsed, "judge_saw": "context directly (NOT production's judge)"})


def random_arm(ticker, as_of, rank, total, seed):
    """
    The floor. Uniform random score, no LLM, no cost.

    Seeded per (ticker, as_of, seed) so it is reproducible, and drawn
    independently of anything predictive. If a paid arm cannot separate itself
    from this across seeds, it has not demonstrated anything.
    """
    rng = random.Random(ticker + "|" + as_of + "|" + str(seed))
    score = rng.uniform(0, 100)
    verdict = "BUY" if score >= 66 else ("HOLD" if score >= 33 else "SELL")
    _, provenance = ctx.build(ticker, as_of, rank, total, include_news=True)
    return {
        "arm": "random",
        "ticker": ticker,
        "as_of_date": as_of,
        "seed": seed,
        "verdict": verdict,
        "confidence": round(abs(score - 50) * 2, 1),
        "prob_beat_spy_1m": rng.uniform(0, 1),
        "score": score,
        "provenance": provenance,
        "detail": {"note": "uniform random, no LLM call"},
        **_agg([], 0.0),
    }


def rank_by_rocket_score(ticker, as_of, rank, total, seed):
    """
    Rank by the deterministic screen. No LLM, no cost.

    This is THE baseline, for two reasons.

    First, it is the question. The debate is handed the RocketScore and its rank
    inside the context. If it cannot beat "just use the number you were given",
    the four extra calls are decoration whatever their raw correlation looks like.

    Second, it is not hypothetical: while the deepseek-chat alias was dead, every
    agent failed, every verdict fell back to HOLD/confidence-50, and the
    forced-buy floor sorted the resulting tie by rocket_score. Production WAS
    this arm for five weeks.

    Deterministic, so the seed only affects the cache key, never the output.
    """
    _, provenance = ctx.build(ticker, as_of, rank, total, include_news=True)
    score = float(provenance.get("rocket_score") or 0.0)

    # Verdict by within-date rank tercile, so buy_rate and the verdict-based
    # metrics remain meaningful for an arm that emits no verdict of its own.
    if total >= 3:
        third = total / 3.0
        verdict = "BUY" if rank <= third else ("HOLD" if rank <= 2 * third else "SELL")
    else:
        verdict = "HOLD"

    return {
        "arm": "rank_by_rocket_score",
        "ticker": ticker,
        "as_of_date": as_of,
        "seed": seed,
        "verdict": verdict,
        # Not a real confidence. Distance from the middle of the universe,
        # purely so the field is populated; `score` is what ranks.
        "confidence": round(abs((total / 2.0) - rank) / max(1.0, total / 2.0) * 100, 1),
        "prob_beat_spy_1m": None,
        "score": score,
        "provenance": provenance,
        "detail": {"note": "deterministic RocketScore ranking, no LLM call"},
        **_agg([], 0.0),
    }


ARM_FNS = {
    "full_debate": full_debate,
    "single_call": single_call,
    "judge_only": judge_only,
    "debate_no_bear": debate_no_bear,
    "debate_no_news": debate_no_news,
    "rank_by_rocket_score": rank_by_rocket_score,
    "random": random_arm,
}

assert set(ARM_FNS) == set(C.ARMS), "ARM_FNS and config.ARMS disagree"
