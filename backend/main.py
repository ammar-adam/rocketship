"""
RocketShip Backend - FastAPI Service
=====================================
This service handles all Python compute for RocketShip:
- RocketScore pipeline (POST /run)
- Multi-agent debate (POST /run/{runId}/debate)
- Portfolio optimization (POST /run/{runId}/optimize)

All long-running jobs are executed in background tasks.
Artifacts are stored in /data/runs/{runId}/...
"""
import os
import json
import asyncio
from datetime import datetime, UTC
from typing import Optional, List
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI, BackgroundTasks, HTTPException
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn

# Thread pool for CPU-bound work
executor = ThreadPoolExecutor(max_workers=4)

# Data directory - Fly.io volume mount at /data
DATA_DIR = os.environ.get("DATA_DIR", "/data")
RUNS_DIR = os.path.join(DATA_DIR, "runs")

# Ensure directories exist
os.makedirs(RUNS_DIR, exist_ok=True)


# ============================================================================
# Request/Response Models
# ============================================================================

class RunRequest(BaseModel):
    mode: str = Field(..., pattern="^(sp500|import)$")
    tickers: Optional[List[str]] = None


class DebateRequest(BaseModel):
    extras: Optional[List[str]] = None


class OptimizeRequest(BaseModel):
    capital: float = Field(default=10000, ge=100, le=10000000)
    max_weight: float = Field(default=0.12, ge=0.05, le=0.50)
    sector_cap: float = Field(default=0.35, ge=0.15, le=0.60)
    min_positions: int = Field(default=8, ge=1, le=50)
    max_positions: int = Field(default=25, ge=1, le=100)
    risk_lambda: float = Field(default=1.0, ge=0.0, le=10.0)


class RunResponse(BaseModel):
    runId: str


class StatusResponse(BaseModel):
    runId: str
    stage: str
    progress: dict
    updatedAt: str
    errors: List[str] = []


class HealthResponse(BaseModel):
    status: str
    timestamp: str
    data_dir: str
    runs_count: int


# ============================================================================
# Lifespan
# ============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    print(f"RocketShip Backend starting...")
    print(f"DATA_DIR: {DATA_DIR}")
    print(f"RUNS_DIR: {RUNS_DIR}")
    yield
    # Shutdown
    executor.shutdown(wait=False)
    print("RocketShip Backend shutting down...")


# ============================================================================
# FastAPI App
# ============================================================================

app = FastAPI(
    title="RocketShip Backend",
    description="Python compute backend for RocketShip stock analysis",
    version="1.0.0",
    lifespan=lifespan
)

# Add CORS middleware to allow frontend requests
# NOTE: In production, browser never hits Fly directly (Vercel proxies all /api/* calls).
# CORS is only needed for local dev and direct API testing.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:3001",
    ],
    allow_origin_regex=r"https://.*\.vercel\.app",  # Allow all Vercel preview/prod deployments
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================================
# Helper Functions
# ============================================================================

def get_run_dir(run_id: str) -> str:
    """Get path to run directory, creating if needed."""
    run_dir = os.path.join(RUNS_DIR, run_id)
    os.makedirs(run_dir, exist_ok=True)
    return run_dir


def write_artifact(run_id: str, filename: str, data: str):
    """Write artifact file with immediate flush."""
    run_dir = get_run_dir(run_id)

    # Handle nested paths (e.g., debate/AAPL.json)
    filepath = os.path.join(run_dir, filename)
    os.makedirs(os.path.dirname(filepath), exist_ok=True)

    # Atomic write
    temp_path = filepath + ".tmp"
    with open(temp_path, 'w') as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.replace(temp_path, filepath)


def read_artifact(run_id: str, filename: str) -> Optional[str]:
    """Read artifact file, return None if not exists."""
    filepath = os.path.join(RUNS_DIR, run_id, filename)
    if not os.path.exists(filepath):
        return None
    with open(filepath, 'r') as f:
        return f.read()


def append_log(run_id: str, message: str):
    """Append to logs.txt with timestamp."""
    run_dir = get_run_dir(run_id)
    logs_path = os.path.join(run_dir, "logs.txt")
    timestamp = datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S")
    log_line = f"[{timestamp}] {message}\n"
    with open(logs_path, 'a') as f:
        f.write(log_line)
        f.flush()
    print(log_line.strip())


def write_status(run_id: str, stage: str, progress: dict, errors: List[str] = None):
    """Write status.json."""
    status = {
        "runId": run_id,
        "stage": stage,
        "progress": progress,
        "updatedAt": datetime.now(UTC).isoformat().replace('+00:00', 'Z'),
        "errors": errors or []
    }
    write_artifact(run_id, "status.json", json.dumps(status, indent=2))


def generate_run_id() -> str:
    """Generate run ID in YYYYMMDD_HHMMSS format."""
    now = datetime.now(UTC)
    return now.strftime("%Y%m%d_%H%M%S")


# ============================================================================
# Background Task: RocketScore Pipeline
# ============================================================================

def run_rocketscore_pipeline(run_id: str, mode: str, tickers: Optional[List[str]]):
    """
    Background task: Run the full RocketScore pipeline.
    This runs in a thread pool to avoid blocking the event loop.
    """
    import sys
    # Add app directory to path for imports
    # In Docker: main.py is at /app/main.py, src/ is at /app/src/
    # In local: main.py is at backend/main.py, src/ is at ../src/
    app_dir = os.path.dirname(os.path.abspath(__file__))  # /app in Docker, backend/ locally

    # Check if we're in Docker (src/ is sibling of main.py)
    if os.path.exists(os.path.join(app_dir, "src")):
        sys.path.insert(0, app_dir)  # Docker: /app
    else:
        # Local dev: go up one level from backend/
        sys.path.insert(0, os.path.dirname(app_dir))

    try:
        from src.data_fetcher import fetch_ohlcv
        from src.signals import compute_signals
        from src.rocket_score import compute_rocket_score
        from src.universe import get_universe, get_sector

        append_log(run_id, "RocketScore pipeline started")

        # Immediately update from "starting" to "rocket" stage
        write_status(run_id, "rocket", {
            "done": 0,
            "total": 493 if mode == 'sp500' else len(tickers or []),
            "current": None,
            "message": "Pipeline initialized, preparing tickers..."
        })

        # Determine tickers
        if mode == 'sp500':
            append_log(run_id, "Fetching S&P 500 universe...")
            write_status(run_id, "rocket", {
                "done": 0,
                "total": 493,  # Estimated, will update after fetch
                "current": None,
                "message": "Fetching S&P 500 universe from Wikipedia..."
            })
            try:
                ticker_list = get_universe()
                append_log(run_id, f"Got {len(ticker_list)} tickers from S&P 500")
            except Exception as e:
                error_msg = str(e)
                # Clean error message - remove HTML dumps
                if "DOCTYPE" in error_msg or len(error_msg) > 500:
                    error_msg = "Failed to fetch S&P 500 tickers. Check logs for details."
                append_log(run_id, f"ERROR fetching S&P 500: {error_msg}")
                write_status(run_id, "error", {
                    "done": 0,
                    "total": 0,
                    "current": None,
                    "message": f"S&P 500 fetch failed: {error_msg[:200]}"
                }, errors=[error_msg[:200]])
                return
        else:
            ticker_list = [t.strip().upper() for t in (tickers or [])]
            append_log(run_id, f"Using {len(ticker_list)} imported tickers")

        # Write universe
        universe_data = {
            "mode": mode,
            "tickers": ticker_list,
            "count": len(ticker_list),
            "createdAt": datetime.now(UTC).isoformat().replace('+00:00', 'Z')
        }
        write_artifact(run_id, "universe.json", json.dumps(universe_data, indent=2))

        # Update status with actual count and start message
        write_status(run_id, "rocket", {
            "done": 0,
            "total": len(ticker_list),
            "current": None,
            "message": f"Starting RocketScore analysis for {len(ticker_list)} tickers..."
        })

        # Analyze tickers
        rocket_scores = []
        completed = 0

        # Update status before starting ticker analysis
        write_status(run_id, "rocket", {
            "done": 0,
            "total": len(ticker_list),
            "current": None,
            "message": f"Fetching market data for {len(ticker_list)} tickers..."
        })

        import time as _time

        for i, ticker in enumerate(ticker_list):
            try:
                # Update status before each ticker
                write_status(run_id, "rocket", {
                    "done": completed,
                    "total": len(ticker_list),
                    "current": ticker,
                    "message": f"Analyzing {ticker} ({i+1}/{len(ticker_list)})..."
                })
                append_log(run_id, f"[{i+1}/{len(ticker_list)}] Analyzing {ticker}...")

                # Rate limiting pause every 50 tickers to avoid Yahoo rate limits
                if i > 0 and i % 50 == 0:
                    append_log(run_id, f"Brief pause at {i} tickers to avoid rate limiting...")
                    _time.sleep(2)

                # Fetch data with timeout protection
                df = fetch_ohlcv(ticker, lookback_days=252)
                if df is None or len(df) < 60:
                    append_log(run_id, f"Warning: {ticker} - insufficient data (skipped)")
                    completed += 1
                    continue

                # Compute signals
                signals = compute_signals(df)

                # Get sector
                sector = get_sector(ticker)

                # Compute RocketScore
                score_data = compute_rocket_score(ticker, df, signals, sector)

                # Build result
                result = {
                    "ticker": ticker,
                    "sector": sector,
                    "current_price": float(df['Close'].iloc[-1]),
                    "rocket_score": score_data["rocket_score"],
                    "weighted_score_before_tags": score_data.get("weighted_score_before_tags", score_data["rocket_score"]),
                    "tag_bonus": score_data.get("tag_bonus", 0),
                    "technical_score": score_data["technical_score"],
                    "volume_score": score_data["volume_score"],
                    "quality_score": score_data["quality_score"],
                    "macro_score": score_data["macro_score"],
                    "weights": score_data.get("weights", {
                        "technical": 0.45,
                        "volume": 0.25,
                        "quality": 0.20,
                        "macro": 0.10
                    }),
                    "breakdown": score_data.get("breakdown", {}),
                    "technical_details": score_data.get("technical_details"),
                    "volume_details": score_data.get("volume_details"),
                    "quality_details": score_data.get("quality_details"),
                    "macro_details": score_data.get("macro_details"),
                    "tags": score_data.get("tags", []),
                    "signal_labels": score_data.get("signal_labels", []),
                    "macro_tags": score_data.get("macro_tags", []),
                    "macro_trends_matched": score_data.get("macro_trends_matched", []),
                    "data_sources": ["yfinance"],
                    "methodology": score_data.get("methodology")
                }

                rocket_scores.append(result)
                completed += 1
                append_log(run_id, f"Completed {ticker}: score={score_data['rocket_score']:.1f}")

                # Update status after completion
                write_status(run_id, "rocket", {
                    "done": completed,
                    "total": len(ticker_list),
                    "current": ticker,
                    "message": f"Completed {ticker} ({completed}/{len(ticker_list)})"
                })

            except Exception as e:
                error_msg = str(e)
                # Clean error message - truncate if too long
                if len(error_msg) > 200:
                    error_msg = error_msg[:200] + "..."
                append_log(run_id, f"Error analyzing {ticker}: {error_msg}")
                completed += 1
                # Update status even on error
                write_status(run_id, "rocket", {
                    "done": completed,
                    "total": len(ticker_list),
                    "current": ticker,
                    "message": f"Error analyzing {ticker}, continuing..."
                })
                continue

        # Sort by rocket_score descending
        rocket_scores.sort(key=lambda x: x['rocket_score'], reverse=True)

        append_log(run_id, f"Discovery complete. Analyzed {len(rocket_scores)} stocks")
        write_artifact(run_id, "rocket_scores.json", json.dumps(rocket_scores, indent=2))

        # Update status to done
        write_status(run_id, "debate_ready", {
            "done": len(rocket_scores),
            "total": len(ticker_list),
            "current": None,
            "message": "Analysis complete"
        })

        append_log(run_id, "Pipeline complete")

    except Exception as e:
        error_msg = str(e)
        # Clean error message - remove HTML dumps and truncate
        if "DOCTYPE" in error_msg or len(error_msg) > 500:
            # Extract first meaningful line or truncate
            lines = error_msg.split('\n')
            error_msg = lines[0] if lines else "Pipeline error (check logs for details)"
            if len(error_msg) > 200:
                error_msg = error_msg[:200] + "..."
        
        append_log(run_id, f"ERROR: {error_msg}")
        # Preserve current total if available, otherwise use 0
        current_status = read_artifact(run_id, "status.json")
        current_total = 0
        if current_status:
            try:
                status_data = json.loads(current_status)
                current_total = status_data.get("progress", {}).get("total", 0)
            except:
                pass
        
        write_status(run_id, "error", {
            "done": 0,
            "total": current_total,
            "current": None,
            "message": error_msg
        }, errors=[error_msg])


# ============================================================================
# Background Task: Debate Pipeline
# ============================================================================

def run_debate_pipeline(run_id: str, extras: Optional[List[str]] = None):
    """
    Background task: Run the full debate pipeline.
    """
    import sys
    # Add app directory to path for imports (same logic as rocketscore pipeline)
    app_dir = os.path.dirname(os.path.abspath(__file__))
    if os.path.exists(os.path.join(app_dir, "src")):
        sys.path.insert(0, app_dir)
    else:
        sys.path.insert(0, os.path.dirname(app_dir))

    try:
        import httpx
        import asyncio

        append_log(run_id, "Debate pipeline started")

        # Load rocket_scores.json
        scores_data = read_artifact(run_id, "rocket_scores.json")
        if not scores_data:
            raise ValueError("rocket_scores.json not found. Run RocketScore first.")

        scores = json.loads(scores_data)

        # Build rank map
        sorted_scores = sorted(scores, key=lambda x: x['rocket_score'], reverse=True)
        rank_map = {s['ticker']: i + 1 for i, s in enumerate(sorted_scores)}
        ticker_scores = {s['ticker']: s for s in scores}

        # Select candidates: 23 top + 5 edge + 2 best of worst = 30 total
        total = len(sorted_scores)
        candidates = []

        # Group A: Top 23 by RocketScore
        for s in sorted_scores[:min(23, total)]:
            candidates.append({
                'ticker': s['ticker'],
                'rocket_score': s['rocket_score'],
                'sector': s.get('sector', 'Unknown'),
                'rank': rank_map[s['ticker']],
                'selection_group': 'top23'
            })

        # Group B: Edge cases (ranks 24-28) - stocks near the cutoff
        for s in sorted_scores[23:min(28, total)]:
            candidates.append({
                'ticker': s['ticker'],
                'rocket_score': s['rocket_score'],
                'sector': s.get('sector', 'Unknown'),
                'rank': rank_map[s['ticker']],
                'selection_group': 'edge'
            })

        # Group C: Best of worst (bottom quartile, top 2)
        bottom_start = max(0, total - min(50, int(total * 0.2)))
        bottom_bucket = sorted_scores[bottom_start:]
        existing_tickers = {c['ticker'] for c in candidates}
        for s in bottom_bucket[:2]:
            if s['ticker'] not in existing_tickers:
                candidates.append({
                    'ticker': s['ticker'],
                    'rocket_score': s['rocket_score'],
                    'sector': s.get('sector', 'Unknown'),
                    'rank': rank_map[s['ticker']],
                    'selection_group': 'best_of_worst'
                })
                existing_tickers.add(s['ticker'])

        # Add extras
        for ticker in (extras or []):
            if ticker not in existing_tickers and ticker in ticker_scores:
                s = ticker_scores[ticker]
                candidates.append({
                    'ticker': s['ticker'],
                    'rocket_score': s['rocket_score'],
                    'sector': s.get('sector', 'Unknown'),
                    'rank': rank_map.get(s['ticker'], 0),
                    'selection_group': 'extra'
                })
                existing_tickers.add(ticker)

        # Write selection
        write_artifact(run_id, "debate_selection.json", json.dumps({
            "runId": run_id,
            "createdAt": datetime.now(UTC).isoformat().replace('+00:00', 'Z'),
            "total": len(candidates),
            "breakdown": {
                "top23": len([c for c in candidates if c['selection_group'] == 'top23']),
                "edge": len([c for c in candidates if c['selection_group'] == 'edge']),
                "best_of_worst": len([c for c in candidates if c['selection_group'] == 'best_of_worst']),
                "extra": len([c for c in candidates if c['selection_group'] == 'extra'])
            },
            "selections": candidates
        }, indent=2))

        append_log(run_id, f"Selected {len(candidates)} candidates for debate")

        # Check for API key
        api_key = os.environ.get("DEEPSEEK_API_KEY", "")
        api_url = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
        use_real_debate = len(api_key) >= 20

        if not use_real_debate:
            append_log(run_id, "WARNING: DEEPSEEK_API_KEY not configured. Using mock debate.")

        summary = {
            "buy": [],
            "hold": [],
            "sell": [],
            "candidateCount": len(candidates),
            "byTicker": {}
        }

        # Run debate for each candidate
        for i, candidate in enumerate(candidates):
            ticker = candidate['ticker']
            score = ticker_scores.get(ticker)

            if not score:
                append_log(run_id, f"[{ticker}] ERROR: Score data not found, skipping")
                continue

            # Update status with substep tracking (5 API calls per stock: 4 agents + 1 judge)
            write_status(run_id, "debate", {
                "done": i,
                "total": len(candidates),
                "current": ticker,
                "substep": "agents",
                "substep_done": 0,
                "substep_total": 5,
                "message": f"Running AI agents on {ticker} ({i + 1}/{len(candidates)})"
            })

            try:
                if use_real_debate:
                    # Run real debate with DeepSeek - with progress callbacks
                    debate = asyncio.run(run_single_debate_with_progress(
                        run_id, ticker, score, candidate, api_key, api_url, i, len(candidates)
                    ))
                else:
                    # Mock debate
                    verdict = 'BUY' if score['rocket_score'] >= 70 else ('HOLD' if score['rocket_score'] >= 50 else 'SELL')
                    confidence = min(85, max(20, int(score['rocket_score'])))

                    debate = {
                        "ticker": ticker,
                        "agents": {
                            "bull": {"agent": "bull", "thesis": f"Bull case for {ticker}"},
                            "bear": {"agent": "bear", "thesis": f"Bear case for {ticker}"},
                            "regime": {"agent": "regime", "thesis": f"Regime analysis for {ticker}"},
                            "volume": {"agent": "volume", "thesis": f"Volume analysis for {ticker}"}
                        },
                        "judge": {
                            "verdict": verdict,
                            "confidence": confidence,
                            "reasoning": "Mock verdict based on RocketScore",
                            "tags": score.get('tags', [])
                        },
                        "createdAt": datetime.now(UTC).isoformat().replace('+00:00', 'Z'),
                        "selection_group": candidate['selection_group'],
                        "warnings": ["Mock debate - configure DEEPSEEK_API_KEY for real analysis"]
                    }

                # Extract verdict
                judge = debate.get('judge', {})
                verdict_raw = (judge.get('verdict') or 'HOLD').upper()
                verdict = 'SELL' if verdict_raw == 'WAIT' else verdict_raw
                confidence = judge.get('confidence', 50)
                tags = (judge.get('tags') or score.get('tags', []))[:4]

                # Write debate file
                write_artifact(run_id, f"debate/{ticker}.json", json.dumps(debate, indent=2))

                # Update summary
                summary['byTicker'][ticker] = {
                    "verdict": verdict,
                    "confidence": confidence,
                    "rocket_score": score['rocket_score'],
                    "rocket_rank": rank_map.get(ticker),
                    "sector": score.get('sector', 'Unknown'),
                    "tags": tags,
                    "selection_group": candidate['selection_group']
                }

                if verdict == 'BUY':
                    summary['buy'].append(ticker)
                elif verdict == 'HOLD':
                    summary['hold'].append(ticker)
                else:
                    summary['sell'].append(ticker)

                append_log(run_id, f"[{ticker}] Completed: {verdict} ({confidence}%)")

            except Exception as e:
                append_log(run_id, f"[{ticker}] FAILED: {str(e)}")
                write_artifact(run_id, f"debate/{ticker}_error.json", json.dumps({
                    "ticker": ticker,
                    "error": str(e),
                    "timestamp": datetime.now(UTC).isoformat().replace('+00:00', 'Z')
                }, indent=2))

        # Write summary
        write_artifact(run_id, "debate/debate_summary.json", json.dumps(summary, indent=2))

        # Create final_buys.json
        final_buy_candidates = [
            {"ticker": ticker, **summary['byTicker'][ticker]}
            for ticker in summary['buy']
        ]
        final_buy_candidates.sort(key=lambda x: (-x.get('confidence', 0), -x.get('rocket_score', 0)))
        final_buys = final_buy_candidates[:12]

        write_artifact(run_id, "final_buys.json", json.dumps({
            "runId": run_id,
            "createdAt": datetime.now(UTC).isoformat().replace('+00:00', 'Z'),
            "selection": {
                "total_buy": len(summary['buy']),
                "selected": len(final_buys)
            },
            "items": final_buys
        }, indent=2))

        # Final status
        write_status(run_id, "debate_ready", {
            "done": len(candidates),
            "total": len(candidates),
            "current": None,
            "message": f"Debate complete: {len(summary['buy'])} BUY, {len(summary['hold'])} HOLD, {len(summary['sell'])} SELL"
        })

        append_log(run_id, f"Debate complete. BUY: {len(summary['buy'])}, HOLD: {len(summary['hold'])}, SELL: {len(summary['sell'])}")

    except Exception as e:
        append_log(run_id, f"ERROR: {str(e)}")
        write_status(run_id, "error", {
            "done": 0,
            "total": 0,
            "current": None,
            "message": str(e)
        }, errors=[str(e)])


async def run_single_debate_with_progress(
    run_id: str, ticker: str, score: dict, candidate: dict,
    api_key: str, api_url: str, stock_idx: int, total_stocks: int
) -> dict:
    """Run debate for a single ticker using DeepSeek with progress updates."""
    import httpx

    # Reduced timeout for faster failure detection (15s instead of 30s)
    API_TIMEOUT = 15.0

    # Build compact context (less tokens = faster response)
    context = {
        "ticker": ticker,
        "sector": score.get('sector', 'Unknown'),
        "price": score.get('current_price', 0),
        "rocket_score": score.get('rocket_score', 0),
        "rank": candidate.get('rank'),
        "tech": score.get('technical_score', 0),
        "vol": score.get('volume_score', 0),
        "qual": score.get('quality_score', 0),
        "macro": score.get('macro_score', 0),
        "tags": score.get('tags', [])[:3],  # Limit tags
    }

    def update_substep(substep_done: int, substep_name: str):
        """Update progress with substep info."""
        write_status(run_id, "debate", {
            "done": stock_idx,
            "total": total_stocks,
            "current": ticker,
            "substep": substep_name,
            "substep_done": substep_done,
            "substep_total": 5,
            "message": f"{ticker}: {substep_name} ({substep_done}/5 API calls)"
        })

    # Concise prompts for faster responses
    prompts = {
        "bull": "BULL analyst. Return JSON: {thesis, confidence, catalysts[]}",
        "bear": "BEAR analyst. Return JSON: {thesis, confidence, risks[]}",
        "regime": "REGIME analyst. Return JSON: {thesis, regime: risk-on|risk-off|neutral, confidence}",
        "volume": "VOLUME analyst. Return JSON: {thesis, flow: accumulation|distribution|neutral, confidence}"
    }

    async def call_agent(agent_type: str) -> dict:
        async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
            response = await client.post(
                f"{api_url}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "model": "deepseek-chat",
                    "messages": [
                        {"role": "system", "content": prompts[agent_type]},
                        {"role": "user", "content": f"Analyze {ticker}:\n{json.dumps(context)}"}
                    ],
                    "temperature": 0.3,
                    "max_tokens": 500,  # Limit response size for speed
                    "response_format": {"type": "json_object"}
                }
            )
            response.raise_for_status()
            result = response.json()
            content = result["choices"][0]["message"]["content"]
            return json.loads(content)

    # Run all 4 agents in parallel
    update_substep(0, "Running 4 agents")
    results = await asyncio.gather(
        call_agent("bull"),
        call_agent("bear"),
        call_agent("regime"),
        call_agent("volume"),
        return_exceptions=True  # Don't fail all if one fails
    )

    # Handle any failed agents
    bull = results[0] if not isinstance(results[0], Exception) else {"thesis": "Failed", "confidence": 0}
    bear = results[1] if not isinstance(results[1], Exception) else {"thesis": "Failed", "confidence": 0}
    regime = results[2] if not isinstance(results[2], Exception) else {"thesis": "Failed", "regime": "neutral"}
    volume = results[3] if not isinstance(results[3], Exception) else {"thesis": "Failed", "flow": "neutral"}

    update_substep(4, "Running judge")

    # Run judge with compact input
    judge_input = {
        "bull": bull.get("thesis", "")[:200],
        "bear": bear.get("thesis", "")[:200],
        "regime": regime.get("regime", "neutral"),
        "volume": volume.get("flow", "neutral"),
        "rocket_score": context["rocket_score"]
    }

    async with httpx.AsyncClient(timeout=API_TIMEOUT) as client:
        response = await client.post(
            f"{api_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={
                "model": "deepseek-chat",
                "messages": [
                    {"role": "system", "content": "JUDGE. Return JSON: {verdict: BUY|HOLD|SELL, confidence: 0-100, reasoning}"},
                    {"role": "user", "content": f"Decide for {ticker}:\n{json.dumps(judge_input)}"}
                ],
                "temperature": 0.2,
                "max_tokens": 300,
                "response_format": {"type": "json_object"}
            }
        )
        response.raise_for_status()
        result = response.json()
        content = result["choices"][0]["message"]["content"]
        judge = json.loads(content)

    update_substep(5, "Complete")

    return {
        "ticker": ticker,
        "agents": {"bull": bull, "bear": bear, "regime": regime, "volume": volume},
        "judge": judge,
        "createdAt": datetime.now(UTC).isoformat().replace('+00:00', 'Z'),
        "selection_group": candidate['selection_group']
    }


# Keep old function for backwards compatibility (unused but safe to keep)
async def run_single_debate(run_id: str, ticker: str, score: dict, candidate: dict, api_key: str, api_url: str) -> dict:
    """Legacy debate function - now uses run_single_debate_with_progress instead."""
    return await run_single_debate_with_progress(run_id, ticker, score, candidate, api_key, api_url, 0, 1)


# ============================================================================
# Background Task: Portfolio Optimization
# ============================================================================

def run_optimize_pipeline(run_id: str, params: OptimizeRequest):
    """
    Background task: Run portfolio optimization with CVXPY.
    """
    import sys
    # Add app directory to path for imports (same logic as rocketscore pipeline)
    app_dir = os.path.dirname(os.path.abspath(__file__))
    if os.path.exists(os.path.join(app_dir, "src")):
        sys.path.insert(0, app_dir)
    else:
        sys.path.insert(0, os.path.dirname(app_dir))

    try:
        append_log(run_id, "Optimization pipeline started")

        # Load required files
        scores_data = read_artifact(run_id, "rocket_scores.json")
        final_buys_data = read_artifact(run_id, "final_buys.json")

        if not scores_data:
            raise ValueError("rocket_scores.json not found")
        if not final_buys_data:
            raise ValueError("final_buys.json not found. Run debate first.")

        scores = json.loads(scores_data)
        final_buys = json.loads(final_buys_data)

        # Get eligible tickers
        ticker_scores = {s['ticker']: s for s in scores}
        eligible = [item['ticker'] for item in final_buys.get('items', []) if item.get('ticker') in ticker_scores]

        if not eligible:
            raise ValueError("No eligible tickers for optimization")

        append_log(run_id, f"Optimizing {len(eligible)} positions...")

        # Import optimizer
        from src.optimizer import optimize_portfolio

        # Run optimization
        portfolio = optimize_portfolio(
            run_id,
            capital=params.capital,
            max_weight=params.max_weight,
            sector_cap=params.sector_cap,
            min_positions=len(eligible),
            max_positions=len(eligible),
            risk_lambda=params.risk_lambda
        )

        # The optimizer writes to runs/{run_id}/portfolio.json
        # We need to copy it to our data directory
        old_path = os.path.join(repo_root, "runs", run_id, "portfolio.json")
        if os.path.exists(old_path):
            with open(old_path, 'r') as f:
                portfolio_data = f.read()
            write_artifact(run_id, "portfolio.json", portfolio_data)
        else:
            write_artifact(run_id, "portfolio.json", json.dumps(portfolio, indent=2))

        write_status(run_id, "done", {
            "done": len(eligible),
            "total": len(eligible),
            "current": None,
            "message": f"Portfolio optimized: {len(portfolio.get('allocations', []))} positions"
        })

        append_log(run_id, f"Optimization complete. {len(portfolio.get('allocations', []))} positions")

    except Exception as e:
        append_log(run_id, f"ERROR: {str(e)}")
        write_status(run_id, "error", {
            "done": 0,
            "total": 0,
            "current": None,
            "message": str(e)
        }, errors=[str(e)])


# ============================================================================
# API Endpoints
# ============================================================================

@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    try:
        runs = os.listdir(RUNS_DIR) if os.path.exists(RUNS_DIR) else []
    except:
        runs = []

    return HealthResponse(
        status="ok",
        timestamp=datetime.now(UTC).isoformat().replace('+00:00', 'Z'),
        data_dir=DATA_DIR,
        runs_count=len(runs)
    )


@app.post("/run", response_model=RunResponse)
async def create_run(req: RunRequest, background_tasks: BackgroundTasks):
    """
    Start a new RocketScore run.
    Returns immediately with runId, runs pipeline in background.
    """
    # Validate tickers for import mode
    if req.mode == 'import':
        if not req.tickers or len(req.tickers) == 0:
            raise HTTPException(status_code=400, detail="Tickers required for import mode")
        if len(req.tickers) > 500:
            raise HTTPException(status_code=400, detail="Maximum 500 tickers allowed")

    # Generate runId
    run_id = generate_run_id()

    # Initialize run directory
    get_run_dir(run_id)
    append_log(run_id, f"Run created (mode: {req.mode})")

    # For import mode, we know the count immediately
    # For sp500 mode, use estimated count (will be updated after fetch)
    initial_total = len(req.tickers) if req.mode == 'import' and req.tickers else 493

    # PHASE 3: Write immediate "starting" status so UI sees activity within 1-2s
    write_status(run_id, "starting", {
        "done": 0,
        "total": initial_total,
        "current": None,
        "message": f"Initializing {req.mode} analysis..."
    })

    # Start pipeline in background thread
    # Use executor.submit directly to ensure it runs immediately
    executor.submit(run_rocketscore_pipeline, run_id, req.mode, req.tickers)

    return RunResponse(runId=run_id)


@app.get("/run/{run_id}/status", response_model=StatusResponse)
async def get_run_status(run_id: str):
    """Get status of a run."""
    status_data = read_artifact(run_id, "status.json")
    if not status_data:
        raise HTTPException(status_code=404, detail="Run not found")

    status = json.loads(status_data)
    return StatusResponse(**status)


@app.get("/run/{run_id}/artifact/{filename:path}")
async def get_artifact(run_id: str, filename: str):
    """
    Get an artifact file from a run.
    Supports nested paths like debate/AAPL.json
    """
    # Security: prevent path traversal
    if ".." in filename or filename.startswith("/"):
        raise HTTPException(status_code=400, detail="Invalid filename")

    filepath = os.path.join(RUNS_DIR, run_id, filename)

    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="Artifact not found")

    # Return JSON files as JSON, others as file download
    if filename.endswith('.json'):
        with open(filepath, 'r') as f:
            data = json.load(f)
        return JSONResponse(content=data)
    else:
        return FileResponse(filepath)


@app.post("/run/{run_id}/debate")
async def start_debate(run_id: str, req: DebateRequest, background_tasks: BackgroundTasks):
    """
    Start debate pipeline for a run.
    Returns immediately, runs debate in background.
    """
    # Check if run exists
    if not read_artifact(run_id, "status.json"):
        raise HTTPException(status_code=404, detail="Run not found")

    # Check if rocket_scores exist
    if not read_artifact(run_id, "rocket_scores.json"):
        raise HTTPException(status_code=400, detail="RocketScore not complete. Run pipeline first.")

    # Update status
    write_status(run_id, "debate", {
        "done": 0,
        "total": 0,
        "current": None,
        "message": "Starting debate..."
    })

    # Start debate in background
    background_tasks.add_task(
        lambda: executor.submit(run_debate_pipeline, run_id, req.extras)
    )

    return {"success": True, "message": "Debate started"}


@app.post("/run/{run_id}/optimize")
async def start_optimize(run_id: str, req: OptimizeRequest, background_tasks: BackgroundTasks):
    """
    Start portfolio optimization for a run.
    Returns immediately, runs optimization in background.
    """
    # Check if run exists
    if not read_artifact(run_id, "status.json"):
        raise HTTPException(status_code=404, detail="Run not found")

    # Check if final_buys exist
    if not read_artifact(run_id, "final_buys.json"):
        raise HTTPException(status_code=400, detail="Debate not complete. Run debate first.")

    # Update status
    write_status(run_id, "optimize", {
        "done": 0,
        "total": 0,
        "current": None,
        "message": "Starting optimization..."
    })

    # Start optimization in background
    background_tasks.add_task(
        lambda: executor.submit(run_optimize_pipeline, run_id, req)
    )

    return {"success": True, "message": "Optimization started"}


# ============================================================================
# Main
# ============================================================================

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
