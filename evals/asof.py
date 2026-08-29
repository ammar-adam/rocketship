"""
As-of data layer.

The product's fetch path is anchored to *today*: src/data_fetcher.fetch_ohlcv
calls yf.download(period=f"{lookback_days}d") with no `end`, and caches under a
today-stamped key. That is fine in production and useless for backtesting, so
the eval reads the frozen panel instead and truncates it at the as-of session.

Nothing in this module writes to the product. It reuses src/signals.py and
src/rocket_score.py unmodified, with one surgical exception documented in
`neutralise_quality_score` below.
"""
from __future__ import annotations

import os
import sys
from functools import lru_cache

import pandas as pd

from evals import config as C

sys.path.insert(0, C.REPO_ROOT)


class LeakError(AssertionError):
    """Raised when data dated at or after the as-of date reaches the pipeline."""


# ---------------------------------------------------------------------------
# Price panel
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def load_panel() -> pd.DataFrame:
    if not os.path.exists(C.PRICES_PATH):
        raise SystemExit(
            f"Missing price fixture at {C.PRICES_PATH}. Run: python -m evals.build_fixture"
        )
    return pd.read_csv(C.PRICES_PATH, index_col=0, parse_dates=True)


def as_of_window(ticker: str, as_of: str) -> pd.DataFrame:
    """
    OHLCV for `ticker` ending at the last session on or before `as_of`.

    Returns the same column names and orientation src/signals.py and
    src/rocket_score.py expect, so those modules run unmodified.
    """
    panel = load_panel()
    cols = {}
    for field in ("Open", "High", "Low", "Close", "Volume"):
        col = f"{field}|{ticker}"
        if col in panel.columns:
            cols[field] = panel[col]
    if "Close" not in cols:
        raise KeyError(f"No price data for {ticker} in the fixture panel.")

    df = pd.DataFrame(cols).dropna(subset=["Close"])

    cutoff = pd.Timestamp(as_of)
    df = df.loc[df.index <= cutoff]
    df = df.tail(C.LOOKBACK_TRADING_DAYS)

    assert_prices_are_as_of(df, as_of, ticker)
    return df


def assert_prices_are_as_of(df: pd.DataFrame, as_of: str, ticker: str) -> None:
    """Fail loudly if any price row is dated after the as-of date."""
    if df.empty:
        raise LeakError(f"{ticker} @ {as_of}: empty as-of window")
    latest = df.index.max()
    if latest > pd.Timestamp(as_of):
        raise LeakError(
            f"{ticker} @ {as_of}: price window contains a future session ({latest.date()}). "
            "This is a look-ahead leak; refusing to score."
        )


# ---------------------------------------------------------------------------
# Scoring, with the fundamentals leak closed
# ---------------------------------------------------------------------------

_QUALITY_NEUTRAL_NOTE = (
    "Quality pinned to the neutral 50 the product itself falls back to when "
    "yfinance returns no fundamentals. src/rocket_score.compute_quality_score "
    "reads yf.Ticker(t).info, which serves CURRENT operatingMargins / "
    "revenueGrowth / marketCap regardless of as-of date. There is no "
    "point-in-time fundamentals source available here, so the eval removes the "
    "component rather than backtesting on tomorrow's balance sheet."
)


def neutralise_quality_score():
    """
    Monkeypatch (eval process only) the one scoring component that cannot be
    made point-in-time. Applied to every arm identically, so it does not bias
    the comparison -- but it does mean absolute RocketScores here are not
    comparable to production's.
    """
    import src.rocket_score as rs

    def _neutral(ticker: str, signals: dict):
        return 50.0, {
            "raw_metrics": {},
            "rationale": ["Quality neutral (50): no point-in-time fundamentals available."],
            "warnings": [_QUALITY_NEUTRAL_NOTE],
        }

    rs.compute_quality_score = _neutral
    return _QUALITY_NEUTRAL_NOTE


def score_as_of(ticker: str, as_of: str) -> dict:
    """
    Run the product's RocketScore over the as-of window.

    Returns a row shaped like an entry of the product's rocket_scores.json, so
    the same context builder can feed it to the agents.
    """
    from src.signals import compute_signals
    from src.rocket_score import compute_rocket_score

    df = as_of_window(ticker, as_of)
    signals = compute_signals(df)
    sector = C.SECTOR_OF[ticker]
    sd = compute_rocket_score(ticker, df, signals, sector)

    return {
        "ticker": ticker,
        "sector": sector,
        "as_of_date": as_of,
        "current_price": float(df["Close"].iloc[-1]),
        "rocket_score": sd["rocket_score"],
        "technical_score": sd["technical_score"],
        "volume_score": sd["volume_score"],
        "quality_score": sd["quality_score"],
        "macro_score": sd["macro_score"],
        "tags": sd.get("tags", []),
        "signal_labels": sd.get("signal_labels", []),
        "technical_details": sd.get("technical_details"),
        "volume_details": sd.get("volume_details"),
        "quality_details": sd.get("quality_details"),
        "macro_details": sd.get("macro_details"),
    }
