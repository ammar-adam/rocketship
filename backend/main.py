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
import re
from datetime import datetime, UTC, timedelta
from typing import Optional, List, Dict, Any
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager

from fastapi import FastAPI, BackgroundTasks, HTTPException, Request
from fastapi.responses import JSONResponse, FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
import uvicorn

# NewsAPI configuration
NEWS_API_KEY = os.environ.get("NEWS_API_KEY", "")
NEWS_API_BASE = "https://newsapi.org/v2"

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
    skipped: Optional[List[str]] = None


class SkipRequest(BaseModel):
    ticker: str
    reason: str = Field(default="user_timeout", description="e.g. user_timeout, user_skip")


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


def write_status(run_id: str, stage: str, progress: dict, errors: List[str] = None, skipped: List[str] = None):
    """Write status.json. Optionally include skipped tickers (for debate stage)."""
    status = {
        "runId": run_id,
        "stage": stage,
        "progress": progress,
        "updatedAt": datetime.now(UTC).isoformat().replace('+00:00', 'Z'),
        "errors": errors or []
    }
    if skipped is not None:
        status["skipped"] = skipped
    write_artifact(run_id, "status.json", json.dumps(status, indent=2))


def read_skipped_set(run_id: str) -> set:
    """Read persisted skipped tickers for a run. Returns set of ticker symbols."""
    data = read_artifact(run_id, "skipped.json")
    if not data:
        return set()
    try:
        obj = json.loads(data)
        tickers = obj.get("tickers", [])
        return set(t.upper() for t in tickers)
    except (json.JSONDecodeError, TypeError):
        return set()


def add_skipped(run_id: str, ticker: str, reason: str = "user_timeout") -> set:
    """Append a ticker to the run's skipped set and persist. Returns updated set."""
    run_dir = get_run_dir(run_id)
    path = os.path.join(run_dir, "skipped.json")
    current = read_skipped_set(run_id)
    ticker = ticker.upper()
    current.add(ticker)
    reasons = {}
    if os.path.exists(path):
        try:
            with open(path, 'r') as f:
                existing = json.load(f)
            reasons = existing.get("reasons", {})
        except (json.JSONDecodeError, TypeError):
            pass
    reasons[ticker] = reason
    data = {"tickers": list(current), "reasons": reasons}
    write_artifact(run_id, "skipped.json", json.dumps(data, indent=2))
    return current


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
# News API Integration
# ============================================================================

async def fetch_news_for_ticker(ticker: str, days: int = 14, limit: int = 8) -> Dict[str, Any]:
    """
    Fetch news from NewsAPI for a ticker.
    Returns a structured news context object for agents.
    """
    import httpx

    if not NEWS_API_KEY or len(NEWS_API_KEY) < 20:
        return {
            "query": ticker,
            "articles": [],
            "error": "NEWS_API_KEY not configured"
        }

    try:
        to_date = datetime.now(UTC)
        from_date = to_date - timedelta(days=days)

        params = {
            "q": ticker,
            "from": from_date.strftime("%Y-%m-%d"),
            "to": to_date.strftime("%Y-%m-%d"),
            "sortBy": "publishedAt",
            "language": "en",
            "pageSize": str(limit),
            "apiKey": NEWS_API_KEY
        }

        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(
                f"{NEWS_API_BASE}/everything",
                params=params,
                headers={"User-Agent": "RocketShip/1.0"}
            )

            if response.status_code != 200:
                return {
                    "query": ticker,
                    "articles": [],
                    "error": f"NewsAPI error {response.status_code}"
                }

            data = response.json()

            if data.get("status") != "ok":
                return {
                    "query": ticker,
                    "articles": [],
                    "error": data.get("message", "NewsAPI error")
                }

            # Format articles compactly for LLM consumption
            articles = []
            for i, article in enumerate(data.get("articles", [])[:limit]):
                articles.append({
                    "id": f"N{i+1}",
                    "title": (article.get("title") or "")[:150],
                    "source": article.get("source", {}).get("name", "Unknown"),
                    "date": article.get("publishedAt", "")[:10],
                    "summary": (article.get("description") or "")[:200]
                })

            return {
                "query": ticker,
                "articles": articles,
                "count": len(articles)
            }

    except Exception as e:
        return {
            "query": ticker,
            "articles": [],
            "error": str(e)[:100]
        }


# ============================================================================
# Debate Selection Logic
# ============================================================================

def select_debate_candidates(
    sorted_scores: List[Dict],
    rank_map: Dict[str, int],
    extras: Optional[List[str]] = None
) -> List[Dict]:
    """
    Select exactly 30 candidates for debate (when enough stocks exist):
    - 23 = top23 by rocket_score rank (highest)
    - 5 = edge = ranks 24-28 (next 5 after top23)
    - 2 = best_of_worst = 2 HIGHEST-scoring from bottom quartile

    Key fix: best_of_worst now takes the TOP 2 from the bottom quartile,
    not the absolute worst stocks.
    """
    total = len(sorted_scores)
    candidates = []
    existing_tickers = set()

    # Group A: Top 23 by RocketScore (ranks 1-23)
    for s in sorted_scores[:min(23, total)]:
        candidates.append({
            'ticker': s['ticker'],
            'rocket_score': s['rocket_score'],
            'sector': s.get('sector', 'Unknown'),
            'rank': rank_map[s['ticker']],
            'selection_group': 'top23'
        })
        existing_tickers.add(s['ticker'])

    # Group B: Edge cases (ranks 24-28)
    for s in sorted_scores[23:min(28, total)]:
        candidates.append({
            'ticker': s['ticker'],
            'rocket_score': s['rocket_score'],
            'sector': s.get('sector', 'Unknown'),
            'rank': rank_map[s['ticker']],
            'selection_group': 'edge'
        })
        existing_tickers.add(s['ticker'])

    # Group C: Best of worst - TOP 2 from bottom quartile (by rocket_score)
    # Bottom quartile = last 25% of stocks
    # We want the HIGHEST-scoring stocks within that bottom quartile
    if total > 28:
        # Bottom quartile starts at 75% mark
        bottom_quartile_start = int(total * 0.75)
        bottom_quartile = sorted_scores[bottom_quartile_start:]

        # Sort bottom quartile by rocket_score DESCENDING to get the "best of worst"
        bottom_sorted = sorted(bottom_quartile, key=lambda x: x['rocket_score'], reverse=True)

        added_best_of_worst = 0
        for s in bottom_sorted:
            if s['ticker'] not in existing_tickers and added_best_of_worst < 2:
                candidates.append({
                    'ticker': s['ticker'],
                    'rocket_score': s['rocket_score'],
                    'sector': s.get('sector', 'Unknown'),
                    'rank': rank_map[s['ticker']],
                    'selection_group': 'best_of_worst'
                })
                existing_tickers.add(s['ticker'])
                added_best_of_worst += 1

    # Group D: User-specified extras
    ticker_scores_map = {s['ticker']: s for s in sorted_scores}
    for ticker in (extras or []):
        if ticker not in existing_tickers and ticker in ticker_scores_map:
            s = ticker_scores_map[ticker]
            candidates.append({
                'ticker': s['ticker'],
                'rocket_score': s['rocket_score'],
                'sector': s.get('sector', 'Unknown'),
                'rank': rank_map.get(s['ticker'], 0),
                'selection_group': 'extra'
            })
            existing_tickers.add(ticker)

    return candidates


# ============================================================================
# Agent Prompts (Detailed)
# ============================================================================

def get_bull_prompt() -> str:
    return """You are a SENIOR BULL ANALYST writing an investment memo.

OUTPUT REQUIREMENTS:
- Write in high-level sell-side / PM memo style. No fluff.
- Use complete sentences and clear investment language.
- Cite news items using [N1], [N2] format when available (if no news, cite metrics instead).
- Reference at least ONE quantitative input (rocket_score, rank, momentum, etc.).
- 6-10 sentences total. HARD CAP: ~150 tokens.

Your JSON response MUST include:
{
  "agent": "bull",
  "thesis": "1-2 sentence investment thesis",
  "key_points": [
    {"claim": "...", "evidence": "...", "source": "N1 or metrics or sector"}
  ],
  "catalysts": [
    {"catalyst": "...", "timeframe": "1-3m or 3-6m or 6-12m", "measurable_signal": "..."}
  ],
  "risks": [
    {"risk": "...", "why": "...", "monitoring_metric": "..."}
  ],
  "verdict": "ENTER|HOLD|EXIT",
  "confidence": 0-100
}

CRITICAL: Keep arrays SHORT (1-2 items each). If uncertain, default to HOLD. Do NOT repeat input data verbatim."""


def get_bear_prompt() -> str:
    return """You are a SENIOR BEAR ANALYST writing an investment memo.

OUTPUT REQUIREMENTS:
- Write in high-level sell-side / PM memo style. No fluff.
- Use complete sentences and clear investment language.
- Cite news items using [N1], [N2] format when available (if no news, cite metrics instead).
- Reference at least ONE quantitative input (rocket_score, rank, valuation, etc.).
- 6-10 sentences total. HARD CAP: ~150 tokens.

Your JSON response MUST include:
{
  "agent": "bear",
  "thesis": "1-2 sentence bear thesis",
  "key_points": [
    {"claim": "...", "evidence": "...", "source": "N1 or metrics or sector"}
  ],
  "risks": [
    {"risk": "...", "why": "...", "monitoring_metric": "..."}
  ],
  "catalysts": [
    {"catalyst": "negative catalyst", "timeframe": "1-3m or 3-6m or 6-12m", "measurable_signal": "..."}
  ],
  "verdict": "ENTER|HOLD|EXIT",
  "confidence": 0-100,
  "key_evidence": ["bullet 1", "bullet 2", "bullet 3"]
}

If uncertain, state uncertainty and default to HOLD. Do NOT repeat input data verbatim."""


def get_regime_prompt() -> str:
    return """You are a REGIME/MACRO ANALYST assessing market conditions.

OUTPUT REQUIREMENTS:
- Classify current regime (risk-on/risk-off/neutral) and sector implications.
- 6-10 sentences total. HARD CAP: ~150 tokens.
- Reference news items with [N1], [N2] citations.
- Reference at least ONE metric from inputs.

Your JSON response MUST include:
{
  "agent": "regime",
  "thesis": "1-2 sentence regime assessment",
  "regime_classification": "risk-on|risk-off|neutral",
  "supporting_signals": [
    {"signal": "...", "reading": "...", "interpretation": "..."}
  ],
  "sector_positioning": "overweight|neutral|underweight with reason",
  "correlation_regime": "high|low correlation environment",
  "recommendation": "How regime affects this specific stock",
  "confidence": 0-100
}

If uncertain, state uncertainty and default to neutral."""


def get_value_prompt() -> str:
    return """You are a VALUE ANALYST assessing valuation and margin of safety.

OUTPUT REQUIREMENTS:
- Discuss valuation framework and fair value estimate.
- Provide price target range with key assumptions.
- 8-12 sentences total. HARD CAP: ~180 tokens.
- Reference news items with [N1], [N2] citations.
- Reference at least ONE metric from inputs.

Your JSON response MUST include:
{
  "agent": "value",
  "thesis": "1-2 sentence valuation thesis",
  "flow_assessment": "accumulation|distribution|neutral",
  "volume_signals": [
    {"signal": "...", "value": "...", "interpretation": "..."}
  ],
  "price_target": {
    "low": 0,
    "mid": 0,
    "high": 0,
    "assumptions": "Key assumptions for range"
  },
  "margin_of_safety": "high|medium|low|negative",
  "recommendation": "Valuation-based recommendation",
  "verdict": "ENTER|HOLD|EXIT",
  "confidence": 0-100
}

If uncertain, state uncertainty and default to HOLD."""


def get_judge_prompt() -> str:
    return """You are the Judge for a $10,000 aggressive growth portfolio. You MUST base your decision ONLY on the four agent writeups below:
- Bull Agent Output
- Bear Agent Output
- Regime Agent Output
- Value Agent Output

Do NOT use external knowledge. Do NOT re-analyze fundamentals. Synthesize and decide from the agents only.

DECISION FRAMEWORK:
1. Asymmetric upside: Does the bull case show 2–3x+ upside vs defined risks? Is reward:risk clearly favorable?
2. Bear concerns: Are bear risks manageable (diversifiable, time-limited, or hedged) or fatal (permanent impairment, broken thesis)?
3. Regime fit: Is the regime tailwind or neutral for this name? If headwind, lean HOLD/EXIT unless bull case is exceptional.
4. Value anchor: Does the value agent support entry (attractive valuation, margin of safety) or warn of overvaluation?
5. Relative choice: Is this better than cash or other ideas? Avoid ENTER on marginal names; save ENTER for clear winners.

VERDICT RULES:
- ENTER: Bull + value supportive, bear risks manageable, regime not headwind, conviction-worthy upside. Use ENTER for strong opportunities; do not default everything to HOLD.
- HOLD: Mixed signals, incomplete agent outputs, or need more confirmation. Explicitly cite "mixed signal" or "incomplete inputs" when relevant.
- EXIT: Bear case dominant, regime headwind, or value says overvalued / negative margin of safety.

If one or more agent outputs are missing or failed: decide from the rest. Prefer ENTER when remaining agents are supportive; use HOLD only when truly mixed or incomplete.

OUTPUT FORMAT (STRICT):
Write a 4–6 sentence executive summary that:
1) States the decision (ENTER / HOLD / EXIT),
2) Explains the key reason(s) driving it,
3) Names the single biggest risk or uncertainty,
4) States one specific condition that would change your mind.

Then end with:
Verdict: ENTER | HOLD | EXIT
Confidence: <0–100>
Key Evidence:
- <one bullet from agent outputs>
- <one bullet from agent outputs>

Hard constraints:
- Max 6 sentences in the summary. No extra sections or lists beyond the two evidence bullets.
- Choose ENTER when evidence supports it; avoid defaulting everything to HOLD. If bull and value are positive and risks are manageable, prefer ENTER.
- Confidence: ENTER usually 65–95; HOLD 40–65; EXIT 20–50.

Your JSON response MUST include:
{
  "verdict": "ENTER|HOLD|EXIT",
  "confidence": 0-100,
  "reasoning": "4-6 sentence executive summary as above"
}"""


# ============================================================================
# Safe JSON Parsing
# ============================================================================

def safe_parse_json(content: str, agent_type: str) -> Dict[str, Any]:
    """
    Safely parse JSON from LLM response.
    If parsing fails, return a dict with raw content preserved.
    """
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        # Try to extract JSON from markdown code blocks
        json_match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', content)
        if json_match:
            try:
                return json.loads(json_match.group(1))
            except json.JSONDecodeError:
                pass

        # Return raw content if parsing fails
        return {
            "agent": agent_type,
            "raw": content,
            "parsed": None,
            "parse_error": "Failed to parse JSON response"
        }


# ============================================================================
# Background Task: Debate Pipeline
# ============================================================================

def run_debate_pipeline(run_id: str, extras: Optional[List[str]] = None):
    """
    Background task: Run the full debate pipeline with news + detailed prompts.
    """
    import sys
    app_dir = os.path.dirname(os.path.abspath(__file__))
    if os.path.exists(os.path.join(app_dir, "src")):
        sys.path.insert(0, app_dir)
    else:
        sys.path.insert(0, os.path.dirname(app_dir))

    try:
        import httpx

        append_log(run_id, "Debate pipeline started")

        # Load rocket_scores.json
        scores_data = read_artifact(run_id, "rocket_scores.json")
        if not scores_data:
            raise ValueError("rocket_scores.json not found. Run RocketScore first.")

        scores = json.loads(scores_data)
        append_log(run_id, f"Loaded {len(scores)} scored stocks")

        # Build rank map
        sorted_scores = sorted(scores, key=lambda x: x['rocket_score'], reverse=True)
        rank_map = {s['ticker']: i + 1 for i, s in enumerate(sorted_scores)}
        ticker_scores = {s['ticker']: s for s in scores}

        # Select candidates using fixed logic
        candidates = select_debate_candidates(sorted_scores, rank_map, extras)

        # Calculate breakdown
        breakdown = {
            "top23": len([c for c in candidates if c['selection_group'] == 'top23']),
            "edge": len([c for c in candidates if c['selection_group'] == 'edge']),
            "best_of_worst": len([c for c in candidates if c['selection_group'] == 'best_of_worst']),
            "extra": len([c for c in candidates if c['selection_group'] == 'extra'])
        }

        # Write selection IMMEDIATELY so loading page can display it
        write_artifact(run_id, "debate_selection.json", json.dumps({
            "runId": run_id,
            "createdAt": datetime.now(UTC).isoformat().replace('+00:00', 'Z'),
            "total": len(candidates),
            "breakdown": breakdown,
            "selections": candidates
        }, indent=2))

        append_log(run_id, f"Selected {len(candidates)} candidates: {breakdown}")

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
            "skipped": [],
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

            # Check skipped set before starting this ticker (user may have clicked Skip)
            skipped_set = read_skipped_set(run_id)
            if ticker in skipped_set:
                append_log(run_id, f"[{ticker}] skipped by user")
                write_artifact(run_id, f"debate/{ticker}_skipped.json", json.dumps({
                    "ticker": ticker,
                    "skipped": True,
                    "reason": "user",
                    "timestamp": datetime.now(UTC).isoformat().replace('+00:00', 'Z')
                }, indent=2))
                summary["skipped"].append(ticker)
                summary["byTicker"][ticker] = {
                    "verdict": "HOLD",
                    "confidence": 0,
                    "rocket_score": score['rocket_score'],
                    "rocket_rank": rank_map.get(ticker),
                    "sector": score.get('sector', 'Unknown'),
                    "tags": [],
                    "selection_group": candidate['selection_group'],
                    "skipped": True
                }
                summary["hold"].append(ticker)
                write_status(run_id, "debate", {
                    "done": i + 1,
                    "total": len(candidates),
                    "current": None,
                    "substep": "skipped",
                    "substep_done": 6,
                    "substep_total": 6,
                    "message": f"Skipped {ticker} ({i + 1}/{len(candidates)})"
                }, skipped=list(skipped_set))
                continue

            write_status(run_id, "debate", {
                "done": i,
                "total": len(candidates),
                "current": ticker,
                "substep": "starting",
                "substep_done": 0,
                "substep_total": 6,
                "message": f"Analyzing {ticker} ({i + 1}/{len(candidates)})"
            }, skipped=list(read_skipped_set(run_id)))

            try:
                if use_real_debate:
                    # Check skip AGAIN right before starting debate (user may have clicked during previous ticker)
                    if ticker in read_skipped_set(run_id):
                        append_log(run_id, f"[{ticker}] skipped by user (detected before debate start)")
                        raise ValueError("Ticker skipped by user")
                    
                    # Wrap in timeout to prevent infinite hangs (20s max per ticker — unblock skip ASAP)
                    try:
                        debate = asyncio.run(asyncio.wait_for(
                            run_single_debate_with_news(
                                run_id, ticker, score, candidate, api_key, api_url, i, len(candidates)
                            ),
                            timeout=20.0  # Global timeout: 20s max per ticker (reduced for faster skip)
                        ))
                    except asyncio.TimeoutError:
                        # Check if skipped before treating as timeout
                        if ticker in read_skipped_set(run_id):
                            append_log(run_id, f"[{ticker}] Debate timeout but ticker was skipped - treating as skip")
                            raise ValueError("Ticker skipped by user")
                        else:
                            append_log(run_id, f"[{ticker}] Debate timeout after 20s - treating as error")
                            raise
                else:
                    # Mock debate with realistic structure
                    verdict = 'BUY' if score['rocket_score'] >= 70 else ('HOLD' if score['rocket_score'] >= 50 else 'SELL')
                    confidence = min(85, max(20, int(score['rocket_score'])))

                    debate = {
                        "ticker": ticker,
                        "inputs": {
                            "metrics": {
                                "rocket_score": score['rocket_score'],
                                "rank": candidate['rank'],
                                "sector": score.get('sector', 'Unknown'),
                                "technical_score": score.get('technical_score', 0),
                                "volume_score": score.get('volume_score', 0),
                                "quality_score": score.get('quality_score', 0),
                                "macro_score": score.get('macro_score', 0)
                            },
                            "news": {"articles": [], "error": "Mock mode"}
                        },
                        "agents": {
                            "bull": {
                                "agent": "bull",
                                "thesis": f"Strong momentum and sector tailwinds support {ticker}",
                                "key_points": [{"claim": "Technical strength", "evidence": f"RocketScore {score['rocket_score']:.1f}", "source": "metrics"}],
                                "verdict": verdict,
                                "confidence": confidence
                            },
                            "bear": {
                                "agent": "bear",
                                "thesis": f"Valuation and macro risks warrant caution on {ticker}",
                                "key_points": [{"claim": "Market uncertainty", "evidence": "Macro conditions", "source": "regime"}],
                                "risks": [{"risk": "Sector rotation", "why": "Rate sensitivity", "monitoring_metric": "10Y yield"}],
                                "verdict": "HOLD" if verdict == "BUY" else verdict,
                                "confidence": max(30, 100 - confidence)
                            },
                            "regime": {
                                "agent": "regime",
                                "thesis": "Current regime is neutral with sector-specific opportunities",
                                "regime_classification": "neutral",
                                "sector_positioning": f"{score.get('sector', 'Unknown')} neutral",
                                "confidence": 60
                            },
                            "value": {
                                "agent": "value",
                                "thesis": f"Valuation is {'attractive' if score['rocket_score'] >= 60 else 'stretched'} at current levels",
                                "flow_assessment": "neutral",
                                "margin_of_safety": "medium" if score['rocket_score'] >= 60 else "low",
                                "verdict": verdict,
                                "confidence": confidence
                            }
                        },
                        "judge": {
                            "verdict": verdict,
                            "confidence": confidence,
                            "reasoning": f"Mock verdict based on RocketScore of {score['rocket_score']:.1f}. Configure DEEPSEEK_API_KEY for real AI analysis.",
                            "agreed_with": {"bull": ["momentum"], "bear": [], "regime": ["neutral stance"], "value": []},
                            "rejected": {"bull": [], "bear": ["excessive pessimism"], "regime": [], "value": []},
                            "where_agents_disagreed_most": ["risk assessment", "valuation multiple"],
                            "rocket_score_rank_review": f"Rank #{candidate['rank']} {'justified' if score['rocket_score'] >= 60 else 'may be overstated'}",
                            "tags": score.get('tags', [])[:4]
                        },
                        "final": {
                            "verdict": verdict,
                            "confidence": confidence,
                            "reasons": [f"RocketScore: {score['rocket_score']:.1f}", f"Rank: #{candidate['rank']}", f"Sector: {score.get('sector', 'Unknown')}"]
                        },
                        "createdAt": datetime.now(UTC).isoformat().replace('+00:00', 'Z'),
                        "selection_group": candidate['selection_group'],
                        "warnings": ["Mock debate - configure DEEPSEEK_API_KEY for real analysis"]
                    }

                # If ticker was skipped by user while in-flight, ignore late result (do not overwrite)
                skipped_now = read_skipped_set(run_id)
                if ticker in skipped_now:
                    append_log(run_id, f"[{ticker}] skipped by user (late result ignored)")
                    write_artifact(run_id, f"debate/{ticker}_skipped.json", json.dumps({
                        "ticker": ticker,
                        "skipped": True,
                        "reason": "user",
                        "timestamp": datetime.now(UTC).isoformat().replace('+00:00', 'Z')
                    }, indent=2))
                    summary["skipped"].append(ticker)
                    summary["byTicker"][ticker] = {
                        "verdict": "HOLD",
                        "confidence": 0,
                        "rocket_score": score['rocket_score'],
                        "rocket_rank": rank_map.get(ticker),
                        "sector": score.get('sector', 'Unknown'),
                        "tags": [],
                        "selection_group": candidate['selection_group'],
                        "skipped": True
                    }
                    summary["hold"].append(ticker)
                    write_status(run_id, "debate", {
                        "done": i + 1,
                        "total": len(candidates),
                        "current": None,
                        "substep": "skipped",
                        "substep_done": 6,
                        "substep_total": 6,
                        "message": f"Skipped {ticker} ({i + 1}/{len(candidates)})"
                    }, skipped=list(skipped_now))
                    continue

                # Extract verdict from judge
                judge = debate.get('judge', {})
                verdict_raw = (judge.get('verdict') or 'HOLD').upper()
                # Normalize verdict
                if verdict_raw in ('ENTER', 'BUY'):
                    verdict = 'BUY'
                elif verdict_raw in ('EXIT', 'SELL', 'WAIT'):
                    verdict = 'SELL'
                else:
                    verdict = 'HOLD'

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
                
                # Update progress after completion
                write_status(run_id, "debate", {
                    "done": i + 1,
                    "total": len(candidates),
                    "current": None,
                    "substep": "complete",
                    "substep_done": 6,
                    "substep_total": 6,
                    "message": f"Completed {ticker} ({i + 1}/{len(candidates)})"
                }, skipped=list(read_skipped_set(run_id)))

            except Exception as e:
                error_str = str(e)[:200]
                # Check if this was a skip (not a real error)
                skipped_now = read_skipped_set(run_id)
                if ticker in skipped_now and "skipped by user" in error_str.lower():
                    # Ticker was skipped - handle as skip, not error
                    append_log(run_id, f"[{ticker}] skipped by user (exception caught)")
                    write_artifact(run_id, f"debate/{ticker}_skipped.json", json.dumps({
                        "ticker": ticker,
                        "skipped": True,
                        "reason": "user",
                        "timestamp": datetime.now(UTC).isoformat().replace('+00:00', 'Z')
                    }, indent=2))
                    summary["skipped"].append(ticker)
                    summary["byTicker"][ticker] = {
                        "verdict": "HOLD",
                        "confidence": 0,
                        "rocket_score": score['rocket_score'],
                        "rocket_rank": rank_map.get(ticker),
                        "sector": score.get('sector', 'Unknown'),
                        "tags": [],
                        "selection_group": candidate['selection_group'],
                        "skipped": True
                    }
                    summary["hold"].append(ticker)
                    write_status(run_id, "debate", {
                        "done": i + 1,
                        "total": len(candidates),
                        "current": None,
                        "substep": "skipped",
                        "substep_done": 6,
                        "substep_total": 6,
                        "message": f"Skipped {ticker} ({i + 1}/{len(candidates)})"
                    }, skipped=list(skipped_now))
                    continue
                
                # Real error
                append_log(run_id, f"[{ticker}] FAILED: {error_str}")
                write_artifact(run_id, f"debate/{ticker}_error.json", json.dumps({
                    "ticker": ticker,
                    "error": error_str,
                    "timestamp": datetime.now(UTC).isoformat().replace('+00:00', 'Z')
                }, indent=2))
                
                # Update progress even on error
                write_status(run_id, "debate", {
                    "done": i + 1,
                    "total": len(candidates),
                    "current": None,
                    "substep": "error",
                    "substep_done": 0,
                    "substep_total": 6,
                    "message": f"Failed {ticker} ({i + 1}/{len(candidates)})"
                }, skipped=list(read_skipped_set(run_id)))

                # Add to HOLD on error so we still have an entry
                summary['byTicker'][ticker] = {
                    "verdict": "HOLD",
                    "confidence": 0,
                    "rocket_score": score['rocket_score'],
                    "rocket_rank": rank_map.get(ticker),
                    "sector": score.get('sector', 'Unknown'),
                    "tags": [],
                    "selection_group": candidate['selection_group'],
                    "error": error_str
                }
                summary['hold'].append(ticker)

        # Write summary
        write_artifact(run_id, "debate/debate_summary.json", json.dumps(summary, indent=2))

        # Force buy 8-12: at least 8, at most 12 positions for optimization
        MIN_BUY = 8
        MAX_BUY = 12
        append_log(run_id, f"Force buy check: {len(summary['buy'])} BUY, {len(summary['hold'])} HOLD, {len(summary['sell'])} SELL")
        
        if len(summary['buy']) < MIN_BUY:
            hold_candidates = [
                (ticker, summary['byTicker'][ticker])
                for ticker in summary['hold']
            ]
            hold_candidates.sort(
                key=lambda x: (-x[1].get('confidence', 0), -x[1].get('rocket_score', 0))
            )
            needed = MIN_BUY - len(summary['buy'])
            append_log(run_id, f"Promoting {needed} HOLD → BUY to reach MIN_BUY={MIN_BUY}")
            for ticker, data in hold_candidates[:needed]:
                summary['buy'].append(ticker)
                summary['hold'].remove(ticker)
                summary['byTicker'][ticker] = {**data, "verdict": "BUY", "promoted_from_hold": True}
            append_log(run_id, f"✓ Promoted {needed} HOLD to BUY (judge originally had {len(summary['buy']) - needed} ENTER)")
        else:
            append_log(run_id, f"✓ Already have {len(summary['buy'])} BUY (>= MIN_BUY={MIN_BUY}), no promotion needed")

        # Create final_buys.json with meta breakdown
        # Force buy 8-12: cap at MAX_BUY, pad to MIN_BUY from HOLD if needed
        append_log(run_id, f"Building final_buys from {len(summary['buy'])} BUY candidates")
        final_buy_candidates = [
            {"ticker": ticker, **summary['byTicker'][ticker], "conviction": "high"}
            for ticker in summary['buy']
        ]
        final_buy_candidates.sort(key=lambda x: (-x.get('confidence', 0), -x.get('rocket_score', 0)))
        
        # Cap at MAX_BUY (12)
        if len(final_buy_candidates) > MAX_BUY:
            append_log(run_id, f"Capping {len(final_buy_candidates)} BUY → {MAX_BUY} (MAX_BUY limit)")
        final_buys = final_buy_candidates[:MAX_BUY]
        
        # Ensure at least MIN_BUY (8) by filling from remaining HOLDs if still short
        if len(final_buys) < MIN_BUY:
            remaining_hold = [
                {"ticker": ticker, **summary['byTicker'][ticker], "conviction": "low"}
                for ticker in summary['hold']
            ]
            remaining_hold.sort(key=lambda x: (-x.get('confidence', 0), -x.get('rocket_score', 0)))
            needed = MIN_BUY - len(final_buys)
            append_log(run_id, f"Padding final_buys: {len(final_buys)} → {MIN_BUY} by adding {needed} HOLD")
            final_buys.extend(remaining_hold[:needed])
            append_log(run_id, f"✓ Added {needed} HOLD candidates to final_buys to reach MIN_BUY={MIN_BUY}")
        
        append_log(run_id, f"✓ Final buys: {len(final_buys)} positions (target {MIN_BUY}-{MAX_BUY})")
        append_log(run_id, f"  Tickers: {[f['ticker'] for f in final_buys]}")

        # Calculate selection groups breakdown for final buys
        final_breakdown = {
            "top23": len([f for f in final_buys if f.get('selection_group') == 'top23']),
            "edge": len([f for f in final_buys if f.get('selection_group') == 'edge']),
            "best_of_worst": len([f for f in final_buys if f.get('selection_group') == 'best_of_worst']),
            "extra": len([f for f in final_buys if f.get('selection_group') == 'extra'])
        }

        write_artifact(run_id, "final_buys.json", json.dumps({
            "runId": run_id,
            "createdAt": datetime.now(UTC).isoformat().replace('+00:00', 'Z'),
            "selection": {
                "total_buy": len(summary['buy']),
                "selected": len(final_buys)
            },
            "meta": {
                "generatedAt": datetime.now(UTC).isoformat().replace('+00:00', 'Z'),
                "count": len(final_buys),
                "selection_groups_breakdown": final_breakdown
            },
            "items": final_buys
        }, indent=2))

        # Final status
        write_status(run_id, "debate_ready", {
            "done": len(candidates),
            "total": len(candidates),
            "current": None,
            "message": f"Debate complete: {len(summary['buy'])} BUY, {len(summary['hold'])} HOLD, {len(summary['sell'])} SELL"
        }, skipped=list(read_skipped_set(run_id)))

        append_log(run_id, f"Debate complete. BUY: {len(summary['buy'])}, HOLD: {len(summary['hold'])}, SELL: {len(summary['sell'])}")

    except Exception as e:
        error_str = str(e)[:500]
        append_log(run_id, f"ERROR: {error_str}")
        write_status(run_id, "error", {
            "done": 0,
            "total": 0,
            "current": None,
            "message": error_str
        }, errors=[error_str])


async def run_single_debate_with_news(
    run_id: str, ticker: str, score: dict, candidate: dict,
    api_key: str, api_url: str, stock_idx: int, total_stocks: int
) -> dict:
    """Run debate for a single ticker with news context and detailed prompts."""
    import httpx

    API_TIMEOUT = 30.0  # Increased for detailed responses

    def update_substep(substep_done: int, substep_name: str):
        write_status(run_id, "debate", {
            "done": stock_idx,
            "total": total_stocks,
            "current": ticker,
            "substep": substep_name,
            "substep_done": substep_done,
            "substep_total": 6,
            "message": f"{ticker}: {substep_name} ({substep_done}/6)"
        })

    # Step 1: Fetch news (with hard timeout in fetch_news_for_ticker)
    update_substep(0, "Fetching news")
    append_log(run_id, f"[{ticker}] starting Fetching news")
    news_data = await fetch_news_for_ticker(ticker, days=14, limit=8)
    if news_data.get("error"):
        append_log(run_id, f"[{ticker}] Fetching news error: {news_data['error'][:80]}")
    else:
        append_log(run_id, f"[{ticker}] completed Fetching news")

    # Cache news for this ticker
    write_artifact(run_id, f"news/{ticker}.json", json.dumps(news_data, indent=2))

    # Check if ticker was skipped after news fetch (user may have clicked Skip)
    if ticker in read_skipped_set(run_id):
        append_log(run_id, f"[{ticker}] skipped by user (after news fetch)")
        # Return early - debate loop will handle skipped state
        raise ValueError("Ticker skipped by user")

    # Build comprehensive context
    metrics_context = {
        "ticker": ticker,
        "sector": score.get('sector', 'Unknown'),
        "current_price": score.get('current_price', 0),
        "rocket_score": round(score.get('rocket_score', 0), 1),
        "rank": candidate.get('rank'),
        "total_stocks": total_stocks,
        "technical_score": round(score.get('technical_score', 0), 1),
        "volume_score": round(score.get('volume_score', 0), 1),
        "quality_score": round(score.get('quality_score', 0), 1),
        "macro_score": round(score.get('macro_score', 0), 1),
        "tags": score.get('tags', [])[:5],
        "signal_labels": score.get('signal_labels', [])[:3],
        "selection_group": candidate.get('selection_group')
    }

    # Format news for prompts
    news_context = "RECENT NEWS:\n"
    if news_data.get('articles'):
        for article in news_data['articles']:
            news_context += f"[{article['id']}] {article['date']} - {article['source']}: {article['title']}\n"
            if article.get('summary'):
                news_context += f"    {article['summary'][:150]}...\n"
    else:
        news_context += "No recent news available.\n"

    full_context = f"""STOCK METRICS:
{json.dumps(metrics_context, indent=2)}

{news_context}"""

    async def call_agent(agent_type: str, prompt: str, user_context: str = None) -> dict:
        """Call agent with timeout, retry, heartbeat, and logging. Checks skipped set periodically."""
        if user_context is None:
            user_context = full_context
        
        # Check if ticker was skipped before starting
        if ticker in read_skipped_set(run_id):
            append_log(run_id, f"[{ticker}] {agent_type} agent skipped (ticker in skipped set)")
            return {
                "agent": agent_type,
                "raw": "Skipped by user",
                "parsed": None,
                "error": "Skipped by user",
                "thesis": f"{agent_type} agent skipped"
            }
        
        AGENT_TIMEOUT = 12.0  # Hard timeout per call — fail faster so skip unblocks sooner
        MAX_RETRIES = 0  # No retries - fail fast if timeout
        HEARTBEAT_INTERVAL = 3.0  # Check skipped every 3s (very aggressive)
        
        append_log(run_id, f"[{ticker}] Starting {agent_type} agent...")
        start_time = asyncio.get_event_loop().time()
        
        for attempt in range(MAX_RETRIES + 1):
            try:
                # Start heartbeat task
                heartbeat_task = None
                heartbeat_stop = asyncio.Event()
                
                async def heartbeat():
                    elapsed = 0
                    while not heartbeat_stop.is_set():
                        await asyncio.sleep(HEARTBEAT_INTERVAL)
                        if not heartbeat_stop.is_set():
                            # Check if ticker was skipped during wait - raise exception to cancel immediately
                            if ticker in read_skipped_set(run_id):
                                append_log(run_id, f"[{ticker}] {agent_type} agent cancelled (ticker skipped during wait)")
                                heartbeat_stop.set()
                                # Raise exception to cancel the HTTP request
                                raise asyncio.CancelledError(f"Ticker {ticker} skipped by user")
                            elapsed += HEARTBEAT_INTERVAL
                            append_log(run_id, f"[{ticker}] Still waiting on {agent_type}... elapsed={int(elapsed)}s")
                
                heartbeat_task = asyncio.create_task(heartbeat())
                
                try:
                    # Use stricter timeout: connect + read combined
                    timeout_config = httpx.Timeout(connect=5.0, read=AGENT_TIMEOUT, write=5.0, pool=5.0)
                    async with httpx.AsyncClient(timeout=timeout_config) as client:
                        # Check skipped one more time right before the call
                        if ticker in read_skipped_set(run_id):
                            raise asyncio.CancelledError(f"Ticker {ticker} skipped by user")
                        
                        response = await client.post(
                            f"{api_url}/chat/completions",
                            headers={"Authorization": f"Bearer {api_key}"},
                            json={
                                "model": "deepseek-chat",
                                "messages": [
                                    {"role": "system", "content": prompt},
                                    {"role": "user", "content": user_context}
                                ],
                                "temperature": 0.4,
                                "max_tokens": 1200,
                                "response_format": {"type": "json_object"}
                            }
                        )
                        response.raise_for_status()
                        result = response.json()
                        content = result["choices"][0]["message"]["content"]
                        
                        # Check if ticker was skipped while waiting for response
                        if ticker in read_skipped_set(run_id):
                            append_log(run_id, f"[{ticker}] {agent_type} agent result ignored (ticker skipped)")
                            # Stop heartbeat
                            heartbeat_stop.set()
                            if heartbeat_task:
                                heartbeat_task.cancel()
                                try:
                                    await heartbeat_task
                                except asyncio.CancelledError:
                                    pass
                            return {
                                "agent": agent_type,
                                "raw": "Skipped by user",
                                "parsed": None,
                                "error": "Skipped by user",
                                "thesis": f"{agent_type} agent skipped"
                            }
                        
                        # Stop heartbeat
                        heartbeat_stop.set()
                        if heartbeat_task:
                            heartbeat_task.cancel()
                            try:
                                await heartbeat_task
                            except asyncio.CancelledError:
                                pass
                        
                        elapsed = int(asyncio.get_event_loop().time() - start_time)
                        append_log(run_id, f"[{ticker}] {agent_type} agent complete (elapsed={elapsed}s)")
                        
                        parsed = safe_parse_json(content, agent_type)
                        parsed["raw"] = content
                        return parsed
                        
                except (asyncio.TimeoutError, asyncio.CancelledError) as e:
                    heartbeat_stop.set()
                    if heartbeat_task:
                        heartbeat_task.cancel()
                        try:
                            await heartbeat_task
                        except asyncio.CancelledError:
                            pass
                    
                    # If cancelled due to skip, propagate immediately
                    if isinstance(e, asyncio.CancelledError) and "skipped" in str(e).lower():
                        raise e
                    
                    elapsed = int(asyncio.get_event_loop().time() - start_time)
                    error_msg = f"Timeout after {elapsed}s"
                    append_log(run_id, f"[{ticker}] {agent_type} agent timeout: {error_msg}")
                    
                    # No retries - fail fast
                    return {
                        "agent": agent_type,
                        "raw": f"Timeout: {error_msg}",
                        "parsed": None,
                        "error": error_msg,
                        "thesis": f"{agent_type} agent timeout after {elapsed}s"
                    }
                        
            except asyncio.CancelledError as e:
                # Propagate skip cancellation immediately
                if "skipped" in str(e).lower():
                    raise e
                # Otherwise treat as error
                elapsed = int(asyncio.get_event_loop().time() - start_time)
                error_msg = str(e)[:200]
                append_log(run_id, f"[{ticker}] {agent_type} agent cancelled: {error_msg}")
                return {
                    "agent": agent_type,
                    "raw": str(e),
                    "parsed": None,
                    "error": error_msg,
                    "thesis": f"Agent cancelled: {str(e)[:100]}"
                }
            except Exception as e:
                elapsed = int(asyncio.get_event_loop().time() - start_time)
                error_msg = str(e)[:200]
                append_log(run_id, f"[{ticker}] {agent_type} agent failed: {error_msg}")
                
                # No retries - fail fast
                return {
                    "agent": agent_type,
                    "raw": str(e),
                    "parsed": None,
                    "error": error_msg,
                    "thesis": f"Agent failed: {str(e)[:100]}"
                }
        
        # Should never reach here, but fallback
        return {
            "agent": agent_type,
            "raw": "Unknown error",
            "parsed": None,
            "error": "Unknown error",
            "thesis": f"{agent_type} agent failed"
        }

    # Step 2-5: Run all 4 agents in parallel
    update_substep(1, "Running Bull/Bear/Regime/Value agents")
    append_log(run_id, f"[{ticker}] Starting 4 agents in parallel...")

    # Run agents with cancellation support - if any raises CancelledError due to skip, propagate it
    # Use return_exceptions=True to catch CancelledError in results
    results = await asyncio.gather(
        call_agent("bull", get_bull_prompt()),
        call_agent("bear", get_bear_prompt()),
        call_agent("regime", get_regime_prompt()),
        call_agent("value", get_value_prompt()),
        return_exceptions=True
    )
    
    # Check for skip cancellation in results BEFORE processing
    for i, result in enumerate(results):
        if isinstance(result, asyncio.CancelledError):
            if "skipped" in str(result).lower():
                append_log(run_id, f"[{ticker}] skipped by user (during agent {['bull', 'bear', 'regime', 'value'][i]})")
                raise ValueError("Ticker skipped by user")
        elif isinstance(result, Exception) and "skipped" in str(result).lower():
            append_log(run_id, f"[{ticker}] skipped by user (agent {['bull', 'bear', 'regime', 'value'][i]} returned skip)")
            raise ValueError("Ticker skipped by user")

    bull = results[0] if not isinstance(results[0], Exception) else {"agent": "bull", "thesis": "Failed", "error": str(results[0]), "raw": str(results[0])}
    bear = results[1] if not isinstance(results[1], Exception) else {"agent": "bear", "thesis": "Failed", "error": str(results[1]), "raw": str(results[1])}
    regime = results[2] if not isinstance(results[2], Exception) else {"agent": "regime", "thesis": "Failed", "error": str(results[2]), "raw": str(results[2])}
    value = results[3] if not isinstance(results[3], Exception) else {"agent": "value", "thesis": "Failed", "error": str(results[3]), "raw": str(results[3])}

    # Check if ticker was skipped after agents complete
    if ticker in read_skipped_set(run_id):
        append_log(run_id, f"[{ticker}] skipped by user (after agents complete)")
        raise ValueError("Ticker skipped by user")

    append_log(run_id, f"[{ticker}] 4 agents complete. Starting judge...")
    update_substep(5, "Running Judge")

    # Step 6: Run judge with ONLY the 4 agent outputs (no metrics, no news)
    judge_context = f"""Bull Agent Output:
{json.dumps(bull, indent=2)[:2000]}

Bear Agent Output:
{json.dumps(bear, indent=2)[:2000]}

Regime Agent Output:
{json.dumps(regime, indent=2)[:1500]}

Value Agent Output:
{json.dumps(value, indent=2)[:2000]}"""

    # Judge with watchdog timeout
    JUDGE_TIMEOUT = 12.0
    judge_start = asyncio.get_event_loop().time()
    
    # Check skipped before judge
    if ticker in read_skipped_set(run_id):
        append_log(run_id, f"[{ticker}] skipped by user (before judge)")
        raise ValueError("Ticker skipped by user")
    
    try:
        judge = await asyncio.wait_for(
            call_agent("judge", get_judge_prompt(), judge_context),
            timeout=JUDGE_TIMEOUT
        )
        
        # Verify judge has required fields
        if not judge.get("verdict"):
            judge["verdict"] = "HOLD"
        if not judge.get("confidence"):
            judge["confidence"] = 50
        if not judge.get("reasoning"):
            judge["reasoning"] = "Judge output incomplete"
            
    except asyncio.TimeoutError:
        # Check if skipped before treating as timeout
        if ticker in read_skipped_set(run_id):
            append_log(run_id, f"[{ticker}] Judge timeout but ticker was skipped")
            raise ValueError("Ticker skipped by user")
        elapsed = int(asyncio.get_event_loop().time() - judge_start)
        append_log(run_id, f"[{ticker}] Judge timeout after {elapsed}s. Using fallback HOLD.")
        judge = {
            "verdict": "HOLD",
            "confidence": 30,
            "reasoning": f"Judge timeout after {elapsed}s. Mixed signal / incomplete inputs. Defaulting to HOLD due to processing timeout.",
            "error": f"Timeout after {elapsed}s",
            "raw": f"Judge timeout after {elapsed}s",
            "judge_timeout": True
        }
    except asyncio.CancelledError as e:
        if "skipped" in str(e).lower():
            raise ValueError("Ticker skipped by user")
        raise
    except Exception as e:
        error_msg = str(e)[:200]
        append_log(run_id, f"[{ticker}] Judge failed: {error_msg}")
        judge = {
            "verdict": "HOLD",
            "confidence": 30,
            "reasoning": f"Judge failed: {error_msg[:100]}. Mixed signal / incomplete inputs.",
            "error": error_msg,
            "raw": str(e)
        }

    update_substep(6, "Complete")

    # Normalize verdict
    verdict_raw = (judge.get('verdict') or 'HOLD').upper()
    if verdict_raw in ('ENTER', 'BUY'):
        final_verdict = 'BUY'
    elif verdict_raw in ('EXIT', 'SELL', 'WAIT'):
        final_verdict = 'SELL'
    else:
        final_verdict = 'HOLD'

    return {
        "ticker": ticker,
        "rank": candidate.get('rank'),
        "rocket_score": score.get('rocket_score', 0),
        "selection_group": candidate.get('selection_group'),
        "inputs": {
            "metrics": metrics_context,
            "news": news_data
        },
        "agents": {
            "bull": bull,
            "bear": bear,
            "regime": regime,
            "value": value
        },
        "judge": judge,
        "final": {
            "verdict": final_verdict,
            "confidence": judge.get('confidence', 50),
            "reasons": [
                judge.get('reasoning', ''),
                f"RocketScore: {score.get('rocket_score', 0):.1f}",
                f"Rank: #{candidate.get('rank')}"
            ]
        },
        "createdAt": datetime.now(UTC).isoformat().replace('+00:00', 'Z')
    }


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

        # Run directory for this run (backend stores in DATA_DIR/runs/run_id)
        run_dir = os.path.join(RUNS_DIR, run_id)

        # Run optimization (pass run_dir so optimizer reads rocket_scores.json and final_buys.json from correct path)
        portfolio = optimize_portfolio(
            run_id,
            capital=params.capital,
            max_weight=params.max_weight,
            sector_cap=params.sector_cap,
            min_positions=len(eligible),
            max_positions=len(eligible),
            risk_lambda=params.risk_lambda,
            run_dir=run_dir
        )

        # Write portfolio to run artifacts (optimizer returns dict; we persist it)
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
    # Include skipped list from persisted file so UI can show "Skipped by user"
    skipped_list = list(read_skipped_set(run_id))
    if skipped_list:
        status["skipped"] = sorted(skipped_list)
    return StatusResponse(**status)


@app.post("/run/{run_id}/skip")
async def skip_ticker(run_id: str, req: SkipRequest):
    """
    Mark the current (or specified) ticker as skipped so the orchestrator advances.
    Recorded in run metadata; in-flight work for that ticker will be ignored when it completes.
    This is IMMEDIATE - the debate loop checks skipped set every 5s and will cancel in-flight calls.
    """
    if not read_artifact(run_id, "status.json"):
        raise HTTPException(status_code=404, detail="Run not found")

    ticker = (req.ticker or "").strip().upper()
    if not ticker:
        raise HTTPException(status_code=400, detail="ticker required")

    # Add to skipped set immediately (atomic write)
    skipped_set = add_skipped(run_id, ticker, req.reason or "user_timeout")
    append_log(run_id, f"[{ticker}] ⏭️ SKIPPED by user (reason: {req.reason or 'user_timeout'}) - will cancel in-flight calls")

    # Force flush log immediately
    run_dir = get_run_dir(run_id)
    logs_path = os.path.join(run_dir, "logs.txt")
    try:
        with open(logs_path, 'a') as f:
            f.flush()
            os.fsync(f.fileno())
    except:
        pass

    # Refresh status so progress includes skipped (bump updatedAt so UI sees change immediately).
    # If we're skipping the CURRENT ticker, clear current and set message so UI stops showing
    # "Analyzing X" and doesn't look frozen while in-flight work finishes.
    status_data = read_artifact(run_id, "status.json")
    if status_data:
        status = json.loads(status_data)
        status["skipped"] = sorted(list(skipped_set))
        status["updatedAt"] = datetime.now(UTC).isoformat().replace('+00:00', 'Z')
        prog = status.get("progress") or {}
        if prog.get("current") == ticker:
            prog["current"] = None
            prog["message"] = f"Skipped {ticker}. Finishing up, then next stock…"
            prog["substep"] = "skipped"
            prog["substep_done"] = prog.get("substep_total") or 6
            prog["substep_total"] = prog.get("substep_total") or 6
            status["progress"] = prog
        write_artifact(run_id, "status.json", json.dumps(status, indent=2))
        # Force flush status
        try:
            status_path = os.path.join(run_dir, "status.json")
            with open(status_path, 'r+') as f:
                f.flush()
                os.fsync(f.fileno())
        except:
            pass

    return {"success": True, "ticker": ticker, "reason": req.reason or "user_timeout", "skipped_set": sorted(list(skipped_set))}


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
# Debug Endpoints
# ============================================================================

@app.get("/run/{run_id}/debate/debug")
async def debate_debug(run_id: str):
    """
    Debug endpoint: returns candidate count, breakdown, and per-ticker agent output status.
    """
    selection_data = read_artifact(run_id, "debate_selection.json")
    summary_data = read_artifact(run_id, "debate/debate_summary.json")

    result = {
        "runId": run_id,
        "selection": None,
        "summary": None,
        "per_ticker": {}
    }

    if selection_data:
        sel = json.loads(selection_data)
        result["selection"] = {
            "total": sel.get("total"),
            "breakdown": sel.get("breakdown"),
            "tickers": [s["ticker"] for s in sel.get("selections", [])]
        }

    if summary_data:
        sm = json.loads(summary_data)
        result["summary"] = {
            "buy_count": len(sm.get("buy", [])),
            "hold_count": len(sm.get("hold", [])),
            "sell_count": len(sm.get("sell", [])),
            "total": len(sm.get("byTicker", {}))
        }

        # Check per-ticker agent presence
        for ticker in sm.get("byTicker", {}):
            ticker_data = read_artifact(run_id, f"debate/{ticker}.json")
            agents_status = {}
            if ticker_data:
                td = json.loads(ticker_data)
                agents = td.get("agents", {})
                for agent_name in ["bull", "bear", "regime", "value"]:
                    agent = agents.get(agent_name)
                    if agent:
                        agents_status[agent_name] = {
                            "present": True,
                            "has_thesis": bool(agent.get("thesis")),
                            "has_raw": bool(agent.get("raw")),
                            "has_error": bool(agent.get("error"))
                        }
                    else:
                        agents_status[agent_name] = {"present": False}

                judge = td.get("judge", {})
                agents_status["judge"] = {
                    "present": bool(judge),
                    "verdict": judge.get("verdict"),
                    "confidence": judge.get("confidence"),
                    "has_raw": bool(judge.get("raw"))
                }

                has_news = bool(td.get("inputs", {}).get("news", {}).get("articles"))
                agents_status["news_present"] = has_news

            result["per_ticker"][ticker] = agents_status

    return JSONResponse(content=result)


@app.get("/run/{run_id}/debate/raw")
async def debate_raw(run_id: str, request: Request):
    """
    Debug endpoint: returns raw agent strings + news for a specific ticker.
    Usage: /run/{runId}/debate/raw?ticker=AAPL
    """
    ticker = request.query_params.get("ticker", "")
    if not ticker:
        raise HTTPException(status_code=400, detail="ticker query param required")

    ticker_data = read_artifact(run_id, f"debate/{ticker}.json")
    if not ticker_data:
        raise HTTPException(status_code=404, detail=f"No debate data for {ticker}")

    td = json.loads(ticker_data)

    raw_outputs = {}
    agents = td.get("agents", {})
    for agent_name in ["bull", "bear", "regime", "value"]:
        agent = agents.get(agent_name, {})
        raw_outputs[agent_name] = agent.get("raw", json.dumps(agent))

    judge = td.get("judge", {})
    raw_outputs["judge"] = judge.get("raw", json.dumps(judge))

    news_data = td.get("inputs", {}).get("news", {})

    return JSONResponse(content={
        "ticker": ticker,
        "raw_outputs": raw_outputs,
        "news": news_data
    })


# ============================================================================
# Main
# ============================================================================

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
