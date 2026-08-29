# RocketShip eval: does the debate beat one call?

Generated 2026-08-29T02:01:33Z.

**The question.** The product runs five LLM agents (bull, bear, regime, value, then a judge) to decide which stocks to buy. That costs roughly five times what one call costs. This harness exists to find out whether the extra four calls buy anything measurable, or whether the claim was decoration.

## Read this before the table

1. **The debate does not produce the score.** RocketScore is deterministic and computed before any LLM runs (`src/rocket_score.py`, weights locked at technical 45 / volume 25 / quality 20 / macro 10). The debate contributes exactly one number to ranking: the judge's `confidence`, conditioned on its verdict. That is what is measured here.
2. **Production never debates the whole universe.** It screens ~500 tickers by RocketScore and debates only the top ~30. This eval runs every arm over all 50 tickers so the arms are compared on identical pairs. So the result answers *can the debate rank stocks*, which is a necessary condition for the product's claim, not the full claim.
3. **The judge-only arm is not production's judge.** Production's judge sees only the four agent memos and no data at all (`backend/main.py:1573`, comment: *"no metrics, no news"*). With no memos there would be nothing to read, so this arm is the judge prompt over the same context every other arm gets.
4. **The prompts used to be thumbed toward buying, and were de-biased.** The judge prompt said "You MUST issue ENTER verdicts" and "Lean toward ENTER"; the bull was told to "default to ENTER with 65-85 confidence". A prescribed confidence band makes that field near-constant across stocks, which destroys the only quantity the debate contributes to ranking. The prompts now ask for calibration and state that position count is enforced downstream, so there is no reason to inflate a marginal name to fill a slot. **Results generated before that commit are not comparable to results after it.** Watch the buy-rate and score-dispersion columns either way: an arm that says BUY to everything has no ranking information, and its rank correlation will be near zero for that reason rather than for a subtle one.
5. **The agents see about 100 tokens.** Production's `metrics_context` (`backend/main.py:1332`) passes the ticker, sector, price, the four aggregate component scores, rank and tags. It passes NONE of the raw metrics the scorer computed: `return_1m_pct`, `trend_slope_annualized`, `volume_surge_ratio`, drawdown, margins all sit in `score['technical_details']['raw_metrics']` and are never forwarded. So a bull analyst instructed to cite specific data has almost no data to cite. If the arms come out flat, this is the first thing to suspect, ahead of anything about debate structure.
6. **A difference inside the seed spread is not a result.** Every number below is mean ± sd across 5 seeds with the [min, max] range. This report only calls something a win when the ranges do not overlap.

## Known leaks, including the ones not fixed

**Fixed by the harness.** The product's news fetchers hardcode the window to now, so replaying a past date through them would hand the agents future headlines. The audit finds these call sites:

| File | Line | Code |
|---|---|---|
| `backend/main.py` | 488 | `to_date = datetime.now(UTC)` |
| `frontend/lib/newsapi.ts` | 50 | `const toDate = new Date();` |
| `frontend/src/lib/newsapi.ts` | 50 | `const toDate = new Date();` |

`evals/news.py` takes an explicit as-of date, requests a window ending strictly before it, and then re-verifies every article's `publishedAt` and raises `LeakError` rather than proceeding. Prices are read from a frozen panel and truncated at the as-of session, with the same assertion.

**Not fixed, and not fixable here:**

- *Fundamentals are not point-in-time.* `compute_quality_score` reads `yf.Ticker(t).info`, which serves today's margins and market cap whatever the as-of date. There is no point-in-time source available, so quality is pinned to the neutral 50 the product already falls back to. This removes 20% of RocketScore's weight. It hits every arm identically so the comparison stands, but absolute RocketScores here are not comparable to production's.
- *`data/macro_trends.json` is written with hindsight.* Hand-authored theses like "$200B+ AI capex spending 2025-2026" with confidence scores, applied unchanged to every as-of date. 10% of the score, fixed in time.
- *The model's training data postdates the as-of dates.* This is the big one and it cannot be solved, only bounded. DeepSeek was trained on text that describes what happened after every as-of date below. When it reasons about a September 2025 setup it may be recalling the outcome, not predicting it. The as-of dates are chosen as recent as the 3-month label window allows in order to shrink this, but shrinking is not removing. **The older the as-of date, the more contaminated the result.** Treat every absolute number here as an optimistic ceiling. The arm-vs-arm comparison is more trustworthy than any single arm's level, because all arms are contaminated by the same prior.

### News coverage actually achieved

| As-of | Tickers with news | Articles | Notes |
|---|---:|---:|---|
| 2025-09-15 | 0/50 | 0 | 50 x missing from fixture |
| 2025-11-17 | 0/50 | 0 | 50 x missing from fixture |
| 2026-01-20 | 0/50 | 0 | 50 x missing from fixture |
| 2026-03-16 | 0/50 | 0 | 50 x missing from fixture |

> **`full_debate` and `debate_no_news` are the same arm on 2025-09-15, 2025-11-17, 2026-01-20, 2026-03-16**, because no news was retrievable for those dates (NewsAPI's archive window). Any difference between them on those dates is pure sampling noise, and the no-news ablation is only informative on dates where coverage is non-zero.

### Arms that did not run

- `full_debate`: DEEPSEEK_API_KEY not set
- `single_call`: DEEPSEEK_API_KEY not set
- `judge_only`: DEEPSEEK_API_KEY not set
- `debate_no_bear`: DEEPSEEK_API_KEY not set
- `debate_no_news`: DEEPSEEK_API_KEY not set

## Results, 1M horizon (excess of SPY)

| Arm | Rank corr (Spearman) | Top-5 hit rate | Top-decile excess | Brier | Buy rate | Score dispersion |
|---|---|---|---|---|---|---|
| `random` | +0.003 ± 0.051  [-0.031, +0.092] | 0.490 ± 0.082  [0.400, 0.600] | -0.13% ± 0.46%  [-0.52%, +0.57%] | 0.337 ± 0.009  [0.323, 0.347] | 32.50% ± 1.90%  [30.50%, 35.50%] | 28.3 ± 0.6  [27.6, 29.1] |

Each cell is mean ± sd [min, max] across 5 seeds. Metrics are computed within each as-of date and then averaged, so market direction cannot drive them. Brier is scored against `prob_beat_spy_1m`, an eval-only field appended identically to every deciding prompt; lower is better and 0.25 is what you get by always saying 50%.

### Does the debate beat the single call at 1M?

Cannot answer the question: full_debate did not run.

## Results, 3M horizon (excess of SPY)

| Arm | Rank corr (Spearman) | Top-5 hit rate | Top-decile excess | Brier | Buy rate | Score dispersion |
|---|---|---|---|---|---|---|
| `random` | -0.019 ± 0.095  [-0.104, +0.085] | 0.440 ± 0.089  [0.300, 0.500] | -1.93% ± 2.63%  [-4.91%, +2.06%] | 0.327 ± 0.020  [0.293, 0.345] | 32.50% ± 1.90%  [30.50%, 35.50%] | 28.3 ± 0.6  [27.6, 29.1] |

Each cell is mean ± sd [min, max] across 5 seeds. Metrics are computed within each as-of date and then averaged, so market direction cannot drive them. Brier is scored against `prob_beat_spy_1m`, an eval-only field appended identically to every deciding prompt; lower is better and 0.25 is what you get by always saying 50%.

### Does the debate beat the single call at 3M?

Cannot answer the question: full_debate did not run.

## What each arm costs

| Arm | LLM calls / decision | Cost / decision | Total cost | Mean latency | Fallbacks |
|---|---:|---:|---:|---:|---:|
| `random` | 0.0 | $0.00000 | $0.00 | 0.0s | 0 |

Cost and latency are the values measured when each call was really made; cached reruns report the same figures rather than zero, because the question is what the arm costs to run, not what this particular rerun charged. Fallbacks are calls that errored and returned a placeholder HOLD; they are excluded from the cache and counted here because a non-zero count means the numbers above are diluted.

## Reproducing this

```bash
make eval
```

The eval set is frozen in `evals/fixtures/` (labels, price panel, news). LLM responses are cached to `evals/cache/` by a hash of model + prompts + temperature + seed, so reruns are free and byte-identical. Changing a prompt changes the hash and re-runs only what changed.

Per-run JSON, including every agent memo and every judge output, is in `results/raw/<arm>__seed<k>.json`.

Run config: model `deepseek-chat`, temperature 0.4, 5 seeds, 200 (ticker, as-of) pairs across 4 dates (2025-09-15, 2025-11-17, 2026-01-20, 2026-03-16).
