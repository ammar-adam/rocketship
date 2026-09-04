# Roadmap: from "measured, and it doesn't work" to "picks better stocks"

Written against measured results, not intuition. Every claim below is either a
number from `results/` or is flagged as an assumption to be tested.

The short version: **more LLM engineering will not fix this.** The binding
constraints are the universe, the signal set, and the sample size, in that
order. The debate is the least of the problems.

---

## 1. Why it cannot work as currently designed

Four structural problems. The evaluation established the first three.

### 1.1 The universe is the most efficiently priced corner of the market

50 US mega-caps. Every one is covered by 20-40 sell-side analysts, priced by
market makers to the penny, and arbitraged by funds with better data and lower
latency. There is no plausible mechanism by which a momentum screen plus five
LLM calls finds mispricing in AAPL that Citadel has not.

This is the single biggest reason for the null result, and it is a design
choice, not a discovery. It was chosen for data availability.

### 1.2 The signals are hand-set thresholds, not fitted

`compute_technical_score` awards +10 if 1-month return exceeds 10%, +7 if it
exceeds 5%, and so on. Those cutoffs were chosen by hand. Nothing fitted them,
nothing validated them, and the boundaries are round numbers, which is the
signature of a guess rather than an estimate.

The measured consequence: the components carry no ranking information.

| Raw signal | 1M horizon | 3M horizon |
|---|---|---|
| `return_1m_pct` | +0.012 [-0.114, +0.128] | +0.042 [-0.080, +0.159] |
| `return_3m_pct` | +0.014 [-0.116, +0.129] | +0.011 [-0.094, +0.116] |
| `return_1y_pct` | +0.044 [-0.067, +0.150] | +0.048 [-0.039, +0.135] |
| **12-1 momentum** | +0.046 [-0.069, +0.157] | +0.051 [-0.044, +0.146] |
| `trend_slope` | +0.055 [-0.063, +0.171] | +0.010 [-0.086, +0.109] |
| `drawdown` | +0.004 [-0.118, +0.121] | -0.010 [-0.098, +0.071] |
| **`volume_surge_ratio`** | +0.004 [-0.104, +0.111] | **+0.051 [+0.004, +0.103]** |
| `up_down_volume_ratio` | +0.043 [-0.058, +0.137] | +0.027 [-0.088, +0.137] |

**Read this carefully.** `volume_surge_ratio` at 3M is the only interval in the
entire project that excludes zero. It is *not* a finding. That table is 18
comparisons; at a 5% threshold you expect ~0.9 false positives by chance, and we
got exactly one. It is a **lead to pre-register and test on fresh data**, and
the fact that it is tempting to report as a discovery is exactly why the plan
below builds multiplicity control in from the start.

One negative result worth recording: I expected `return_1m_pct` to be
*negatively* predictive, since one-month winners tend to reverse. It is not, in
this sample. The literature's short-term reversal effect does not show here,
which is itself a reason to distrust a sample this small rather than to
conclude the effect is absent.

### 1.3 The LLM is being used for the one thing it is worst at

The agents receive numbers and are asked to predict returns. Language models are
poor numeric forecasters and there is no reason to expect otherwise. The
measured result is consistent: Brier 0.252 against 0.250 for always saying
"50%", and incremental information indistinguishable from zero.

What language models *are* good at is reading unstructured text and turning it
into structured facts. That capability is entirely unused here: the pipeline
feeds them a JSON blob of numbers a linear model reads better.

### 1.4 The evidence bar is too low to detect a real effect if there were one

12 as-of dates. Two separate estimates flipped sign between 4 dates and 12. With
a cross-sectional information coefficient of the size anyone realistically
achieves (0.02-0.05), detecting it against noise needs hundreds of periods, not
twelve. **The current design would fail to detect a genuinely profitable signal.**

---

## 2. What would actually make it pick better

Ordered by expected value per unit of effort. The first two matter more than
everything else combined.

### 2.1 Change the universe (largest single lever)

Move from 50 mega-caps to the Russell 2000 range, with a liquidity floor
(median dollar volume above ~$2M/day) to keep it tradeable and exclude the
micro-cap junk where "returns" are quotes nobody can hit.

Rationale: documented factor premia are substantially larger in smaller names,
because coverage is thinner and limits to arbitrage are real. This is not a
clever idea, it is where the effect lives.

Cost: a wider price download. No API spend.

### 2.2 Replace invented thresholds with a fitted cross-sectional model

Three changes, all conventional and all currently absent:

**Standardise within date and sector.** Every signal becomes a z-score computed
across the universe on that date, then neutralised by sector. Right now a stock
is scored against absolute cutoffs, so a whole sector rallying moves every score
in it and the ranking picks up sector beta rather than stock selection. Stage A's
sector-neutral check exists for exactly this and should become the default.

**Use signals with out-of-sample track records rather than invented ones.** At
minimum: 12-1 momentum (skipping the most recent month), gross profitability,
accruals, earnings yield, idiosyncratic volatility, and one-month reversal as a
separate signed input rather than folded into "momentum". Note that the table
above already hints 12-1 is the best of the momentum family.

**Fit the weights.** Replace the hand-set 45/25/20/10 with a walk-forward
cross-sectional rank regression (ridge, or gradient boosting if the sample
eventually supports it), refit at each rebalance using only prior data. The
effective weights measured in Stage A are already ~75/20/0/5, so the config's
numbers are fiction regardless; better to fit them than to keep pretending.

### 2.3 Repurpose the LLM as a text feature extractor, not a predictor

This is the change that makes the LLM earn its place, and it is a different
product from the debate.

Instead of "here are numbers, predict the return", use it for what it is
genuinely better at than any numeric model:

- **Earnings call delta.** Diff this quarter's call against last quarter's:
  what guidance language changed, which risks appeared or disappeared, whether
  management hedging increased. Output a small vector of structured features.
- **8-K / filing materiality.** Classify events into types with a severity
  score, rather than treating all news as one undifferentiated blob.
- **Guidance revision extraction.** Pull the actual numbers out of prose and
  compare to consensus.

Each becomes a *feature* fed into the model from 2.2, and each is evaluated the
same way every other signal is: does it add incremental information beyond the
existing feature set? The harness already answers that question and already has
the estimator validated on a known-zero arm.

**This also gives the debate a fair test for the first time.** Structured
disagreement over ambiguous text is plausibly useful; structured disagreement
over a table of floats was never going to be. If the debate loses on text
features too, that is a genuinely informative null.

### 2.4 Get point-in-time fundamentals

`compute_quality_score` reads current fundamentals whatever the as-of date, so
the eval pins it to neutral and 20% of the nominal score is removed from the
test entirely. Any serious version needs a PIT source (Sharadar, Compustat
point-in-time, or a vendor with a restatement-aware API). Until then, no
fundamental signal can be honestly backtested.

---

## 3. Live evaluation: closing the loop in real time

The current harness answers "did it work historically". A live loop answers "is
it working now", which is both more useful and much harder to fool.

### 3.1 Prediction log (the foundation)

Every live decision writes one immutable record at the moment it is made:

```
prediction_id, ts_utc, as_of_date, ticker, model_version, feature_snapshot,
score, rank, verdict, confidence, prob_beat_benchmark, cost_usd, latency_ms
```

Immutable, append-only, with the **full feature snapshot** rather than a
reference to recomputed features. That single detail is what makes the log
un-fakeable: without it, a later change to the scoring code silently rewrites
history and the evaluation becomes circular.

### 3.2 Labeler

A scheduled job that walks the log, finds predictions whose forward window has
closed, attaches realised return and excess-of-benchmark, and marks them scored.
Runs daily. No LLM cost. Reuses the existing label machinery from
`evals/build_fixture.py`.

### 3.3 Rolling metrics on `/evals`

A live tab alongside the historical stages, showing over a trailing window:

- **Rolling information coefficient** with its confidence band, which is the
  headline: is the score still ranking?
- **Hit rate and mean excess** of the live top decile
- **Calibration curve** of `prob_beat_benchmark` against realised outcomes,
  which the current Brier of 0.252 says is presently worthless and should be
  visibly so
- **Cost per decision** against realised IC, so the trade stays legible
- **Prediction count**, prominently, because the honest constraint at the start
  is "n = 14, nothing is knowable yet" and the UI must say so rather than
  drawing a confident line through four points

Reuse `Stat`, `IntervalBar` and `SeparationChip` unchanged; they already refuse
to render a number without its uncertainty.

### 3.4 Drift detection

Two monitors, both cheap:

- **Input drift.** Population stability index on each feature's cross-sectional
  distribution versus the fitting window. Fires when the world has moved away
  from what the model was fitted on.
- **Output drift.** Score distribution, verdict mix, and LLM fallback rate. The
  five-week silent outage would have been caught in a day by the fallback rate
  alone.

### 3.5 Champion / challenger

New model versions run in **shadow**: they score every live decision and their
predictions are logged, but they do not trade. Promotion requires beating the
champion on paired live predictions over a pre-registered horizon, using the
same paired bootstrap already built. This is how a change gets adopted on
evidence rather than on a backtest that was tuned until it looked good.

---

## 4. Raising the evidence bar

Directly addressing what is currently not rigorous enough.

### 4.1 Purged, embargoed walk-forward

3-month forward windows on monthly as-of dates **overlap**, so adjacent
observations share outcome periods and are not independent. Any train/test split
must purge overlapping labels from the training set and embargo a gap after the
test window. Without this, a walk-forward backtest leaks and reports an
optimistic number. This matters more once weights are fitted (2.2) than it does
today, where nothing is fitted.

### 4.2 Multiplicity control, pre-registered

The `vol_surge` result in section 1.2 is the whole argument. Going forward:
the primary hypothesis family is declared in config *before* a run, tested with
Westfall-Young max-T over the shared bootstrap replicates (which absorbs the
high correlation between horizons, where Bonferroni would be badly
over-conservative), and everything else is labelled exploratory and reported
with a false discovery rate.

### 4.3 Costs, turnover, capacity

Stage C currently compares weighting schemes with no trading frictions. Add:
turnover between consecutive rebalances, cost drag at 5/10/25bp, and a capacity
estimate from median dollar volume. A signal that only works before costs does
not work.

### 4.4 Factor attribution

Regress the strategy's returns on market, size, value, momentum and quality.
If the alpha disappears, the system is an expensive way to buy factor exposure
available for 3bp in an ETF. **This is the question a professional asks first**,
and the project currently cannot answer it.

### 4.5 Deflated Sharpe

Report a Sharpe ratio deflated for the number of configurations tried. Any
backtest reported without it, after a parameter search, is overstated by
construction.

---

## 5. Sequencing

Free work first, and each phase produces a decision rather than just artifacts.

| Phase | Work | Cost | Decision it produces |
|---|---|---|---|
| **0** | Widen universe + dates. Russell-range names, liquidity floor, 60+ monthly as-of dates. | $0 | Is there enough sample to detect anything? |
| **1** | Sector-neutral z-scores, documented factor set, fitted weights with purged walk-forward, costs and turnover. | $0 | Does a *conventional* factor model work here? If not, no LLM layer will. |
| **2** | Factor attribution + deflated Sharpe on the phase-1 model. | $0 | Is this alpha, or repackaged beta? |
| **3** | Prediction log + labeler + live `/evals` tab. | ~$0 | Starts the out-of-sample clock, which no backtest can substitute for. |
| **4** | LLM text features (call deltas, filing materiality), evaluated as incremental information over phase 1. | moderate | Does the LLM add anything a numeric model cannot? |
| **5** | Re-run the debate on text features. Champion/challenger in shadow. | moderate | Does structured disagreement help where it might plausibly help? |

**The gate that matters is phase 1.** If a conventional, well-specified factor
model on a sensible universe cannot rank forward returns, the problem is not the
debate and no amount of agent design will rescue it. Spending on phase 4 before
passing phase 1 is how people build expensive, elaborate nothing.

---

## 6. What "incredible" actually looks like

Not a higher backtest Sharpe; those are cheap and mostly fiction.

A system that **knows when it does not know**, and can prove it:

- Position size scales with the model's own measured, out-of-sample-validated
  confidence, so it holds cash when its edge is absent instead of forcing 8-12
  positions because a constant says so.
- Every live prediction is logged before the outcome exists, and the running
  scorecard is public on the site, including the periods where it is losing.
- Every claim carries an interval, and the UI is structurally incapable of
  showing one without it.
- A change is adopted only after beating the incumbent on paired live
  predictions.

That is a rarer and more defensible thing than a good backtest, and most of the
machinery for it is already built.
