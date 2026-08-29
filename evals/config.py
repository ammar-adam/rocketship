"""
Frozen configuration for the RocketShip eval harness.

Everything that determines *what* gets evaluated lives here so a run is
reproducible from the repo alone. Changing any value in this file invalidates
comparability with previously published results, so treat it as append-only
once numbers have been reported.
"""
from __future__ import annotations

import os

# ---------------------------------------------------------------------------
# Universe: 50 S&P 500 names, hand-frozen across all 11 GICS sectors.
# Hard-coded rather than scraped so the eval set never drifts with index
# membership or a Wikipedia edit.
# ---------------------------------------------------------------------------
UNIVERSE: dict[str, list[str]] = {
    "Technology": ["AAPL", "MSFT", "NVDA", "AVGO", "CRM", "AMD", "ORCL", "ADBE"],
    "Communication Services": ["GOOGL", "META", "NFLX", "DIS"],
    "Consumer Discretionary": ["AMZN", "TSLA", "HD", "MCD", "NKE"],
    "Consumer Staples": ["PG", "KO", "PEP", "COST", "WMT"],
    "Health Care": ["UNH", "JNJ", "LLY", "ABBV", "TMO", "PFE"],
    "Financials": ["JPM", "BAC", "GS", "MS", "BRK-B", "V"],
    "Industrials": ["CAT", "BA", "GE", "UNP", "HON"],
    "Energy": ["XOM", "CVX", "COP", "SLB"],
    "Utilities": ["NEE", "DUK", "SO"],
    "Real Estate": ["AMT", "PLD"],
    "Materials": ["LIN", "FCX"],
}

TICKERS: list[str] = [t for names in UNIVERSE.values() for t in names]
SECTOR_OF: dict[str, str] = {
    t: sector for sector, names in UNIVERSE.items() for t in names
}

BENCHMARK = "SPY"

# ---------------------------------------------------------------------------
# As-of dates.
#
# Chosen as recent as the labels allow: the most recent date still needs a full
# 3-month forward window of realised prices. They are deliberately clustered in
# the last 12 months to limit (NOT eliminate) the LLM's training-data leak --
# see the "Known leaks" section of evals/README.md.
# ---------------------------------------------------------------------------
AS_OF_DATES: list[str] = [
    "2025-09-15",
    "2025-11-17",
    "2026-01-20",
    "2026-03-16",
]

# Forward-return horizons, in trading days.
HORIZONS: dict[str, int] = {"1M": 21, "3M": 63}

# Trading days of price history handed to the scorer at each as-of date.
# Matches the product's LOOKBACK_DAYS default in src/config.py.
LOOKBACK_TRADING_DAYS = 252

# ---------------------------------------------------------------------------
# Arms under comparison.
# ---------------------------------------------------------------------------
ARMS: list[str] = [
    "full_debate",      # production: bull + bear + regime + value, then judge
    "single_call",      # one call, same context and same asks, no debate
    "judge_only",       # judge prompt fed the context directly
    "debate_no_bear",   # bull + regime + value, then judge
    "debate_no_news",   # production debate, news stripped from the context
    "random",           # equal-weight random scores -- the floor
]

# LLM-free arms skip the API entirely.
OFFLINE_ARMS: set[str] = {"random"}

# ---------------------------------------------------------------------------
# Model + variance.
# ---------------------------------------------------------------------------
MODEL = "deepseek-chat"
TEMPERATURE = 0.4          # matches backend/main.py
MAX_TOKENS = 2400          # matches backend/main.py
AGENT_TIMEOUT_S = 60.0     # more generous than prod's 25s; we want completions,
                           # not the HOLD@30 timeout fallback, polluting variance
N_SEEDS = 5

def seeds() -> list[int]:
    return list(range(1, N_SEEDS + 1))

# DeepSeek list pricing, USD per 1M tokens (cache-miss rates).
# Override via env if the published rates move.
PRICE_IN_PER_MTOK = float(os.environ.get("DEEPSEEK_PRICE_IN", "0.27"))
PRICE_OUT_PER_MTOK = float(os.environ.get("DEEPSEEK_PRICE_OUT", "1.10"))

# ---------------------------------------------------------------------------
# News.
# ---------------------------------------------------------------------------
NEWS_LOOKBACK_DAYS = 14    # matches backend/main.py
NEWS_LIMIT = 8             # matches backend/main.py

# ---------------------------------------------------------------------------
# Paths.
# ---------------------------------------------------------------------------
_HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(_HERE)

FIXTURE_DIR = os.path.join(_HERE, "fixtures")
EVAL_SET_PATH = os.path.join(FIXTURE_DIR, "eval_set.json")
PRICES_PATH = os.path.join(FIXTURE_DIR, "prices.csv.gz")
NEWS_FIXTURE_PATH = os.path.join(FIXTURE_DIR, "news.json")

CACHE_DIR = os.path.join(_HERE, "cache")
RESULTS_DIR = os.path.join(REPO_ROOT, "results")
RAW_DIR = os.path.join(RESULTS_DIR, "raw")
SUMMARY_PATH = os.path.join(RESULTS_DIR, "summary.md")
