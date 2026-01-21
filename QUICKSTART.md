# RocketShip - Quick Start Guide

## Prerequisites

- **Python 3.9+** with pip
- **Node.js 18+** with npm
- **Ubuntu/Linux** environment (or WSL on Windows)

## Environment Setup

### 1. Create `.env` file in project root

```bash
# DeepSeek API (required for debate stage)
DEEPSEEK_API_KEY=your_api_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1

# Optional: Override defaults
UNIVERSE=SP500_EX_MAG7
LOOKBACK_DAYS=252
TOP_N_CANDIDATES=25
```

### 2. Install Python dependencies

```bash
pip install -r requirements.txt
```

### 3. Install Frontend dependencies

```bash
cd frontend
npm install
cd ..
```

## Running the Application

### Start the Frontend Dev Server

```bash
cd frontend
npm run dev
```

The app will be available at **http://localhost:3000**

### Backend Execution

The backend (Python) is triggered automatically by the frontend via API routes. No separate backend server needed.

## User Journey Test Checklist

### ✅ Phase 1: RocketScore Analysis (Critical Path)

1. **Welcome Screen**
   - Open http://localhost:3000
   - Should see "RocketShip" title and "Start" button
   - Click "Start"

2. **Universe Selection**
   - Should navigate to `/setup`
   - See two options: "S&P 500" and "Import List"
   - **Test A: S&P 500 Mode**
     - Keep "S&P 500" selected
     - Click "Run RocketScore"
     - Should navigate to `/run/{runId}/rocket`
   - **Test B: Import Mode**
     - Click "Import List"
     - Paste tickers: `NVDA, AMD, TSLA, PLTR, COIN`
     - Click "Run RocketScore"
     - Should navigate to `/run/{runId}/rocket`

3. **RocketScore Loading**
   - Should see animated rocket 🚀 moving up
   - Progress bar showing X/Y stocks analyzed
   - Current ticker being processed
   - Elapsed timer counting up
   - Click "View Logs" to see real-time output
   - **When complete:** auto-navigates to `/run/{runId}` dashboard

4. **Dashboard**
   - Should see sortable table with all analyzed stocks
   - Columns: Ticker | Score | Sector | Tags | Price
   - Click column headers to sort (Score defaults to descending)
   - Score column shows visual bar + number
   - Click any row to drill down (not implemented in critical path)

## Verify Artifacts

After a successful run, check the `runs/{runId}/` folder:

```bash
ls -la runs/20260121_*/
```

Should contain:
- ✅ `status.json` - Run state and progress
- ✅ `universe.json` - Input configuration
- ✅ `rocket_scores.json` - Analysis results (used by dashboard)
- ✅ `logs.txt` - Execution logs
- ✅ `top_25.json` - Legacy format (kept for compatibility)
- ✅ `all_ranked.csv` - All stocks ranked

## Troubleshooting

### Frontend won't start
```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
npm run dev
```

### Python errors during run
- Check `.env` file exists and has valid format (UTF-8)
- Verify all dependencies installed: `pip install -r requirements.txt`
- Check logs: `cat runs/{runId}/logs.txt`

### "Run not found" error
- Ensure Python script completed successfully
- Check `runs/` folder exists and contains runId folder
- Verify `status.json` was created

### SSE (Server-Sent Events) not working
- Frontend automatically falls back to polling
- Check browser console for errors
- Verify `/api/run/{runId}/events` endpoint is accessible

### Static file serving (rocket_scores.json 404)
- Ensure `next.config.ts` has rewrites configured
- Restart dev server after config changes
- Verify file exists: `cat runs/{runId}/rocket_scores.json`

## Architecture Notes

### Critical Path Implementation Status

**✅ Completed:**
- Artifact contract (status.json, universe.json, rocket_scores.json, logs.txt)
- POST /api/run (creates run, spawns Python, streams logs)
- GET /api/run/[runId]/status (returns current status)
- GET /api/run/[runId]/events (SSE stream with polling fallback)
- Welcome page (/)
- Setup page (/setup)
- Rocket loading page (/run/[runId]/rocket) with animation + progress
- Dashboard page (/run/[runId]) with sortable table

**⏳ Not Yet Implemented (Phase 2+):**
- Debate stage (DeepSeek multi-agent analysis)
- Optimization stage (CVXPY portfolio allocation)
- Stock detail page with debate view
- Tabs on dashboard (RocketScore | Debate | Optimize)

### Design System

All UI uses design tokens from `frontend/src/styles/tokens.css`:
- No arbitrary colors/spacing
- Consistent border radii (2px, 4px only)
- Purposeful animations with easing curves
- No gradients, glows, or sparkles
- Analytical, institutional aesthetic

### Data Flow

1. User submits universe selection → POST /api/run
2. API creates runId folder, writes status.json + universe.json
3. API spawns Python process (non-blocking)
4. Python writes logs to logs.txt, updates status.json
5. Python writes rocket_scores.json when complete
6. Frontend polls/streams status via SSE
7. When status.stage != "rocket", navigates to dashboard
8. Dashboard reads rocket_scores.json and renders table

## Next Steps

After verifying the critical path works:

1. **Implement Debate Stage:**
   - POST /api/run/[runId]/debate
   - DeepSeek API integration
   - Write debate/{ticker}.json files
   - Debate dashboard UI

2. **Implement Optimization Stage:**
   - POST /api/run/[runId]/optimize
   - CVXPY integration
   - Write portfolio.json
   - Optimization results UI

3. **Stock Detail Page:**
   - Load debate/{ticker}.json
   - Show Bull/Bear/Regime/Volume agents
   - Show Judge verdict with rationale
   - Raw JSON collapsible

## Support

For issues, check:
1. Terminal output where `npm run dev` is running
2. Browser console (F12)
3. `runs/{runId}/logs.txt`
4. `runs/{runId}/status.json` (check for errors array)
