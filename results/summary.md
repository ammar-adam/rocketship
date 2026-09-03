# RocketShip eval: does the debate beat one call?

Generated 2026-09-03T22:48:17Z.

**The question.** The product runs five LLM agents (bull, bear, regime, value, then a judge) to decide which stocks to buy. That costs roughly five times what one call costs. This harness exists to find out whether the extra four calls buy anything measurable, or whether the claim was decoration.

## Read this before the table

1. **The debate does not produce the score.** RocketScore is deterministic and computed before any LLM runs (`src/rocket_score.py`, weights locked at technical 45 / volume 25 / quality 20 / macro 10). The debate contributes exactly one number to ranking: the judge's `confidence`, conditioned on its verdict. That is what is measured here.
2. **Production never debates the whole universe.** It screens ~500 tickers by RocketScore and debates only the top ~30. This eval runs every arm over all 50 tickers so the arms are compared on identical pairs. So the result answers *can the debate rank stocks*, which is a necessary condition for the product's claim, not the full claim.
3. **The judge-only arm is not production's judge.** Production's judge sees only the four agent memos and no data at all (`backend/main.py:1573`, comment: *"no metrics, no news"*). With no memos there would be nothing to read, so this arm is the judge prompt over the same context every other arm gets.
4. **The prompts used to be thumbed toward buying, and were de-biased.** The judge prompt said "You MUST issue ENTER verdicts" and "Lean toward ENTER"; the bull was told to "default to ENTER with 65-85 confidence". A prescribed confidence band makes that field near-constant across stocks, which destroys the only quantity the debate contributes to ranking. The prompts now ask for calibration and state that position count is enforced downstream, so there is no reason to inflate a marginal name to fill a slot. **Results generated before that commit are not comparable to results after it.** Watch the buy-rate and score-dispersion columns either way: an arm that says BUY to everything has no ranking information, and its rank correlation will be near zero for that reason rather than for a subtle one.
5. **The agents see about 100 tokens.** Production's `metrics_context` (`backend/main.py:1332`) passes the ticker, sector, price, the four aggregate component scores, rank and tags. It passes NONE of the raw metrics the scorer computed: `return_1m_pct`, `trend_slope_annualized`, `volume_surge_ratio`, drawdown, margins all sit in `score['technical_details']['raw_metrics']` and are never forwarded. So a bull analyst instructed to cite specific data has almost no data to cite. If the arms come out flat, this is the first thing to suspect, ahead of anything about debate structure.
6. **A difference inside the seed spread is not a result.** Every number below is mean ± sd across 3 seeds with the [min, max] range. This report only calls something a win when the ranges do not overlap.

## Known leaks, including the ones not fixed

**Fixed by the harness.** The product's news fetchers hardcode the window to now, so replaying a past date through them would hand the agents future headlines. The audit finds these call sites:

| File | Line | Code |
|---|---|---|
| `backend/main.py` | 510 | `to_date = datetime.now(UTC)` |
| `frontend/lib/newsapi.ts` | 50 | `const toDate = new Date();` |

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

## Results, 1M horizon (excess of SPY)

| Arm | Rank corr (Spearman) | Top-5 hit rate | Top-decile excess | Brier | Buy rate | Score dispersion |
|---|---|---|---|---|---|---|
| `full_debate` | -0.010 ± 0.016  [-0.025, +0.006] | 0.494 ± 0.067  [0.417, 0.533] | +1.26% ± 0.52%  [+0.90%, +1.85%] | 0.258 ± 0.001  [0.257, 0.258] | 1.56% ± 0.35%  [1.17%, 1.83%] | 32.7 ± 1.3  [31.4, 34.0] |
| `single_call` | +0.017 ± 0.018  [+0.003, +0.037] | 0.561 ± 0.042  [0.517, 0.600] | +1.79% ± 1.36%  [+0.22%, +2.64%] | 0.258 ± 0.001  [0.257, 0.259] | 4.61% ± 0.82%  [3.67%, 5.17%] | 47.9 ± 1.5  [46.2, 48.8] |
| `rank_by_rocket_score` | +0.026 ± 0.000  [+0.026, +0.026] | 0.583 ± 0.000  [0.583, 0.583] | +2.29% ± 0.00%  [+2.29%, +2.29%] | n/a | 32.00% ± 0.00%  [32.00%, 32.00%] | 14.1 ± 0.0  [14.1, 14.1] |
| `random` | +0.003 ± 0.040  [-0.041, +0.061] | 0.440 ± 0.037  [0.383, 0.483] | -0.15% ± 0.93%  [-1.71%, +1.22%] | 0.333 ± 0.007  [0.321, 0.347] | 34.06% ± 2.30%  [29.00%, 36.33%] | 29.2 ± 0.2  [28.8, 29.4] |

Each cell is mean ± sd [min, max] across 3 seeds. Metrics are computed within each as-of date and then averaged, so market direction cannot drive them. Brier is scored against `prob_beat_spy_1m`, an eval-only field appended identically to every deciding prompt; lower is better and 0.25 is what you get by always saying 50%.

### Does the debate beat the single call at 1M?

- rank correlation: debate lower (-0.010 vs 0.017), but the seed ranges overlap. **Inside the noise, not a result.**
- top-N hit rate: debate lower (0.494 vs 0.561), but the seed ranges overlap. **Inside the noise, not a result.**
- top-decile excess: debate lower (0.013 vs 0.018), but the seed ranges overlap. **Inside the noise, not a result.**

Against the random floor: debate -0.010 vs random 0.003 - **ranges overlap, so the debate is not distinguishable from random ranking on this metric.**

## Results, 3M horizon (excess of SPY)

| Arm | Rank corr (Spearman) | Top-5 hit rate | Top-decile excess | Brier | Buy rate | Score dispersion |
|---|---|---|---|---|---|---|
| `full_debate` | -0.001 ± 0.005  [-0.007, +0.003] | 0.461 ± 0.077  [0.417, 0.550] | +1.86% ± 1.41%  [+0.23%, +2.72%] | 0.252 ± 0.001  [0.251, 0.254] | 1.56% ± 0.35%  [1.17%, 1.83%] | 32.7 ± 1.3  [31.4, 34.0] |
| `single_call` | +0.001 ± 0.004  [-0.002, +0.005] | 0.461 ± 0.086  [0.367, 0.533] | +3.62% ± 3.25%  [-0.11%, +5.89%] | 0.252 ± 0.002  [0.250, 0.254] | 4.61% ± 0.82%  [3.67%, 5.17%] | 47.9 ± 1.5  [46.2, 48.8] |
| `rank_by_rocket_score` | +0.013 ± 0.000  [+0.013, +0.013] | 0.500 ± 0.000  [0.500, 0.500] | +1.58% ± 0.00%  [+1.58%, +1.58%] | n/a | 32.00% ± 0.00%  [32.00%, 32.00%] | 14.1 ± 0.0  [14.1, 14.1] |
| `random` | +0.007 ± 0.033  [-0.034, +0.078] | 0.429 ± 0.028  [0.383, 0.467] | -0.29% ± 0.89%  [-1.88%, +1.10%] | 0.336 ± 0.011  [0.317, 0.350] | 34.06% ± 2.30%  [29.00%, 36.33%] | 29.2 ± 0.2  [28.8, 29.4] |

Each cell is mean ± sd [min, max] across 3 seeds. Metrics are computed within each as-of date and then averaged, so market direction cannot drive them. Brier is scored against `prob_beat_spy_1m`, an eval-only field appended identically to every deciding prompt; lower is better and 0.25 is what you get by always saying 50%.

### Does the debate beat the single call at 3M?

- rank correlation: debate lower (-0.001 vs 0.001), but the seed ranges overlap. **Inside the noise, not a result.**
- top-N hit rate: debate identical (0.461 vs 0.461), but the seed ranges overlap. **Inside the noise, not a result.**
- top-decile excess: debate lower (0.019 vs 0.036), but the seed ranges overlap. **Inside the noise, not a result.**

Against the random floor: debate -0.001 vs random 0.007 - **ranges overlap, so the debate is not distinguishable from random ranking on this metric.**

## What each arm costs

| Arm | LLM calls / decision | Cost / decision | Total cost | Mean latency | Fallbacks |
|---|---:|---:|---:|---:|---:|
| `full_debate` | 5.0 | $0.00253 | $4.55 | 11.7s | 0 |
| `single_call` | 1.0 | $0.00036 | $0.65 | 4.8s | 0 |
| `rank_by_rocket_score` | 0.0 | $0.00000 | $0.00 | 0.0s | 0 |
| `random` | 0.0 | $0.00000 | $0.00 | 0.0s | 0 |

Cost and latency are the values measured when each call was really made; cached reruns report the same figures rather than zero, because the question is what the arm costs to run, not what this particular rerun charged. Fallbacks are calls that errored and returned a placeholder HOLD; they are excluded from the cache and counted here because a non-zero count means the numbers above are diluted.

The debate costs **7.0x** what the single call costs per decision. That is the multiple the quality difference above has to justify.

## Reproducing this

```bash
make eval
```

The eval set is frozen in `evals/fixtures/` (labels, price panel, news). LLM responses are cached to `evals/cache/` by a hash of model + prompts + temperature + seed, so reruns are free and byte-identical. Changing a prompt changes the hash and re-runs only what changed.

Per-run JSON, including every agent memo and every judge output, is in `results/raw/<arm>__seed<k>.json`.

Run config: model `deepseek-v4-flash`, temperature 0.4, 3 seeds, 600 (ticker, as-of) pairs across 12 dates (2025-06-16, 2025-07-15, 2025-08-15, 2025-09-15, 2025-10-15, 2025-11-17, 2025-12-15, 2026-01-20, 2026-02-17, 2026-03-16, 2026-04-15, 2026-05-15).
