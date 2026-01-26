# RocketShip System Overview

## What RocketShip Does (60 Seconds)

RocketShip is an AI-powered stock discovery and portfolio construction system that:

1. **Scores** the entire S&P 500 (or custom universe) using a proprietary "RocketScore" algorithm combining technical momentum, volume flow, quality metrics, and macro alignment
2. **Debates** the top candidates using multi-agent AI (Bull, Bear, Regime, Volume analysts + a Judge) powered by DeepSeek, incorporating real-time news context
3. **Selects** the highest-conviction BUY candidates through AI-driven debate verdicts
4. **Optimizes** the final portfolio using CVXPY convex optimization with risk and sector constraints
5. **Backtests** the optimized portfolio against equal-weight and SPY benchmarks

**Key differentiators**: Institutional-grade reasoning (not just scores), explicit evidence citation, cross-agent disagreement resolution, and full audit trail.

---

## Pipeline Stages

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   ROCKETSCORE   │───▶│     DEBATE      │───▶│   FINAL BUYS    │───▶│    OPTIMIZE     │
│   (Screening)   │    │  (Multi-Agent)  │    │   (Selection)   │    │  (Allocation)   │
└─────────────────┘    └─────────────────┘    └─────────────────┘    └─────────────────┘
     ~3 min               ~15-25 min              Automatic              ~1-2 min
    493 stocks            40 stocks              8-12 stocks            8-12 stocks
```

### Stage 1: RocketScore (Screening)

**Input**: Stock universe (S&P 500 or custom tickers)

**Process**:
- Fetches 252 days of OHLCV data via yfinance
- Computes 10+ technical indicators (momentum, trend, moving averages)
- Calculates composite RocketScore using weighted formula:
  - 45% Technical (momentum, trend slope, MA crossovers)
  - 25% Volume (surge ratio, z-score, up/down ratio)
  - 20% Quality (margins, FCF yield, growth)
  - 10% Macro (sector alignment, trend bonuses)

**Output**: `rocket_scores.json` with all tickers ranked by score

### Stage 2: Debate (Multi-Agent Analysis)

**Input**: Top 40 RocketScore candidates (25 top + 10 near-cutoff + 5 best-of-worst)

**Process**:
1. Fetches news articles (last 14 days) via NewsAPI for each ticker
2. Runs 4 specialist agents IN PARALLEL:
   - **Bull Agent**: Long thesis with evidence and catalysts
   - **Bear Agent**: Short thesis with risks and concerns
   - **Regime Agent**: Market regime classification (risk-on/off/neutral)
   - **Volume Agent**: Flow assessment (accumulation/distribution)
3. Runs **Judge Agent** SEQUENTIALLY with all inputs
4. Judge issues final verdict: BUY / HOLD / SELL with confidence (0-100)

**Output**:
- Individual debate files: `debate/{TICKER}.json`
- Summary: `debate_summary.json`

### Stage 3: Final Buys (Selection)

**Input**: Debate results

**Process**:
- Filters to BUY-only verdicts
- Ranks by confidence and consensus score
- Caps at 8-12 positions

**Output**: `final_buys.json`

### Stage 4: Optimize (Portfolio Construction)

**Input**: Final buys tickers

**Process**:
- Fetches 252-day returns for covariance estimation
- Solves convex optimization problem via CVXPY:
  ```
  Maximize: w·μ - λ·(w'Σw)
  Subject to:
    - sum(w) ≤ 1
    - 0 ≤ w_i ≤ 12%
    - sector_weight ≤ 35%
  ```
- Computes backtest metrics (return, volatility, Sharpe, max drawdown)

**Output**: `portfolio.json`

---

## Data Sources

| Source | Purpose | API Key Required |
|--------|---------|------------------|
| **yfinance** | Price, volume, fundamental data | No |
| **NewsAPI** | Recent news headlines for debate context | Yes (`NEWS_API_KEY`) |
| **DeepSeek** | LLM for multi-agent debate | Yes (`DEEPSEEK_API_KEY`) |

---

## Artifacts Structure

All artifacts are stored in `runs/{runId}/` where `runId` follows `YYYYMMDD_HHMMSS` format.

```
runs/20260126_143052/
├── status.json              # Current stage and progress
├── universe.json            # Input configuration (mode, tickers)
├── logs.txt                 # Timestamped execution logs
├── rocket_scores.json       # All stocks with RocketScore breakdown
├── debate_selection.json    # The 40 stocks selected for debate
├── debate/
│   ├── AAPL.json           # Full debate output for each ticker
│   ├── MSFT.json
│   ├── ...
│   ├── debate_summary.json  # BUY/HOLD/SELL summary
│   └── debate_error.json    # Errors (if any)
├── news/
│   ├── news_AAPL.json      # News articles per ticker
│   └── ...
├── final_buys.json          # Selected BUY candidates (8-12)
└── portfolio.json           # Optimized allocation with backtest
```

### Key Artifact Schemas

**status.json**:
```json
{
  "runId": "20260126_143052",
  "stage": "debate_ready",
  "progress": {
    "done": 40,
    "total": 40,
    "current": null,
    "message": "Debate complete: 15 BUY, 18 HOLD, 7 SELL"
  },
  "updatedAt": "2026-01-26T14:55:00Z"
}
```

**rocket_scores.json** (array):
```json
[
  {
    "ticker": "NVDA",
    "sector": "Technology",
    "rocket_score": 82.5,
    "technical_score": 88.2,
    "volume_score": 75.0,
    "quality_score": 79.4,
    "macro_score": 85.0,
    "current_price": 142.50,
    "tags": ["AI/ML leader", "Strong momentum"],
    "technical_details": { "raw_metrics": {...}, "rationale": [...] },
    "volume_details": {...},
    "quality_details": {...},
    "macro_details": {...}
  }
]
```

**debate/{TICKER}.json**:
```json
{
  "ticker": "NVDA",
  "agents": {
    "bull": { "thesis": "...", "key_points": [...], "trend_map": [...] },
    "bear": { "thesis": "...", "key_points": [...], "trend_map": [...] },
    "regime": { "regime_classification": "risk-on", "supporting_signals": [...] },
    "volume": { "flow_assessment": "accumulation", "volume_signals": [...] }
  },
  "judge": {
    "verdict": "BUY",
    "confidence": 78,
    "reasoning": "...",
    "agreed_with": { "bull": [...], "bear": [...] },
    "rejected": { "bull": [...], "bear": [...] },
    "decision_triggers": [...]
  },
  "cross_exam": [],
  "context": {...},
  "data_sources": ["yfinance", "newsapi", "RocketScore"],
  "warnings": []
}
```

**portfolio.json**:
```json
{
  "capital": 10000,
  "constraints": {
    "max_weight": 0.12,
    "sector_cap": 0.35
  },
  "allocations": [
    { "ticker": "NVDA", "weight": 0.12, "dollars": 1200, "sector": "Technology" }
  ],
  "sector_breakdown": [
    { "sector": "Technology", "weight": 0.35 }
  ],
  "backtest": {
    "total_return_pct": 15.2,
    "annualized_vol_pct": 18.5,
    "sharpe_ratio": 1.42,
    "max_drawdown_pct": -8.3,
    "series": {
      "dates": [...],
      "optimized": [...],
      "equal_weight": [...],
      "spy": [...]
    }
  }
}
```

---

## How to Reproduce a Run Locally

### Prerequisites

1. **Python 3.10+** with dependencies:
   ```bash
   cd rocketship
   pip install -r requirements.txt
   ```

2. **Node.js 18+** with dependencies:
   ```bash
   cd frontend
   npm install
   ```

3. **Environment variables** (create `frontend/.env.local`):
   ```env
   DEEPSEEK_API_KEY=sk-your-deepseek-key
   NEWS_API_KEY=your-newsapi-key
   ```

### Running the Full Pipeline

1. **Start the frontend**:
   ```bash
   cd frontend
   npm run dev
   ```

2. **Open browser**: http://localhost:3000

3. **Create a run**:
   - Click "Start" on homepage
   - Select "S&P 500" or upload custom tickers
   - Wait for RocketScore to complete (~3 minutes)

4. **Run debate**:
   - Click "Run Full Debate" on the RocketScore dashboard
   - Wait for all 40 stocks to be debated (~15-25 minutes)

5. **View final buys**:
   - Navigate to Final Buys page after debate completes

6. **Optimize**:
   - Click "Optimize Portfolio" on Final Buys page
   - View allocation, backtest charts, and export JSON

### CLI Alternative (RocketScore only)

```bash
cd rocketship
python run_discovery_with_artifacts.py --mode sp500
# Or with custom tickers:
python run_discovery_with_artifacts.py --tickers AAPL,MSFT,GOOG,AMZN
```

---

## How to Interpret Results

### RocketScore Breakdown

| Score Range | Interpretation |
|-------------|----------------|
| 80-100 | Exceptional momentum and quality alignment |
| 65-79 | Strong candidate, likely debate-worthy |
| 50-64 | Average, may need catalyst |
| 30-49 | Below average, likely structural issues |
| 0-29 | Avoid - multiple red flags |

**Component weights**:
- **Technical (45%)**: Rewards strong momentum, trend continuation, MA support
- **Volume (25%)**: Rewards accumulation patterns, high conviction moves
- **Quality (20%)**: Rewards profitability, cash generation, growth
- **Macro (10%)**: Bonuses for sector alignment with macro themes

### Debate Verdicts

| Verdict | Meaning | Confidence Guideline |
|---------|---------|---------------------|
| **BUY** | Strong conviction to add to portfolio | >70% typical |
| **HOLD** | Neutral - not compelling either way | 50-70% typical |
| **SELL** | Avoid or exit position | <50% typical |

**Judge decision factors**:
- Agreement/disagreement between Bull and Bear
- Regime alignment (does macro support the thesis?)
- Volume confirmation (is smart money accumulating?)
- News sentiment and catalysts

### Optimizer Output

**Allocation interpretation**:
- Weights sum to ~100% (small cash buffer allowed)
- No position exceeds 12% (risk management)
- No sector exceeds 35% (diversification)

**Backtest metrics**:
- **Total Return**: Cumulative return over lookback period
- **Volatility**: Annualized standard deviation
- **Sharpe Ratio**: Risk-adjusted return (>1 is good, >2 is excellent)
- **Max Drawdown**: Worst peak-to-trough decline

---

## Vercel Deployment

### Required Environment Variables

Set these in Vercel project settings:

```
DEEPSEEK_API_KEY=sk-your-deepseek-key
NEWS_API_KEY=your-newsapi-key
```

### Storage Configuration

For production deployments, RocketShip uses a storage abstraction layer that automatically:
- Uses **Vercel Blob Storage** in production (serverless-compatible)
- Uses **local filesystem** in development

Set `BLOB_READ_WRITE_TOKEN` in Vercel for blob storage.

### Deploy Steps

1. Push code to GitHub
2. Connect repository to Vercel
3. Set environment variables in Vercel dashboard
4. Deploy

The `vercel.json` configuration handles routing and serverless function limits.

---

## Security Notes

See `SECURITY.md` for full security documentation including:
- Rate limiting configuration
- Input validation rules
- API key handling
- Security headers

---

## Troubleshooting

### Common Issues

**"DEEPSEEK_API_KEY not configured"**:
- Ensure key is set in `frontend/.env.local`
- Restart the dev server after changing env vars

**"NewsAPI error 401"**:
- Check NewsAPI key validity
- Free tier has limited requests/day

**Optimization fails**:
- Ensure final_buys.json exists and has items
- Check Python dependencies are installed
- Review logs.txt for detailed errors

**Debate hangs**:
- Check network connectivity
- DeepSeek API may be rate-limited
- Review browser console for errors
