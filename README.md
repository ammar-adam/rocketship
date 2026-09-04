# 🚀 RocketShip

*Institutional-grade stock screening, multi-agent AI debate, and portfolio optimization - in one pipeline.*

![Python](https://img.shields.io/badge/Python-3.9+-3776AB?style=for-the-badge&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-Backend-009688?style=for-the-badge&logo=fastapi&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-black?style=for-the-badge&logo=next.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![DeepSeek](https://img.shields.io/badge/DeepSeek-API-6C5CE7?style=for-the-badge&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-Deploy-000000?style=for-the-badge&logo=vercel&logoColor=white)
![Fly.io](https://img.shields.io/badge/Fly.io-Backend-8B5CF6?style=for-the-badge&logoColor=white)
[![Live](https://img.shields.io/badge/Live-Site-00C853?style=for-the-badge&logo=safari&logoColor=white)](https://rocketshipstocks.vercel.app)

Screens **493** S&P 500 stocks (ex-MAG7), runs **5** AI agents on the top **30** candidates, and builds an optimized portfolio from ENTER verdicts - **~$0.04/run**, **15-20 min** full pipeline. Built for engineers and quants who want a serious, reproducible research stack.

---

## How It Works

1. **🔍 Discovery** - Screens **493** S&P 500 stocks using RocketScore (technical + macro signals).
2. **🤖 Debate** - **5** AI agents (Bull, Bear, Regime, Value, Judge) debate the top **30** candidates.
3. **📊 Allocation** - CVXPY convex optimization builds a portfolio from ENTER verdicts.

---

## Pipeline Walkthrough

**Step 1 - Scan Tickers**
Fetches OHLCV data for all 493 S&P 500 stocks (ex-MAG7) using yfinance with caching. Computes 10 technical indicators per stock including momentum, volume surge, SMA crossovers, and volatility.

**Step 2 - RocketScore**
Each stock receives a composite score: `0.6 x Technical + 0.4 x Macro`. Technical score weights momentum (35%), volume (25%), trend (25%), and quality (15%). Macro score aligns sector with active themes (AI, Healthcare, Industrials, etc.). All 493 stocks are ranked.

**Step 3 - Select Debate Candidates**
Top 30 stocks are selected for debate: 23 highest RocketScore stocks, 5 edge cases (ranks 24-28), and 2 best-of-worst (top 2 from bottom quartile). This surfaces both obvious winners and hidden opportunities.

**Step 4 - Run Multi-Agent Debate**
Each of the 30 candidates goes through a 5-agent debate pipeline. Bull, Bear, Regime, and Value agents each produce independent analysis with NewsAPI context. The Judge agent synthesizes all inputs and issues a final verdict: ENTER, HOLD, or EXIT.

**Step 5 - Portfolio Optimization**
ENTER verdicts are passed to a CVXPY convex optimizer. Position sizes are weighted by RocketScore x Conviction and constrained to 5-20% per position. Output is a fully allocated $10,000 portfolio stored in `portfolio.json`.

---

## RocketScore Algorithm

```
RocketScore = 0.6 × Technical + 0.4 × Macro
```

| Component | Weight | Signals |
|-----------|--------|---------|
| Momentum | 35% of Technical | 20d/60d price change + acceleration |
| Volume | 25% of Technical | Volume surge detection |
| Trend | 25% of Technical | SMA crossovers, distance from 52w high |
| Quality | 15% of Technical | Volatility penalties |
| Macro | 40% of total | Sector alignment with AI, Healthcare, Industrials, etc. |

---

## The 5 Agents

| Agent | Role |
|-------|------|
| 🐂 Bull | Finds 2-6x upside with news citations |
| 🐻 Bear | Identifies fatal flaws and downside risks |
| 🌐 Regime | Macro and sector context |
| 💰 Value | Valuation analysis with price targets |
| ⚖️ Judge | Synthesizes all inputs → ENTER / HOLD / EXIT |

---

## Output Structure

```
runs/{timestamp}/
├── rocket_scores.json       # All ~493 stocks ranked by RocketScore
├── debate_selection.json    # 30 selected candidates (23 top + 5 edge + 2 best_of_worst)
├── debate/                  # Debate results per ticker
│   ├── AAPL.json
│   ├── debate_summary.json
│   └── ...
├── final_buys.json          # Top BUY candidates (up to 12)
├── portfolio.json           # Optimized portfolio allocation
└── status.json              # Run status and progress
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         VERCEL                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              Next.js Frontend (UI Only)                 │ │
│  │                                                         │ │
│  │   /api/run/*  ──────────────────────────────────────┐   │ │
│  │   (thin proxy)                                       │   │ │
│  └──────────────────────────────────────────────────────┼───┘ │
└─────────────────────────────────────────────────────────┼─────┘
                                                          │
                                                          ▼
┌─────────────────────────────────────────────────────────────┐
│                         FLY.IO                               │
│  ┌────────────────────────────────────────────────────────┐ │
│  │              FastAPI Backend (Python)                   │ │
│  │                                                         │ │
│  │   POST /run           - Start RocketScore pipeline     │ │
│  │   GET  /run/{id}/status - Get run status               │ │
│  │   POST /run/{id}/debate - Start debate pipeline        │ │
│  │   POST /run/{id}/optimize - Start optimization         │ │
│  │                                                         │ │
│  │   Artifacts stored in /data/runs/{runId}/              │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## Quick Start

### Local

```bash
pip install -r requirements.txt
cd frontend && npm install
# add .env with DEEPSEEK_API_KEY and NEWS_API_KEY
python run.py
```

### Deployed

- **Frontend (Vercel):** Set root directory to `frontend`, add `PY_BACKEND_URL`, `DEEPSEEK_API_KEY`, `NEWS_API_KEY`; optionally `BLOB_READ_WRITE_TOKEN`.
- **Backend (Fly.io):** Deploy with `fly deploy -c backend/fly.toml` from repo root; set `DEEPSEEK_API_KEY` (and optionally `DATA_DIR`).

Full deployment steps: **[QUICKSTART.md](QUICKSTART.md)**. For troubleshooting, see **TROUBLESHOOTING.md** (if present) or backend/frontend logs.

---

## Environment Variables

| Variable | Where | Required | Purpose |
|----------|-------|----------|---------|
| `DEEPSEEK_API_KEY` | Backend + Frontend | ✅ | LLM debate engine |
| `NEWS_API_KEY` | Backend + Frontend | ✅ | News context for agents |
| `PY_BACKEND_URL` | Frontend (Vercel) | ✅ | Fly.io backend URL |
| `BLOB_READ_WRITE_TOKEN` | Frontend (Vercel) | Optional | Persistent storage |

---

## Cost

**~$0.04** per full run using DeepSeek API (30 stocks × 5 agents × ~200 tokens).

---

## Does any of this work? An honest evaluation

`evals/` measures the pipeline stage by stage against real forward returns. Not
LLM-as-judge: labels are realised 1-month and 3-month total returns, excess of
SPY, over a frozen set of (ticker, as-of date) pairs.

```bash
make eval        # everything -> results/
make selftest    # validate the harness itself, no API calls
```

Three stages, because "does it work" is three different questions:

| Stage | Question | LLM cost |
|---|---|---|
| **A** | Does the deterministic RocketScore screen rank forward returns? | $0 |
| **B** | Does the multi-agent debate beat one LLM call, and beat the screen? | ~$2.30 |
| **C** | Does portfolio construction beat equal weight, out of sample? | $0 |

Stages A and C run on 600 pairs across 12 monthly as-of dates. Stage B is
budget-limited to 4 of those dates. Confidence intervals come from a cluster
bootstrap resampling as-of dates, with one resample index shared across arms so
comparisons are paired.

### Stage A: the screen shows no detectable ranking signal

| Score | 1M rank corr (95% CI) | 3M rank corr (95% CI) |
|---|---|---|
| **rocket_score** | +0.026 [-0.096, +0.146] | +0.013 [-0.070, +0.101] |
| technical | +0.018 [-0.103, +0.135] | +0.006 [-0.074, +0.087] |
| volume | +0.048 [-0.033, +0.130] | +0.035 [-0.038, +0.109] |
| macro | +0.028 [-0.085, +0.131] | +0.004 [-0.134, +0.126] |

Every interval straddles zero. Top-decile excess return is +2.29%
[-0.89%, +5.64%] at 1M: a positive point estimate that is consistent with zero.

Two things fell out of it.

**The advertised weights are not the effective weights.** A component with no
cross-sectional variance cannot move a ranking whatever weight it carries:

| Component | Advertised | Actually moves the ranking |
|---|---:|---:|
| technical | 45% | **75.4%** |
| volume | 25% | 20.1% |
| quality | 20% | **0.0%** |
| macro | 10% | 4.5% |

Quality is 0% because the eval pins it to neutral - `compute_quality_score`
reads *current* fundamentals from yfinance whatever the as-of date, so it cannot
be backtested honestly at all. The locked 45/25/20/10 is effectively ~75/20/0/5.

**The tag bonus does nothing.** Effect on rank correlation: -0.000, CI
[-0.007, +0.007]. Not "we cannot tell" - a tight interval around zero.

### Stage C: the optimizer is worth ~2bp over dividing by N

Same basket (top 12 by RocketScore), covariance fitted only on data ending at
the as-of date, evaluated on realised forward returns.

| Comparison | 1M | 3M |
|---|---|---|
| optimizer - equal weight | +0.02% [-0.80%, +0.94%] | +0.16% [-1.29%, +1.44%] |
| optimizer - SPY | +1.01% [-0.75%, +2.39%] | +0.64% [-2.84%, +3.51%] |

cvxpy, a shrinkage covariance estimator, sector caps and position limits deliver
nothing measurable over 1/N on the same names.

**The shipped backtest is inflated by roughly 40%.** `compute_backtest` replays
the same trailing window the selection *and* the covariance both came from. Its
framing gives Sharpe +2.12 [+1.78, +2.55]; the honest forward Sharpe on the same
weights is +1.48 [+0.92, +2.07]. The gap is consistent across all four weighting
schemes.

**The risk term does nothing at the shipped lambda.** Sweeping `risk_lambda`
from 0 to 256, max weight stays pinned at the 0.12 cap from lambda 0 through 4,
with 6-7 of 12 names at the cap; HHI moves 0.1125 -> 0.1103 across the whole
sweep, against 0.0833 for equal weight. The return term is O(0.5) and the
annualised variance term is O(0.004), so at lambda=1 the solution is a corner:
max weight on the top scores until the caps bind. It is a constrained ranking,
not an optimisation.

Two constraint bugs, both verified by running the code:

- **The constraint set is infeasible at 8 positions.** 6 names allowed in one
  sector, a 0.35 sector cap, 0.12 max weight and `sum(w) >= 0.95` give a maximum
  attainable sum of 0.59. The solver returns `infeasible` and the code silently
  falls back to equal weight - a structurally different result, with no backtest,
  and no warning.
- **The fallback then breaches the cap it just enforced.** It scales the
  offending sector to 0.35, then renormalises everything to sum to 1, scaling it
  back to **0.4116**.

### Stage A2: a correctly specified screen DOES rank returns - and beats the shipped one

Stage A measured the shipped screen on 50 mega-caps over 12 dates and found
nothing. The diagnosis was that the universe, the signals and the sample were
all wrong. This tests that diagnosis on **19,051 pairs, 533 tickers, 36 monthly
as-of dates** - 32x the sample - with sector-neutral z-scores instead of
hand-set absolute thresholds.

**Head to head, identical pairs, 3M excess of SPY:**

| Score | Rank IC (95% CI) |
|---|---|
| RocketScore (shipped) | +0.0237 [-0.0223, +0.0679] |
| **12-1 momentum, sector-neutral** | **+0.0805 [+0.0434, +0.1185]** |
| **momentum minus RocketScore (paired)** | **+0.0568 [+0.0244, +0.0920]** |

The paired difference **excludes zero**. A single, well-known, correctly
constructed factor beats the entire hand-tuned four-component RocketScore on the
same 19,051 pairs. That is the first positive result in this project, and it is
held to the same strict standard as every null.

**Two findings worth more than the headline:**

*The simplest thing wins.* A fitted seven-factor walk-forward model scores
+0.0418 [-0.0082, +0.0920] - **worse than the single momentum factor, and not
significant**. Naively averaging all seven is worse still (+0.0135). Adding
factors diluted the one that works. The fitting is not the value; the correct
specification of one signal is.

*Momentum is not a disguised sector bet.* Sector-neutralising the z-scores
barely moves it (+0.0964 raw, +0.0805 sector-neutral). It survives being
demeaned within sector, which is the check that usually kills this kind of
result.

**Out of sample, purged.** 3-month labels on a monthly grid overlap, so training
on a date whose outcome window overlaps the test date leaks the answer. The
walk-forward purges 3 dates around each test date. Top-decile minus
bottom-decile: **+0.0670 [+0.0174, +0.1175]** over 3 months, still separating,
with 51% turnover per rebalance and a cost drag of ~26bp at 25bp round-trip.

**What I do not believe yet, and why**

- **Survivorship bias, and it bites momentum hardest.** The universe is *current*
  index membership. Companies delisted or acquired over the window are absent,
  and the survivors are disproportionately the ones that went up - which is
  exactly the thing momentum measures. This is the single biggest threat to the
  result and it cannot be fixed without point-in-time membership data.
- **One regime.** 36 months spanning a recovery and a bull market. Momentum is
  well documented to work in trending markets and to crash hard on reversals.
  This sample contains no such reversal.
- **The IC is suspiciously large.** Published cross-sectional momentum ICs sit
  around 0.02-0.05. Getting 0.08 is more consistent with the two biases above
  than with having found something new.
- **Large-cap only.** The universe is S&P 500-scale names. The roadmap's
  small/mid-cap extension is untested.

The honest claim is not "I built a profitable strategy". It is: **a conventional
factor, correctly specified, measurably outranks the shipped screen on the same
data, and I can name the three biases that would most likely explain it away.**

### Stage B: the debate does not beat a single call, or the screen

600 pairs, 12 monthly as-of dates, 3 seeds, **7,200 real API calls, $3.44**,
zero failures. Every comparison is paired: same pairs, same bootstrap resample
plan, so intervals are on the *difference*, not on two separately estimated
levels.

**Rank correlation with forward excess return** (mean +/- sd across seeds):

| Arm | 1M | 3M | $/decision | latency |
|---|---|---|---:|---:|
| `full_debate` | -0.010 +/- 0.016 | -0.001 +/- 0.005 | $0.00253 | 12.7s |
| `single_call` | +0.017 +/- 0.018 | +0.001 +/- 0.004 | $0.00036 | 5.1s |
| `rank_by_rocket_score` | +0.026 | +0.013 | **$0** | 0s |
| `random` (8 seeds) | +0.003 +/- 0.040 | +0.007 +/- 0.033 | **$0** | 0s |

**Paired differences - nothing separates:**

| Comparison | 1M | 3M |
|---|---|---|
| debate - single call | -0.027 [-0.079, +0.024] | -0.003 [-0.067, +0.057] |
| debate - screen | -0.034 [-0.099, +0.033] | -0.013 [-0.066, +0.040] |
| debate - random | -0.011 [-0.104, +0.093] | -0.007 [-0.074, +0.061] |

**Incremental information - the headline.** Residualise the arm's score on the
`rocket_score` it was handed, then correlate the residual with forward excess
return. `total = via_screen + incremental`.

| Arm | horizon | total | via screen | **new information** |
|---|---|---|---|---|
| `full_debate` | 1M | -0.002 | +0.021 | **-0.028 [-0.072, +0.018]** |
| `full_debate` | 3M | -0.003 | +0.011 | **-0.016 [-0.053, +0.024]** |
| `single_call` | 1M | +0.022 | +0.025 | **-0.004 [-0.048, +0.035]** |
| `single_call` | 3M | +0.002 | +0.015 | **-0.013 [-0.073, +0.039]** |
| `rank_by_rocket_score` | both | = via screen | = total | **0.000 exactly** |

**Tripling the dates is what settled it.** On the original 4 dates,
`full_debate`'s 3M incremental information was **+0.041 [-0.018, +0.100]** - the
single estimate in the whole suite that looked close to separating. On 12 dates
it is **-0.016**. The sign flipped, exactly as the screen's own estimate had
flipped between 4 dates and 12 in Stage A. Four dates was not enough to conclude
anything, and the harness demonstrated that on itself before anyone drew a
conclusion from it.

**The probabilities carry no information.** Brier at 3M: `full_debate` 0.252,
`single_call` 0.252 - identical, and against exactly 0.250 for always answering
"50%". `random` scores 0.336, so the metric does discriminate; these two arms
simply sit on the no-information baseline.

**Top-5 hit rate at 3M:** `rank_by_rocket_score` 50.0%, `full_debate` 46.1%,
`single_call` 46.1%, `random` 42.9%. The free arm wins.

### So: does the debate earn its cost?

**No.** It costs **7.0x** a single call per decision and **2.5x** the latency,
and no metric separates it from the single call, from the deterministic screen,
or from random. Its incremental information beyond the score it is handed is
indistinguishable from zero, with a negative point estimate at both horizons.

The honest reading is not "the debate is worthless" but "it is not measurably
better, and the burden of proof was on it". Three caveats that cut both ways:

- **Twelve as-of dates is still few**, and this project has already shown twice
  what that does to an estimate. A longer history is the single highest-value
  next step.
- **The screen it builds on has no signal either** (Stage A), so the debate is
  being asked to add value on top of noise, over 50 mega-caps where edge is hard
  to find by construction.
- **Training-data contamination biases every arm upward**, not down. These are
  ceilings.

Total spend to establish all of this, across pilot and both full runs: **$5.30**.

### What was wrong with the debate itself

**Correction to an earlier claim in this repo's history.** Commits 6b5b110 and
917befe assert that the debate had been dead in production for five weeks
because `deepseek-chat` was retired on 2026-07-24. **That is wrong.** The alias
was announced for retirement, but verified on 2026-08-29 by a live call it still
resolves, mapping to `deepseek-v4-flash` in non-thinking mode. The debate was
working. The claim came from secondary sources rather than from a test, and the
test should have come first.

What survives that correction, and why the change was still right:

- **The `thinking` trap is real, and measured.** V4 enables reasoning by default,
  and reasoning tokens bill as output - the dominant cost line:

  | call | reasoning tokens | output tokens |
  |---|---:|---:|
  | `deepseek-chat`, no thinking param | 0 | 9 |
  | `deepseek-v4-flash`, **no** thinking param | **64** | **64** |
  | `deepseek-v4-flash`, `thinking: disabled` | 0 | 9 |

  So renaming the model without disabling thinking - the obvious migration -
  would have silently multiplied output cost and changed the behaviour the
  prompts were tuned against. Pinning the model explicitly is only safe *because*
  thinking is pinned with it.

- **The laundering failure mode is real, just latent.** If the LLM does fail
  wholesale, every agent error degrades to a synthetic `HOLD` with confidence 50;
  `summary['buy']` is empty; the forced-buy floor promotes HOLDs sorted by
  `(-confidence, -rocket_score)`; and with every confidence identical that sort
  collapses to rocket_score. `final_buys.json` becomes the top 8 of the
  deterministic screen, presented as the output of a five-agent debate, with no
  visible error. That path was never exercised, but nothing prevented it. A
  health gate now aborts the run instead, and `test_selection.py` pins the
  collapse so it cannot return quietly.

Three further changes, each committed separately so the eval can attribute them:
the agents now receive the raw metrics they never saw (~96 tokens of aggregate
scores before), the judge sees the underlying data rather than only the memos,
and the prompts no longer prescribe a verdict or a confidence band.

### Known leaks, including the ones not closed

The harness takes an explicit as-of date, requests news ending strictly before
it, re-verifies every `publishedAt`, truncates prices at the as-of session, and
raises rather than proceeding. `make news-audit` re-checks the product source so
a new now-anchored call site cannot slip in.

Three leaks are **not** closed:

- **Fundamentals are not point-in-time.** Quality pinned to neutral, removing
  20% of RocketScore's weight. Identical across arms, so comparisons hold;
  absolute scores do not match production.
- **`data/macro_trends.json` was written with hindsight** and applied unchanged
  to every as-of date. Its `"Materials"` and `"Consumer Discretionary"` entries
  can never fire at all, because yfinance emits `"Basic Materials"` and
  `"Consumer Cyclical"`.
- **The model's training data postdates every as-of date.** Cannot be fixed,
  only bounded by choosing recent dates. Every absolute number here is an
  optimistic ceiling; arm-vs-arm comparison is the more trustworthy read.

Full method and caveats: [`evals/README.md`](evals/README.md).

## Module Reference

### Core Modules

- `src/config.py` - Configuration management
- `src/universe.py` - S&P 500 stock universe
- `src/data_fetcher.py` - OHLCV data fetching with caching
- `src/signals.py` - Technical signal computation
- `src/rocket_score.py` - Scoring algorithm
- `src/discovery.py` - Stock screening engine
- `src/facts_pack.py` - Data compression for agents
- `src/agents.py` - Multi-agent debate system
- `src/memos.py` - Markdown memo generation
- `src/allocation.py` - Portfolio allocation logic

### Eval Harness

- `evals/` - Offline eval comparing the debate against a single call (see [evals/README.md](evals/README.md))

---

*Research tool for educational purposes. Not investment advice.*
