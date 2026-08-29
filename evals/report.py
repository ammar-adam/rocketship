"""
Render results/summary.md from the summary object the runner builds.

The report is written to be readable by someone who did not run it and is
sceptical of the result. It leads with the caveats, shows the seed spread next
to every number, and refuses to call anything a win unless the seed ranges
separate.
"""
from __future__ import annotations

import os

from evals import config as C
from evals import metrics as M

BASELINE = "single_call"
FLOOR = "random"

ARM_BLURB = {
    "full_debate": "bull + bear + regime + value in parallel, then judge (production)",
    "single_call": "one call, same four lenses and same decision rule, no debate",
    "judge_only": "judge prompt over the context directly (see caveat below)",
    "debate_no_bear": "debate with the bear agent removed",
    "debate_no_news": "production debate, news block suppressed",
    "random": "uniform random score, no LLM (the floor)",
}


def _f(v, nd=3, pct=False, sign=False):
    if v is None:
        return "n/a"
    if pct:
        return ("{:+.2f}%" if sign else "{:.2f}%").format(v * 100)  # noqa: E501
    return ("{:+." + str(nd) + "f}" if sign else "{:." + str(nd) + "f}").format(v)


# Metrics that can meaningfully be negative are shown signed; rates are not.
_SIGNED = {"spearman", "top_decile_excess"}


def _spread(agg, key, pct=False, nd=3):
    a = agg.get(key, {})
    if a.get("mean") is None:
        return "n/a"
    sign = key in _SIGNED
    return (_f(a["mean"], nd, pct, sign=sign) + " ± " + _f(a["sd"], nd, pct)
            + "  [" + _f(a["min"], nd, pct, sign=sign) + ", "
            + _f(a["max"], nd, pct, sign=sign) + "]")


def _verdict_line(summary, horizon):
    """The honest bottom line for one horizon."""
    arms = summary["arms"]
    if "full_debate" not in arms or BASELINE not in arms:
        return ("Cannot answer the question: "
                + ("full_debate" if "full_debate" not in arms else BASELINE)
                + " did not run.")

    d = arms["full_debate"]["horizons"][horizon]["aggregate"]
    s = arms[BASELINE]["horizons"][horizon]["aggregate"]

    lines = []
    for key, label in [("spearman", "rank correlation"),
                       ("hit_rate_top_n", "top-N hit rate"),
                       ("top_decile_excess", "top-decile excess")]:
        dm, sm = d.get(key, {}).get("mean"), s.get(key, {}).get("mean")
        if dm is None or sm is None:
            lines.append("- " + label + ": not computable.")
            continue
        sep = M.separated(d, s, key)
        direction = "higher" if dm > sm else ("lower" if dm < sm else "identical")
        if sep:
            lines.append("- **" + label + "**: debate " + direction
                         + " (" + _f(dm) + " vs " + _f(sm)
                         + "), and the seed ranges do not overlap. This one separates.")
        else:
            lines.append("- " + label + ": debate " + direction
                         + " (" + _f(dm) + " vs " + _f(sm)
                         + "), but the seed ranges overlap. **Inside the noise, not a result.**")
    return "\n".join(lines)


def write_report(summary: dict) -> str:
    cfg = summary["config"]
    arms = summary["arms"]
    horizons = cfg["horizons"]

    L: list[str] = []
    a = L.append

    a("# RocketShip eval: does the debate beat one call?")
    a("")
    a("Generated " + summary["generated_at"] + ".")
    a("")
    a("**The question.** The product runs five LLM agents (bull, bear, regime, value, "
      "then a judge) to decide which stocks to buy. That costs roughly five times what "
      "one call costs. This harness exists to find out whether the extra four calls buy "
      "anything measurable, or whether the claim was decoration.")
    a("")

    # ---- read this first -------------------------------------------------
    a("## Read this before the table")
    a("")
    a("1. **The debate does not produce the score.** RocketScore is deterministic and "
      "computed before any LLM runs (`src/rocket_score.py`, weights locked at technical "
      "45 / volume 25 / quality 20 / macro 10). The debate contributes exactly one number "
      "to ranking: the judge's `confidence`, conditioned on its verdict. That is what is "
      "measured here.")
    a("2. **Production never debates the whole universe.** It screens ~500 tickers by "
      "RocketScore and debates only the top ~30. This eval runs every arm over all "
      + str(cfg["n_tickers"]) + " tickers so the arms are compared on identical pairs. So the "
      "result answers *can the debate rank stocks*, which is a necessary condition for the "
      "product's claim, not the full claim.")
    a("3. **The judge-only arm is not production's judge.** Production's judge sees only "
      "the four agent memos and no data at all (`backend/main.py:1573`, comment: *\"no "
      "metrics, no news\"*). With no memos there would be nothing to read, so this arm is "
      "the judge prompt over the same context every other arm gets.")
    a("4. **The prompts are thumbed toward buying.** The production judge prompt says "
      "\"You MUST issue ENTER verdicts\" and \"Lean toward ENTER\"; the bull prompt says "
      "\"default to ENTER with 65-85 confidence\". Check the buy-rate and score-dispersion "
      "columns: an arm that says BUY to everything has no ranking information, and its "
      "rank correlation will be near zero for that reason rather than for a subtle one.")
    a("5. **A difference inside the seed spread is not a result.** Every number below is "
      "mean ± sd across " + str(cfg["seeds"]) + " seeds with the [min, max] range. This "
      "report only calls something a win when the ranges do not overlap.")
    a("")

    # ---- leaks -----------------------------------------------------------
    a("## Known leaks, including the ones not fixed")
    a("")
    a("**Fixed by the harness.** The product's news fetchers hardcode the window to now, "
      "so replaying a past date through them would hand the agents future headlines. "
      "The audit finds these call sites:")
    a("")
    if summary.get("news_audit"):
        a("| File | Line | Code |")
        a("|---|---|---|")
        for f in summary["news_audit"]:
            a("| `" + f["file"] + "` | " + str(f["line"]) + " | `" + f["code"] + "` |")
    else:
        a("_(none found)_")
    a("")
    a("`evals/news.py` takes an explicit as-of date, requests a window ending strictly "
      "before it, and then re-verifies every article's `publishedAt` and raises "
      "`LeakError` rather than proceeding. Prices are read from a frozen panel and "
      "truncated at the as-of session, with the same assertion.")
    a("")
    a("**Not fixed, and not fixable here:**")
    a("")
    a("- *Fundamentals are not point-in-time.* `compute_quality_score` reads "
      "`yf.Ticker(t).info`, which serves today's margins and market cap whatever the "
      "as-of date. There is no point-in-time source available, so quality is pinned to "
      "the neutral 50 the product already falls back to. This removes 20% of RocketScore's "
      "weight. It hits every arm identically so the comparison stands, but absolute "
      "RocketScores here are not comparable to production's.")
    a("- *`data/macro_trends.json` is written with hindsight.* Hand-authored theses like "
      "\"$200B+ AI capex spending 2025-2026\" with confidence scores, applied unchanged to "
      "every as-of date. 10% of the score, fixed in time.")
    a("- *The model's training data postdates the as-of dates.* This is the big one and it "
      "cannot be solved, only bounded. DeepSeek was trained on text that describes what "
      "happened after every as-of date below. When it reasons about a September 2025 "
      "setup it may be recalling the outcome, not predicting it. The as-of dates are "
      "chosen as recent as the 3-month label window allows in order to shrink this, but "
      "shrinking is not removing. **The older the as-of date, the more contaminated the "
      "result.** Treat every absolute number here as an optimistic ceiling. The arm-vs-arm "
      "comparison is more trustworthy than any single arm's level, because all arms are "
      "contaminated by the same prior.")
    a("")

    # ---- news coverage ---------------------------------------------------
    cov = summary.get("news_coverage", {})
    if cov:
        a("### News coverage actually achieved")
        a("")
        a("| As-of | Tickers with news | Articles | Notes |")
        a("|---|---:|---:|---|")
        for d, c in sorted(cov.items()):
            errs = "; ".join(str(v) + " x " + k for k, v in list(c["errors"].items())[:2]) or "-"
            a("| " + d + " | " + str(c["tickers_with_news"]) + "/" + str(c["tickers_total"])
              + " | " + str(c["articles_total"]) + " | " + errs + " |")
        a("")
        empty = [d for d, c in cov.items() if c["tickers_with_news"] == 0]
        if empty:
            a("> **`full_debate` and `debate_no_news` are the same arm on "
              + ", ".join(sorted(empty)) + "**, because no news was retrievable for those "
              "dates (NewsAPI's archive window). Any difference between them on those "
              "dates is pure sampling noise, and the no-news ablation is only informative "
              "on dates where coverage is non-zero.")
            a("")

    if summary.get("skipped_arms"):
        a("### Arms that did not run")
        a("")
        for arm, why in summary["skipped_arms"].items():
            a("- `" + arm + "`: " + why)
        a("")

    if not arms:
        a("## Results")
        a("")
        a("No arm produced results. Nothing can be concluded.")
        return _flush(L)

    # ---- results ---------------------------------------------------------
    for h in horizons:
        a("## Results, " + h + " horizon (excess of SPY)")
        a("")
        a("| Arm | Rank corr (Spearman) | Top-" + str(cfg["top_n"])
          + " hit rate | Top-decile excess | Brier | Buy rate | Score dispersion |")
        a("|---|---|---|---|---|---|---|")
        for arm in C.ARMS:
            if arm not in arms:
                continue
            agg = arms[arm]["horizons"][h]["aggregate"]
            a("| `" + arm + "` | " + _spread(agg, "spearman")
              + " | " + _spread(agg, "hit_rate_top_n")
              + " | " + _spread(agg, "top_decile_excess", pct=True)
              + " | " + _spread(agg, "brier")
              + " | " + _spread(agg, "buy_rate", pct=True)
              + " | " + _spread(agg, "score_dispersion", nd=1) + " |")
        a("")
        a("Each cell is mean ± sd [min, max] across " + str(cfg["seeds"])
          + " seeds. Metrics are computed within each as-of date and then averaged, so "
          "market direction cannot drive them. Brier is scored against "
          "`prob_beat_spy_1m`, an eval-only field appended identically to every deciding "
          "prompt; lower is better and 0.25 is what you get by always saying 50%.")
        a("")

        a("### Does the debate beat the single call at " + h + "?")
        a("")
        a(_verdict_line(summary, h))
        a("")

        if FLOOR in arms and "full_debate" in arms:
            d = arms["full_debate"]["horizons"][h]["aggregate"]
            r = arms[FLOOR]["horizons"][h]["aggregate"]
            sep = M.separated(d, r, "spearman")
            a("Against the random floor: debate " + _f(d.get("spearman", {}).get("mean"))
              + " vs random " + _f(r.get("spearman", {}).get("mean"))
              + (" - ranges separate." if sep else
                 " - **ranges overlap, so the debate is not distinguishable from random "
                 "ranking on this metric.**"))
            a("")

    # ---- cost ------------------------------------------------------------
    a("## What each arm costs")
    a("")
    a("| Arm | LLM calls / decision | Cost / decision | Total cost | Mean latency | Fallbacks |")
    a("|---|---:|---:|---:|---:|---:|")
    for arm in C.ARMS:
        if arm not in arms:
            continue
        c = arms[arm]["cost"]
        a("| `" + arm + "` | " + "{:.1f}".format(c["calls_per_decision"])
          + " | $" + "{:.5f}".format(c["cost_per_decision_usd"])
          + " | $" + "{:.2f}".format(c["total_cost_usd"])
          + " | " + "{:.1f}".format(c["mean_latency_s"]) + "s"
          + " | " + str(c["fallbacks"]) + " |")
    a("")
    a("Cost and latency are the values measured when each call was really made; cached "
      "reruns report the same figures rather than zero, because the question is what the "
      "arm costs to run, not what this particular rerun charged. Fallbacks are calls that "
      "errored and returned a placeholder HOLD; they are excluded from the cache and "
      "counted here because a non-zero count means the numbers above are diluted.")
    a("")
    if "full_debate" in arms and BASELINE in arms:
        dc = arms["full_debate"]["cost"]["cost_per_decision_usd"]
        sc = arms[BASELINE]["cost"]["cost_per_decision_usd"]
        if sc > 0:
            a("The debate costs **" + "{:.1f}".format(dc / sc)
              + "x** what the single call costs per decision. That is the multiple the "
              "quality difference above has to justify.")
            a("")

    # ---- reproduce -------------------------------------------------------
    a("## Reproducing this")
    a("")
    a("```bash")
    a("make eval")
    a("```")
    a("")
    a("The eval set is frozen in `evals/fixtures/` (labels, price panel, news). LLM "
      "responses are cached to `evals/cache/` by a hash of model + prompts + temperature "
      "+ seed, so reruns are free and byte-identical. Changing a prompt changes the hash "
      "and re-runs only what changed.")
    a("")
    a("Per-run JSON, including every agent memo and every judge output, is in "
      "`results/raw/<arm>__seed<k>.json`.")
    a("")
    a("Run config: model `" + cfg["model"] + "`, temperature " + str(cfg["temperature"])
      + ", " + str(cfg["seeds"]) + " seeds, " + str(cfg["n_pairs"]) + " (ticker, as-of) "
      "pairs across " + str(len(cfg["as_of_dates"])) + " dates ("
      + ", ".join(cfg["as_of_dates"]) + ").")

    return _flush(L)


def _flush(lines: list[str]) -> str:
    text = "\n".join(lines) + "\n"
    os.makedirs(C.RESULTS_DIR, exist_ok=True)
    with open(C.SUMMARY_PATH, "w", encoding="utf-8") as f:
        f.write(text)
    return text
