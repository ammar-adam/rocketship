# 🚀 RocketShip

*Institutional-grade stock screening, multi-agent AI debate, and portfolio optimization — in one pipeline.*

[![Python](https://img.shields.io/badge/Python-3.9+-3776AB?logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=next.js&logoColor=white)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://typescriptlang.org)
[![DeepSeek](https://img.shields.io/badge/DeepSeek-API-0D9488)](https://deepseek.com)
[![Vercel](https://img.shields.io/badge/Vercel-Deploy-000000?logo=vercel&logoColor=white)](https://vercel.com)
[![Fly.io](https://img.shields.io/badge/Fly.io-Backend-7C3AED)](https://fly.io)
[![Live](https://img.shields.io/badge/Live-Site-22C55E?style=flat-square)](https://rocketshipstocks.vercel.app)

Screens **493** S&P 500 stocks (ex-MAG7), runs **5** AI agents on the top **30** candidates, and builds an optimized portfolio from ENTER verdicts — **~$0.04/run**, **15–20 min** full pipeline. Built for engineers and quants who want a serious, reproducible research stack.

---

## How It Works

1. **🔍 Discovery** — Screens **493** S&P 500 stocks using RocketScore (technical + macro signals).
2. **🤖 Debate** — **5** AI agents (Bull, Bear, Regime, Value, Judge) debate the top **30** candidates.
3. **📊 Allocation** — CVXPY convex optimization builds a portfolio from ENTER verdicts.

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
| 🐂 Bull | Finds 2–6x upside with news citations |
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

---

*Research tool for educational purposes. Not investment advice.*
