# RocketShip - Quick Start Guide

## Prerequisites

- **Python 3.9+** with pip
- **Node.js 20+** with npm
- **Bash** shell (Linux, macOS, WSL, Git Bash)

## Deployment Options

### Option 1: Vercel Deployment (Recommended)

See [Vercel Deployment](#vercel-deployment) section below for production deployment.

### Option 2: Local Development

Follow the setup steps below for local development.

## Setup

### 1. Install Python dependencies

```bash
pip install -r requirements.txt
```

### 2. Install Frontend dependencies

```bash
cd frontend
npm install
cd ..
```

### 3. Create environment files

**Project root `.env`** (for Python backend):
```bash
cat > .env << 'EOF'
DEEPSEEK_API_KEY=your_api_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
EOF
```

**Frontend `.env.local`** (for Next.js):
```bash
cat > frontend/.env.local << 'EOF'
DEEPSEEK_API_KEY=your_api_key_here
NEWS_API_KEY=your_news_api_key_here
EOF
```

**Note:** 
- Without a valid DeepSeek API key, the debate stage will use mock data
- NEWS_API_KEY is optional but recommended for news fetching

## Running the Application

### Start the Frontend Dev Server

```bash
cd frontend
npm run dev
```

The app will be available at **http://localhost:3000**

## User Journey

1. **Welcome** - Click "Start"
2. **Setup** - Choose "S&P 500" or "Import List" with custom tickers
3. **RocketScore Loading** - Watch rocket animation with real progress
4. **Dashboard** - View sortable table of results
5. **Debate** - Run DeepSeek agents, see BUY/HOLD/WAIT verdicts
6. **Stock Detail** - View Bull/Bear/Regime/Volume agents + Judge verdict
7. **Optimization** - Run portfolio optimizer
8. **Results** - View allocations and sector breakdown

## Testing

### Run E2E Test Script

```bash
# Start frontend first (in another terminal)
cd frontend && npm run dev

# Run test (in project root)
chmod +x test_flow.sh
./test_flow.sh
```

### Manual Test Flow

1. Open http://localhost:3000
2. Click "Start"
3. Select "Import List"
4. Paste: `NVDA, AMD, TSLA`
5. Click "Run RocketScore"
6. Watch rocket animation + progress
7. View dashboard table
8. Click "Run Debate (DeepSeek)"
9. View BUY/HOLD/WAIT sections
10. Click any stock card to see agents
11. Click "Next: Optimize Portfolio"
12. View allocation results

### Test SSE Endpoint

```bash
curl -N http://localhost:3000/api/run/test_run_001/events
```

You should see:
```
data: {"type":"status","data":{"runId":"test_run_001",...}}
data: {"type":"log","data":"[timestamp] message..."}
: heartbeat
```

### Test Artifact Serving

```bash
curl http://localhost:3000/api/runs/test_run_001/rocket_scores.json
```

## Artifacts

After a successful run, check `runs/{runId}/`:

```
runs/{runId}/
├── status.json          # Run state and progress
├── universe.json        # Input configuration
├── rocket_scores.json   # RocketScore results
├── debate/
│   ├── NVDA.json        # Per-stock debate
│   ├── AMD.json
│   └── TSLA.json
├── debate_summary.json  # BUY/HOLD/WAIT lists
├── portfolio.json       # Optimizer output
└── logs.txt             # Execution logs
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/run` | Create new run |
| GET | `/api/run/{runId}/status` | Get run status |
| GET | `/api/run/{runId}/events` | SSE stream |
| POST | `/api/run/{runId}/debate` | Run debate stage |
| POST | `/api/run/{runId}/optimize` | Run optimization |
| GET | `/api/runs/{runId}/{file}` | Serve artifacts |

## Troubleshooting

### Frontend won't start

```bash
cd frontend
rm -rf node_modules .next
npm install
npm run dev
```

### Python errors

```bash
pip install -r requirements.txt
python -c "import pandas; import yfinance; print('OK')"
```

### SSE not working

The frontend automatically falls back to polling. Check browser console for errors.

### "File not found" errors

Ensure the run completed successfully:

```bash
cat runs/{runId}/status.json
cat runs/{runId}/logs.txt
```

## Vercel Deployment

### Prerequisites

1. Vercel account (free tier works)
2. Git repository (GitHub, GitLab, or Bitbucket)
3. API keys ready:
   - DeepSeek API key
   - NewsAPI key

### Deployment Steps

1. **Import Project to Vercel**
   - Go to [vercel.com](https://vercel.com)
   - Click "Add New Project"
   - Import your Git repository

2. **Configure Project Settings**
   - **Framework Preset**: Next.js (auto-detected)
   - **Root Directory**: `frontend` ⚠️ **Important**
   - **Build Command**: `npm run build` (default)
   - **Output Directory**: `.next` (default)
   - **Install Command**: `npm install` (default)

3. **Set Environment Variables**
   - Go to Project Settings → Environment Variables
   - Add the following:
     ```
     DEEPSEEK_API_KEY = your_actual_deepseek_key_here
     NEWS_API_KEY = your_actual_newsapi_key_here
     ```
   - **Important**: Use actual key values, NOT secret references like `@secret_name`
   - Apply to: Production, Preview, Development (or as needed)

4. **Deploy**
   - Click "Deploy"
   - Wait for build to complete
   - Verify deployment:
     - Home page loads at `/`
     - API routes return proper responses
     - Missing keys return HTTP 500 with clear error messages

### Verification

After deployment, test these endpoints:

```bash
# Check API key status (should show key info, not errors)
curl https://your-app.vercel.app/api/debug/keys

# Test DeepSeek connection (requires valid key)
curl https://your-app.vercel.app/api/debug/deepseek

# Test NewsAPI connection (requires valid key)
curl https://your-app.vercel.app/api/debug/news
```

### Troubleshooting

**Build fails:**
- Ensure root directory is set to `frontend`
- Check that `package.json` exists in `frontend/`
- Verify `npm install` completes successfully

**API routes return 500:**
- Check environment variables are set correctly
- Verify keys are actual values, not placeholders
- Check Vercel function logs for detailed errors

**Home page doesn't load:**
- Verify `app/page.tsx` exists
- Check build logs for TypeScript errors
- Ensure no runtime errors in server logs

## Architecture

- **Frontend**: Next.js 16.1.4 App Router
- **Backend**: Next.js API Routes (no separate server)
- **Python**: Spawned as child processes for RocketScore and optimization
- **Data**: Artifacts stored in `runs/{runId}/` folder
- **Design**: CSS Modules with design tokens (`src/styles/tokens.css`)
- **Deployment**: Optimized for Vercel with root directory = `/frontend`

## Design System

All styling uses tokens from `frontend/src/styles/tokens.css`:

- Colors: `--color-*`
- Spacing: `--space-*`
- Typography: `--font-size-*`, `--font-weight-*`
- Border radii: `--radius-sm`, `--radius-md`
- Animation: `--duration-*`, `--ease-*`

No gradients, glows, or sparkles. Minimal, institutional aesthetic.
