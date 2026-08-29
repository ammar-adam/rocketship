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

## Does the debate actually work?

Short answer, as of this commit: **unproven.** The harness that can answer it is
built and validated; the paid arms have not been run yet, so there is no result
to report. What follows is what is and is not currently known.

### The claim under test

The product runs five LLM calls per stock (bull, bear, regime, value, then a
judge) where one call would fit. `evals/` exists to find out whether those extra
four calls buy anything measurable, by running six arms over the same frozen set
of 200 (ticker, as-of date) pairs and comparing them on forward returns excess of
SPY:

full debate, single call with the same content, judge only, debate minus the
bear, debate with no news, and uniform random as the floor.

```bash
make eval    # -> results/summary.md
```

### What is known right now

- **The harness itself is validated.** `make selftest` plants a signal and
  checks the machinery recovers it: an oracle arm scored on the labels returns
  Spearman +1.0, an anti-oracle −1.0, noise ≈0, perfect probabilities give Brier
  0 and always-50% gives exactly 0.25. Future prices and future headlines are
  both rejected. 50 checks, all passing. `make eval` runs this gate first and
  aborts if it fails, because a harness that cannot detect a signal it planted
  has no standing to judge the debate.
- **The random floor behaves.** Spearman +0.003 ± 0.051 at 1M and −0.019 ± 0.095
  at 3M, top-5 hit rate 0.49. That is what "no skill" looks like on this eval
  set, and it is the number every paid arm has to clear.
- **The LLM arms have not been run.** They need `DEEPSEEK_API_KEY`. Until they
  are run, the claim that the debate beats a single call is exactly as
  unsupported as it was before this harness existed. The harness does not make
  the claim true; it makes it checkable.

### Three things found while building it, that matter before any number lands

1. **The debate does not produce the score.** RocketScore is deterministic and
   computed before any LLM runs. The debate contributes exactly one number to
   ranking: the judge's `confidence`, conditioned on its verdict. And
   production only ever debates the top ~30 of ~500 names already selected by
   that deterministic screen. So even a positive result would show the debate
   *ranks the momentum screen's survivors* better, which is narrower than "makes
   better picks".
2. **The prompts are thumbed hard toward buying.** The judge prompt says "You
   MUST issue ENTER verdicts" and "Lean toward ENTER"; the bull prompt says
   "default to ENTER with 65-85 confidence"; the bear is told to reserve EXIT for
   catastrophes. An arm that says BUY to nearly everything carries almost no
   ranking information. The report prints buy rate and score dispersion next to
   every result so a near-zero correlation can be read as "said BUY to
   everything" rather than mistaken for something subtle.
3. **The agents see about 100 tokens.** The context passed to all four
   analysts is the ticker, sector, price, the four aggregate component scores,
   rank and tags. Every raw metric the scorer computed - 1M/3M returns, trend
   slope, drawdown, volume surge ratio, margins - sits in
   `score["technical_details"]["raw_metrics"]` and is never forwarded into the
   prompt (`backend/main.py:1332`). A bull analyst told to cite specific data
   has almost none to cite. If the arms come out flat, suspect this before
   concluding anything about debate structure.
4. **Production's judge sees no data at all** - only the four agent memos,
   truncated (`backend/main.py:1573`, comment: *"no metrics, no news"*). That is
   worth knowing independently of the eval.

### Leaks, including the ones not closed

The news fetchers hardcode their window to `now()` in all three copies
(`backend/main.py:488`, `frontend/lib/newsapi.ts:50`, and its duplicate), and
`src/data_fetcher.py:50` fetches a trailing window from today with no `end`. The
harness does not use those paths: it takes an explicit as-of date, requests news
ending strictly before it, re-verifies every article's `publishedAt`, and raises
rather than proceeding. `make news-audit` re-checks the product source so a new
now-anchored call site cannot slip in unnoticed.

Three leaks are **not** closed, and no number produced here should be read
without them:

- **Fundamentals are not point-in-time.** `compute_quality_score` reads current
  margins and market cap whatever the as-of date. Quality is pinned to neutral
  50 for the eval, removing 20% of RocketScore's weight. Identical across arms,
  so the comparison holds; absolute scores are not comparable to production.
- **`data/macro_trends.json` was written with hindsight** and applied unchanged
  to every as-of date. 10% of the score.
- **The model's training data postdates every as-of date.** This is the big one
  and it cannot be fixed, only bounded. When DeepSeek reasons about a September
  2025 setup it may be recalling the outcome rather than predicting it, and
  nothing here can tell the difference. The dates are pushed as late as the
  3-month label window allows to shrink the exposure, but shrinking is not
  removing, and older dates are more contaminated. Every absolute number this
  harness produces is an optimistic ceiling. Arm-vs-arm comparison is the more
  trustworthy read, since all arms carry the same contamination.

### How results will be reported

Five seeds per arm, mean ± sd with the [min, max] range on every metric. The
report only calls something a win when the two arms' seed ranges are disjoint:
the better arm's worst run still beating the worse arm's best. Anything short of
that prints as *"inside the noise, not a result"*. If the debate does not beat
the single call, `results/summary.md` will say so in those words.

Full method, metric definitions and caveats: [`evals/README.md`](evals/README.md).

---

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
