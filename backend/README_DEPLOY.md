# RocketShip Backend Deployment Guide

This guide covers deploying the RocketShip backend to Fly.io.

## Architecture Overview

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
│  │   GET  /run/{id}/artifact/{file} - Get artifact        │ │
│  │   POST /run/{id}/debate - Start debate pipeline        │ │
│  │   POST /run/{id}/optimize - Start optimization         │ │
│  │   GET  /health        - Health check                   │ │
│  │                                                         │ │
│  │   ┌─────────────────────────────────────────────────┐   │ │
│  │   │  /data/runs/{runId}/                            │   │ │
│  │   │    ├── status.json                              │   │ │
│  │   │    ├── rocket_scores.json                       │   │ │
│  │   │    ├── debate/                                  │   │ │
│  │   │    ├── final_buys.json                          │   │ │
│  │   │    └── portfolio.json                           │   │ │
│  │   └─────────────────────────────────────────────────┘   │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

## Prerequisites

1. [Fly.io CLI](https://fly.io/docs/hands-on/install-flyctl/) installed
2. Fly.io account (free tier works)
3. DeepSeek API key (for debate feature)

## Step 1: Deploy Backend to Fly.io

```bash
# Navigate to repo root (NOT backend directory)
cd rocketship

# Login to Fly.io
fly auth login

# Create the app (first time only)
fly apps create rocketship-backend

# Create persistent volume for run artifacts (first time only)
fly volumes create rocketship_data --region sjc --size 10

# Set environment variables
fly secrets set DEEPSEEK_API_KEY=sk-your-deepseek-key

# Deploy (from repo root, using the backend config)
# IMPORTANT: Must run from repo root, not backend directory
cd rocketship
fly deploy -c backend/fly.toml
```

## Step 2: Verify Deployment

```bash
# Check app status
fly status

# Check health endpoint
curl https://rocketship-backend-ammar1.fly.dev/health

# View logs
fly logs
```

## Step 3: Configure Vercel Frontend

Add the backend URL to Vercel environment variables:

1. Go to your Vercel project settings
2. Navigate to Environment Variables
3. Add: `PY_BACKEND_URL` = `https://rocketship-backend-ammar1.fly.dev`
4. Redeploy the frontend

## Environment Variables

### Fly.io Backend

| Variable | Required | Description |
|----------|----------|-------------|
| `DEEPSEEK_API_KEY` | Yes | DeepSeek API key for LLM debate |
| `DEEPSEEK_BASE_URL` | No | DeepSeek API URL (default: https://api.deepseek.com/v1) |
| `DATA_DIR` | No | Data directory (default: /data) |
| `PORT` | No | Server port (default: 8000) |

### Vercel Frontend

| Variable | Required | Description |
|----------|----------|-------------|
| `PY_BACKEND_URL` | Yes | Fly.io backend URL (e.g., https://rocketship-backend.fly.dev) |
| `DEEPSEEK_API_KEY` | No | Only needed if running legacy local mode |
| `NEWS_API_KEY` | No | NewsAPI key for news fetching |

## Scaling

### Fly.io

```bash
# Scale to multiple instances
fly scale count 2

# Scale up resources
fly scale vm shared-cpu-2x

# Scale memory
fly scale memory 4096
```

### Volume Management

```bash
# List volumes
fly volumes list

# Extend volume size
fly volumes extend vol_xxxxx -s 20
```

## Monitoring

### Fly.io Dashboard

Visit: https://fly.io/apps/rocketship-backend

### Logs

```bash
# Real-time logs
fly logs

# Filtered logs
fly logs --app rocketship-backend | grep ERROR
```

### Health Check

The backend exposes `/health` which returns:

```json
{
  "status": "ok",
  "timestamp": "2024-01-26T12:00:00Z",
  "data_dir": "/data",
  "runs_count": 5
}
```

## Troubleshooting

### Common Issues

1. **"Connection refused" from Vercel**
   - Check Fly.io app is running: `fly status`
   - Verify `PY_BACKEND_URL` is correct in Vercel

2. **"Artifact not found" errors**
   - Volume may not be mounted: `fly volumes list`
   - Check if run exists: `fly ssh console` then `ls /data/runs/`

3. **DeepSeek API errors**
   - Verify API key: `fly secrets list`
   - Check key is valid at platform.deepseek.com

4. **Slow pipeline execution**
   - Scale up resources: `fly scale vm shared-cpu-2x`
   - yfinance fetches can be slow - this is expected

### Troubleshooting S&P 500 Ticker Fetch

If you see errors like:
- `"Failed to fetch S&P 500 tickers: [Errno 2] No such file or directory: b'<!DOCTYPE html>...'"`
- `"No tables found in Wikipedia HTML"`
- `"Wikipedia table structure changed"`

**Root Cause:**
The backend fetches S&P 500 tickers from Wikipedia. If Wikipedia is down, blocked, or the page structure changes, the fetch fails.

**Solutions:**

1. **Check Wikipedia Access**
   ```bash
   # SSH into Fly.io instance
   fly ssh console
   
   # Test Wikipedia access
   curl -H "User-Agent: Mozilla/5.0" https://en.wikipedia.org/wiki/List_of_S%26P_500_companies
   ```

2. **Verify Fallback CSV Exists**
   ```bash
   fly ssh console
   ls -la /app/backend/data/sp500_fallback.csv
   ```
   
   The fallback CSV should contain ~500 tickers. If missing, the code will raise a clear error.

3. **Check Logs for Details**
   ```bash
   fly logs | grep -i "sp500\|ticker\|wikipedia"
   ```
   
   Look for:
   - `"[OK] Fetched X S&P 500 tickers from Wikipedia"` - Success
   - `"[OK] Loaded X S&P 500 tickers from fallback CSV"` - Fallback used
   - `"[ERROR] All S&P 500 ticker sources failed"` - Both failed

4. **Manual Fallback Test**
   ```bash
   # Test the function directly
   fly ssh console
   python -c "from src.universe import get_sp500_tickers; print(len(get_sp500_tickers()))"
   ```

5. **Update Fallback CSV (if needed)**
   If Wikipedia structure changes permanently, update `backend/data/sp500_fallback.csv`:
   - One ticker per line
   - Column header: `ticker`
   - Tickers should be uppercase, dots replaced with dashes (BRK-B not BRK.B)
   - Should contain 490-510 tickers

**Expected Behavior:**
- Primary: Fetches from Wikipedia using httpx with proper headers
- Fallback: If Wikipedia fails, loads from `backend/data/sp500_fallback.csv`
- Error: If both fail, returns clear error message in run status

### SSH Access

```bash
# Connect to running instance
fly ssh console

# Navigate to data
cd /data/runs
ls -la

# View a specific run
cat 20240126_120000/status.json
```

## Local Development

For local development without deploying:

```bash
# Run backend locally
cd backend
pip install -r requirements.txt
DATA_DIR=../runs python main.py

# Frontend will use local mode if PY_BACKEND_URL is not set
cd frontend
npm run dev
```

## CI/CD

Add to your GitHub Actions workflow:

```yaml
name: Deploy Backend

on:
  push:
    branches: [main]
    paths:
      - 'backend/**'
      - 'src/**'

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: superfly/flyctl-actions/setup-flyctl@master
      - run: flyctl deploy -c backend/fly.toml --remote-only
        env:
          FLY_API_TOKEN: ${{ secrets.FLY_API_TOKEN }}
```

## Cost Estimate

Fly.io pricing (as of 2024):
- **Free tier**: 3 shared-cpu-1x VMs, 3GB storage
- **Volume storage**: $0.15/GB/month
- **Compute**: ~$5/month for shared-cpu-2x

Most demo use cases fit in free tier.
