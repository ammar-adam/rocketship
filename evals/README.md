# Eval harness

One question: **does the multi-agent debate produce better stock picks than a
single LLM call with the same context?**

Nothing in here is imported by the product. The harness reads the product's
scoring code and prompts, but never writes to them.

```bash
make eval          # everything -> results/summary.md
make eval-smoke    # 5 tickers/date, 2 seeds
make selftest      # validate the harness itself, no LLM calls
make news-audit    # audit the product's NewsAPI path for leaks
```

No `make` (Windows)? Every target is a one-liner: `python -m evals.runner`,
`python -m evals.selftest`, and so on. `make help` lists them all.

Requires `DEEPSEEK_API_KEY` for the LLM arms and `NEWS_API_KEY` to build the
news fixture. Without a DeepSeek key the runner skips every LLM arm, says so
loudly, and still produces a report - it will not silently emit a half-run.

---

## What is being compared

Six arms, identical context, same 200 (ticker, as-of) pairs:

| Arm | What it is | Calls per decision |
|---|---|---:|
| `full_debate` | production: bull + bear + regime + value in parallel, then judge | 5 |
| `single_call` | one call, same four lenses and same decision rule, no debate | 1 |
| `judge_only` | the judge prompt over the context directly | 1 |
| `debate_no_bear` | debate with the adversary removed | 4 |
| `debate_no_news` | production debate, news block suppressed | 5 |
| `random` | uniform random score, no LLM - the floor | 0 |

`single_call` is the arm that matters. If the debate cannot beat it, the extra
four calls are decoration.

The four production prompts are not copied into this directory. `evals/prompts.py`
extracts them from `backend/main.py` at import time and fails loudly if they
move. So the eval cannot drift out of sync with the product it is judging.

---

## What "score" means here

The debate does not produce RocketScore. RocketScore is deterministic and
computed before any LLM runs (`src/rocket_score.py`, weights locked at
technical 45 / volume 25 / quality 20 / macro 10). The debate contributes
exactly one number to ranking: the judge's `confidence`, conditioned on its
verdict - which is what `final_buys.json` sorts by in production.

So every arm is collapsed to one ordinal score:

```
ENTER/BUY  ->  50 + confidence/2      (50..100)
HOLD       ->  50
EXIT/SELL  ->  50 - confidence/2      ( 0..50)
```

Monotone in "how much this arm wants to own the stock". That is the quantity
under test.

---

## The eval set

`evals/fixtures/eval_set.json` - 50 tickers spanning all 11 GICS sectors,
4 as-of dates, 200 pairs, frozen. The universe is hard-coded in
`evals/config.py` rather than scraped, so it never drifts with index membership.

Labels per pair: forward total return over 1M (21 sessions) and 3M (63
sessions), plus the same return **excess of SPY**. Returns use adjusted close;
the scoring path uses raw OHLCV, matching production.

`evals/fixtures/prices.csv.gz` holds the whole price panel, so after
`make fixture` runs once the eval never touches yfinance again. Reruns are
reproducible offline and byte-identical.

As-of dates: `2025-09-15`, `2025-11-17`, `2026-01-20`, `2026-03-16`. Chosen as
recent as the 3-month label window allows, for reasons in the next section.

---

## As-of discipline

### What the product does

Both news fetchers hardcode their window to *now*, and neither accepts an as-of
date:

| File | Line | Code |
|---|---|---|
| `backend/main.py` | 488 | `to_date = datetime.now(UTC)` |
| `frontend/lib/newsapi.ts` | 50 | `const toDate = new Date();` |
| `frontend/src/lib/newsapi.ts` | 50 | `const toDate = new Date();` |

Prices are the same story: `src/data_fetcher.py:50` calls
`yf.download(period=f"{lookback_days}d")` with no `end`, and caches under a
today-stamped key. Replaying a past date through any of these paths would hand
the agents the future.

`make news-audit` re-runs this check against the live source, so if someone adds
a sixth now-anchored call site it shows up rather than being folded in quietly.

### What the harness does

- Prices come from the frozen panel, truncated at the last session on or before
  the as-of date, then asserted (`assert_prices_are_as_of`).
- News is requested with a window ending strictly *before* the as-of date, and
  then every returned article's `publishedAt` is re-verified
  (`assert_articles_are_as_of`). Strict inequality: a same-day article can be a
  reaction to the very price move being predicted.
- Both raise `LeakError` and abort. Nothing is silently dropped or clamped.

The self-test plants a future price row and a future article and confirms both
are rejected.

### Leaks that are NOT fixed

Being explicit about these is the point of the harness.

**1. Fundamentals are not point-in-time.** `compute_quality_score` reads
`yf.Ticker(t).info`, which serves *today's* margins, revenue growth and market
cap regardless of as-of date. No point-in-time source is available here, so
quality is pinned to the neutral 50 the product already falls back to when
yfinance returns nothing. This removes 20% of RocketScore's weight. It applies
to every arm identically, so the arm-vs-arm comparison stands, but absolute
RocketScores in this harness are **not** comparable to production's.

**2. `data/macro_trends.json` is written with hindsight.** Hand-authored theses
("$200B+ AI capex spending 2025-2026") with confidence scores, applied unchanged
to every as-of date. 10% of the score, fixed in time.

**3. The model's training data postdates the as-of dates.** This one cannot be
solved, only bounded. DeepSeek was trained on text describing what happened
after every as-of date in the set. When it reasons about a September 2025 setup
it may be recalling the outcome rather than predicting it, and nothing in this
harness can tell the difference. The as-of dates are pushed as late as the
3-month label window permits in order to shrink the exposed window, but
shrinking is not removing, and **the older the as-of date, the more
contaminated the result**.

Practical consequence: treat every arm's absolute number as an optimistic
ceiling. The arm-vs-arm *comparison* is more trustworthy than any single arm's
level, because all arms carry the same contamination.

**4. NewsAPI's archive window.** Free and low-tier NewsAPI plans only serve
roughly the last month, so older as-of dates may return no articles at all. The
report prints per-date coverage, and where coverage is zero it states outright
that `full_debate` and `debate_no_news` are the same arm on that date and any
gap between them is noise.

---

## Metrics

All computed **within** each as-of date, then averaged across dates. Pooling all
200 pairs into one correlation would let market direction dominate: on a date
when SPY ran +13%, nearly everything has a positive raw return and an arm that
just says BUY a lot looks prescient. Excess-of-SPY labels remove the level;
per-date computation removes the rest.

- **Spearman rank correlation** between arm score and forward excess return.
- **Top-N hit rate**: of the N highest-scored names, the fraction that beat SPY.
- **Top-decile mean excess return**.
- **Brier score** against `prob_beat_spy_1m`. Production's `confidence` is
  confidence in a verdict, not a probability of a measurable event, so there is
  nothing to score it against. Every deciding prompt gets one identical appended
  block asking for an explicit calibrated probability. **This means the deciding
  prompt is production text plus that block** - recorded in the report, not
  buried here. Lower is better; 0.25 is what always-saying-50% gets you.
- **Buy rate** and **score dispersion**, as diagnostics. The production judge
  prompt says "You MUST issue ENTER verdicts" and "Lean toward ENTER"; the bull
  prompt says "default to ENTER with 65-85 confidence". An arm that says BUY to
  everything has no ranking information, and its rank correlation will be near
  zero for that boring reason rather than a subtle one. These two columns tell
  you which case you are looking at.
- **Cost and wall-clock** per arm, because the debate has to earn its expense.

## Variance

Every arm runs **5 seeds**. Every number is reported as mean ± sd with the
[min, max] range.

The report refuses to call anything a win unless the two arms' seed ranges are
**disjoint**: the worst run of the better arm still beats the best run of the
worse arm. With 5 seeds there is no honest parametric test, and this bar is
deliberately strict. Anything short of it is printed as *"inside the noise, not
a result"*.

Cost and latency are recorded from when a call was really made, so cached
reruns report true figures rather than zero. `incremental_*` fields carry what a
given rerun actually charged.

## Caching

Every LLM response is written to `evals/cache/`, keyed by
`sha256(model + system + user + temperature + max_tokens + seed)`. Reruns of an
unchanged arm are free and byte-identical. Changing a prompt changes the hash,
so stale responses are never reused; they simply stop being hit.

Failed calls are **never** cached: a transient network error must not become a
permanent fake answer on every future run. Failures return a placeholder HOLD,
are counted as `fallbacks`, and the count is printed in the report because a
non-zero value means the metrics above are diluted.

## Trusting the harness

`make eval` runs `make selftest` first and aborts if it fails. The self-test
plants signals and checks the machinery recovers them:

- an oracle arm scored on the labels themselves must return Spearman ≈ +1.0
- an anti-oracle must return ≈ −1.0
- a noise arm must return ≈ 0
- perfect probabilities must give Brier 0; always-50% must give exactly 0.25
- future prices and future articles must be rejected
- the extracted prompts must still match `backend/main.py`
- the seed-separation rule must not fire on overlapping ranges

If the harness cannot detect a signal it planted itself, its verdict on the
debate is worthless. That is why this gate runs first.

## Layout

```
evals/
  config.py         frozen universe, dates, arms, pricing
  build_fixture.py  one-time: download panel, derive labels
  asof.py           as-of price windows + leak assertions + quality neutralisation
  news.py           as-of news + leak assertions + product call-path audit
  prompts.py        production prompts, extracted verbatim from backend/main.py
  context.py        the identical context every arm sees
  arms.py           the six arms
  llm.py            DeepSeek client: cache, cost, latency, fallback accounting
  cache.py          prompt-hash disk cache
  metrics.py        spearman, hit rate, top decile, Brier, seed separation
  runner.py         orchestration
  report.py         renders results/summary.md
  selftest.py       validates the harness
  fixtures/         eval_set.json, prices.csv.gz, news.json
results/
  summary.md        the report
  summary.json      machine-readable
  raw/              per-run JSON, every agent memo and judge output
```
