# 🚀 RocketShip - Multi-Agent Stock Discovery System

An AI-powered stock screening system that finds 2-6x opportunities using technical analysis, macro trends, and a 5-agent debate framework.

## Architecture

**Split Architecture:**
- **Frontend (Vercel)**: Next.js 16 App Router - Thin proxy to backend, UI only
- **Backend (Fly.io)**: FastAPI Python service - Handles all compute (RocketScore, debate, optimization)
- **Storage**: Abstracted layer supporting local filesystem, Vercel Blob, or `/tmp` ephemeral storage

## Features

- **Discovery Engine**: Screens 493 S&P 500 stocks (ex-MAG7) using RocketScore algorithm
- **Multi-Agent Analysis**: 5 AI agents (Bull, Bear, Regime, Volume, Judge) debate each stock
- **Portfolio Allocation**: Automated position sizing based on conviction and RocketScore
- **Cost Efficient**: ~$0.03 per full run using DeepSeek API
- **Web Interface**: Next.js frontend with real-time progress tracking
- **Production Ready**: Optimized for Vercel (frontend) + Fly.io (backend) deployment

## Installation

### Local Development

```bash
# Install Python dependencies
pip install -r requirements.txt

# Install frontend dependencies
cd frontend
npm install
```

## Configuration

### Local Development

Create a `.env` file in the project root:

```env
DEEPSEEK_API_KEY=your-api-key-here
NEWS_API_KEY=your-news-api-key-here
```

Create a `frontend/.env.local` file:

```env
DEEPSEEK_API_KEY=your-api-key-here
NEWS_API_KEY=your-news-api-key-here
```

### Vercel Deployment (Frontend)

**Prerequisites:**
1. Deploy backend to Fly.io first (see [Backend Deployment](#backend-deployment-flyio) below)
2. Note your Fly.io backend URL (e.g., `https://rocketship-backend.fly.dev`)

**Steps:**
1. **Set Environment Variables** in Vercel Dashboard:
   - Go to Project Settings → Environment Variables
   - Add `PY_BACKEND_URL` = `https://your-backend.fly.dev` (your Fly.io backend URL)
   - Add `DEEPSEEK_API_KEY` (if using legacy local mode)
   - Add `NEWS_API_KEY` (if using legacy local mode)
   - **Optional**: Add `BLOB_READ_WRITE_TOKEN` for persistent blob storage
   - **Important**: Use actual values, not secret references

2. **Import Settings**:
   - Framework Preset: **Next.js** (auto-detected)
   - Root Directory: **`frontend`** ⚠️ **Critical**
   - Build Command: `npm run build` (default)
   - Output Directory: `.next` (default)

3. **Deploy**:
   - Push to connected Git branch, or
   - Import repository and deploy

**Storage on Vercel:**
- If `BLOB_READ_WRITE_TOKEN` is set: Uses Vercel Blob Storage (persistent)
- Otherwise: Uses `/tmp` directory (ephemeral, cleared between invocations)
- All filesystem operations are abstracted through `frontend/src/lib/storage.ts`
- **Note**: When using Fly.io backend, artifacts are stored on Fly.io volume, not Vercel

See [QUICKSTART.md](./QUICKSTART.md) for detailed deployment instructions.

## Quick Start

### 1. Run Historical Study (One-time)

Analyze 2020-2025 rocket patterns:

```bash
python scripts/run_rocket_study.py
```

This creates `data/rocket_patterns.json` with insights from historical 100%+ gainers.

### 2. Run Full Pipeline

Screen stocks, run agent analysis, allocate portfolio:

```bash
python run.py
```

**Note:** Full pipeline takes 15-20 minutes on first run. Subsequent runs are faster due to caching.

## Pipeline Steps

### Step 1: Discovery (5-10 min)
- Fetches data for ~493 stocks
- Computes technical signals (10 indicators per stock)
- Calculates RocketScore (technical 60% + macro 40%)
- Ranks and selects top 25 candidates

### Step 2: Agent Analysis (10-15 min)
- Runs 5 AI agents on each of the top 25 stocks:
  - **Bull Agent**: Finds 2-6x upside opportunities
  - **Bear Agent**: Identifies fatal flaws and risks
  - **Skeptic Agent**: Validates signal quality
  - **Regime Agent**: Provides macro context
  - **Judge Agent**: Makes final decision (ENTER/WAIT/KILL)

### Step 3: Portfolio Allocation (<1 min)
- Filters to ENTER verdicts only
- Allocates $10,000 portfolio weighted by RocketScore × Conviction
- Applies 5-20% position size constraints

## Output Structure

```
runs/{timestamp}/
├── all_ranked.csv           # All ~493 stocks ranked by RocketScore
├── top_25.json              # Top 25 candidates with full details
├── portfolio.csv            # Allocated positions
├── portfolio_summary.md     # Portfolio summary
└── memos/                   # Individual stock analysis memos
    ├── AMD.md
    ├── NVDA.md
    └── ... (25 files)
```

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

### Test Individual Components

```bash
# Test universe
python src/universe.py

# Test data fetcher
python src/data_fetcher.py

# Test signals
python src/signals.py

# Test rocket score
python src/rocket_score.py

# Test agents (requires API key)
python src/agents.py
```

## RocketScore Algorithm

**Formula:** `0.6 × Technical + 0.4 × Macro`

**Technical Components (0-100):**
- Momentum (35%): 20d/60d price changes + acceleration
- Volume (25%): Volume surge detection
- Trend (25%): SMA crossovers + distance from 52w high
- Quality (15%): Volatility penalties

**Macro Score (0-100):**
- Sum of confidence scores for matching macro trends
- Sectors aligned with AI, Healthcare, Industrials, etc.

## Cost Breakdown

Using DeepSeek API:
- Discovery: $0 (no API calls)
- 25 stocks × 5 agents × ~200 tokens = ~25,000 tokens
- DeepSeek cost: ~$0.03 per full run

## Development

### Backend (Python)
- Python 3.9+
- FastAPI, uvicorn
- pandas, numpy, yfinance
- httpx (async HTTP client)
- rich>=13.0.0 (terminal UI, optional)
- DeepSeek API (LLM)

**Key Improvements:**
- ✅ S&P 500 ticker fetching uses `httpx` + `StringIO` (fixed bytes-as-path bug)
- ✅ Fallback to `backend/data/sp500_fallback.csv` if Wikipedia fails
- ✅ Status updates immediately with correct `total` count
- ✅ Progress tracking with `done/total` increments per ticker
- ✅ Clean error messages (no HTML dumps in status)

### Frontend (Next.js)
- Next.js 16.1.4 (App Router)
- React 19
- TypeScript 5
- Tailwind CSS 4
- Node.js 20+ compatible

**Key Improvements:**
- ✅ Storage abstraction for Vercel compatibility
- ✅ All filesystem operations go through `src/lib/storage.ts`
- ✅ Automatic environment detection (`process.env.VERCEL === "1"`)
- ✅ Supports Vercel Blob Storage or `/tmp` fallback

### Build & Test

```bash
# Test frontend build
cd frontend
npm install
npm run build

# Test Python backend locally
cd backend
pip install -r requirements.txt
DATA_DIR=../runs python main.py

# Test S&P 500 ticker fetching
python backend/tests/test_sp500_fetch.py
```

## Deployment

### Architecture Overview

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

### Frontend Deployment (Vercel)

**Configuration:**
- Framework Preset: **Next.js** (auto-detected)
- Root Directory: **`frontend`**
- Build Command: `npm run build` (default)
- Output Directory: `.next` (default)

**Environment Variables (Vercel Dashboard):**
- `DEEPSEEK_API_KEY` - DeepSeek API key (if using legacy local mode)
- `NEWS_API_KEY` - NewsAPI key (if using legacy local mode)
- `PY_BACKEND_URL` - **Required**: Fly.io backend URL (e.g., `https://rocketship-backend.fly.dev`)
- `BLOB_READ_WRITE_TOKEN` - Optional: Vercel Blob Storage token for persistent storage

**Deployment Checklist:**
1. ✅ Set `PY_BACKEND_URL` to your Fly.io backend URL
2. ✅ Set `DEEPSEEK_API_KEY` and `NEWS_API_KEY` (if using legacy mode)
3. ✅ Optionally set `BLOB_READ_WRITE_TOKEN` for persistent storage
4. ✅ Configure root directory to `frontend`
5. ✅ Deploy and verify build succeeds

### Backend Deployment (Fly.io)

See [backend/README_DEPLOY.md](./backend/README_DEPLOY.md) for complete Fly.io deployment guide.

**Quick Deploy:**
```bash
# From repo root
fly deploy -c backend/fly.toml
```

**Environment Variables (Fly.io):**
- `DEEPSEEK_API_KEY` - DeepSeek API key for LLM debate (required)
- `DEEPSEEK_BASE_URL` - Optional: DeepSeek API URL (default: https://api.deepseek.com/v1)
- `DATA_DIR` - Optional: Data directory (default: /data)

**Key Features:**
- ✅ S&P 500 ticker fetching with Wikipedia + CSV fallback
- ✅ Status updates immediately with correct ticker count
- ✅ Progress tracking (`done/total`) updates per ticker
- ✅ Clean error messages (no HTML dumps)
- ✅ Persistent storage via Fly.io volume mount

### Storage Abstraction

The frontend uses a unified storage abstraction layer (`frontend/src/lib/storage.ts`) that automatically handles different environments:

- **Local Development**: Writes to `./runs/{runId}/` directory
- **Vercel (with Blob Token)**: Uses Vercel Blob Storage for persistent storage
- **Vercel (without Blob Token)**: Uses `/tmp/runs/{runId}/` for ephemeral storage

**Key Features:**
- ✅ No writes to read-only `/var/task` on Vercel
- ✅ Automatic environment detection via `process.env.VERCEL === "1"`
- ✅ All filesystem operations abstracted - no direct `fs.mkdir` or `fs.writeFile` calls
- ✅ Seamless switching between storage backends

**When using Fly.io backend:**
- Frontend proxies requests to Fly.io backend
- Backend handles all compute and writes to Fly.io volume (`/data/runs/`)
- Frontend serves artifacts via proxy to backend

### Environment Variable Handling

**Frontend (Vercel):**
- API routes check for `DEEPSEEK_API_KEY` and `NEWS_API_KEY` via `process.env`
- Missing keys return HTTP 500 with clear error messages:
  - `"Missing DEEPSEEK_API_KEY"`
  - `"Missing NEWS_API_KEY"`
- No secret references or placeholders in code

**Backend (Fly.io):**
- Uses `DEEPSEEK_API_KEY` from environment
- S&P 500 ticker fetching with fallback to `backend/data/sp500_fallback.csv`
- Robust error handling with clean error messages (no HTML dumps)

## Recent Fixes & Improvements

### Backend (Fly.io)
- **Fixed S&P 500 ticker fetching**: Replaced `urllib` + bytes with `httpx` + `StringIO` to fix "No such file or directory: b'<!DOCTYPE html...'" error
- **Added fallback**: Loads from `backend/data/sp500_fallback.csv` if Wikipedia fails
- **Fixed "stuck initializing"**: Status now immediately shows correct `total` and updates `done` as pipeline progresses
- **Improved error handling**: Clean error messages, no HTML dumps in status
- **Added rich dependency**: `rich>=13.0.0` in `backend/requirements.txt`

### Frontend (Vercel)
- **Storage abstraction**: All filesystem operations use `src/lib/storage.ts`
- **Vercel compatibility**: Automatically uses `/tmp` or Vercel Blob based on environment
- **Environment variables**: Proper handling of `DEEPSEEK_API_KEY` and `NEWS_API_KEY`
- **Error messages**: API routes return HTTP 500 with clear messages when keys missing

## License

Research tool for educational purposes. Not investment advice.
