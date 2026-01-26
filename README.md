# 🚀 RocketShip - Multi-Agent Stock Discovery System

An AI-powered stock screening system that finds 2-6x opportunities using technical analysis, macro trends, and a 5-agent debate framework.

## Features

- **Discovery Engine**: Screens 493 S&P 500 stocks (ex-MAG7) using RocketScore algorithm
- **Multi-Agent Analysis**: 5 AI agents (Bull, Bear, Skeptic, Regime, Judge) debate each stock
- **Portfolio Allocation**: Automated position sizing based on conviction and RocketScore
- **Cost Efficient**: ~$0.03 per full run using DeepSeek API
- **Web Interface**: Next.js frontend with real-time progress tracking
- **Vercel Ready**: Optimized for deployment on Vercel

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

### Vercel Deployment

1. **Set Environment Variables** in Vercel Dashboard:
   - Go to Project Settings → Environment Variables
   - Add `DEEPSEEK_API_KEY` with your actual API key
   - Add `NEWS_API_KEY` with your actual API key
   - **Optional**: Add `BLOB_READ_WRITE_TOKEN` for persistent blob storage (recommended for production)
   - **Important**: Use actual values, not secret references

2. **Import Settings**:
   - Framework Preset: **Next.js** (auto-detected)
   - Root Directory: **`frontend`**
   - Build Command: `npm run build` (default)
   - Output Directory: `.next` (default)

3. **Deploy**:
   - Push to connected Git branch, or
   - Import repository and deploy

**Storage on Vercel:**
- If `BLOB_READ_WRITE_TOKEN` is set: Uses Vercel Blob Storage (persistent)
- Otherwise: Uses `/tmp` directory (ephemeral, cleared between invocations)
- All filesystem operations are abstracted through `frontend/src/lib/storage.ts`

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

### Backend
- Python 3.9+
- pandas, numpy, yfinance
- pydantic-settings
- httpx (async API client)
- rich (terminal UI)
- DeepSeek API (LLM)

### Frontend
- Next.js 16.1.4 (App Router)
- React 19
- TypeScript 5
- Tailwind CSS 4
- Node.js 20+ compatible

### Build & Test

```bash
# Test frontend build
cd frontend
npm install
npm run build

# Test Python backend
python run.py
```

## Deployment

### Vercel Deployment Checklist

1. ✅ Set environment variables in Vercel dashboard:
   - `DEEPSEEK_API_KEY`
   - `NEWS_API_KEY`

2. ✅ Configure project:
   - Root Directory: `frontend`
   - Framework: Next.js

3. ✅ Verify deployment:
   - Build succeeds
   - Home page (`/`) loads
   - API routes return proper errors if keys missing

### Environment Variable Handling

- All API routes check for `DEEPSEEK_API_KEY` and `NEWS_API_KEY` via `process.env`
- Missing keys return HTTP 500 with clear error messages:
  - `"Missing DEEPSEEK_API_KEY"`
  - `"Missing NEWS_API_KEY"`
- No secret references or placeholders in code

### Storage Abstraction

The application uses a unified storage abstraction layer (`frontend/src/lib/storage.ts`) that automatically handles different environments:

- **Local Development**: Writes to `./runs/{runId}/` directory
- **Vercel (with Blob Token)**: Uses Vercel Blob Storage for persistent storage
- **Vercel (without Blob Token)**: Uses `/tmp/runs/{runId}/` for ephemeral storage

All API routes use the storage abstraction - no direct filesystem calls. This ensures:
- ✅ No writes to read-only `/var/task` on Vercel
- ✅ Automatic environment detection via `process.env.VERCEL === "1"`
- ✅ Seamless switching between storage backends

## License

Research tool for educational purposes. Not investment advice.
