"""
Build the frozen eval set.

Downloads a daily price panel for the universe + benchmark once, writes it to
evals/fixtures/prices.csv.gz, and derives forward-return labels for every
(ticker, as_of_date) pair into evals/fixtures/eval_set.json.

After this runs, the whole eval is reproducible offline: no arm ever calls
yfinance again. Re-run only when you intend to change the eval set.

    python -m evals.build_fixture
"""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

from evals import config as C


def _download_panel() -> pd.DataFrame:
    import yfinance as yf

    symbols = C.TICKERS + [C.BENCHMARK]

    # Start early enough that the earliest as-of date has a full 252-trading-day
    # lookback behind it; end today so the latest as-of has its 3M label.
    earliest = datetime.strptime(min(C.AS_OF_DATES), "%Y-%m-%d")
    start = (earliest - timedelta(days=int(C.LOOKBACK_TRADING_DAYS * 1.6))).strftime("%Y-%m-%d")
    end = datetime.now().strftime("%Y-%m-%d")

    print(f"Downloading {len(symbols)} symbols, {start} -> {end} ...")
    raw = yf.download(
        symbols,
        start=start,
        end=end,
        auto_adjust=False,   # keep raw OHLCV so scoring matches production
        progress=False,
        group_by="column",
        threads=True,
    )
    if raw is None or raw.empty:
        raise SystemExit("yfinance returned no data. Check connectivity and retry.")

    # Flatten (field, ticker) MultiIndex columns to "FIELD|TICKER".
    if isinstance(raw.columns, pd.MultiIndex):
        raw.columns = [f"{a}|{b}" for a, b in raw.columns]
    raw.index.name = "Date"
    return raw


def _load_or_download() -> pd.DataFrame:
    if os.path.exists(C.PRICES_PATH):
        print(f"Reusing cached price panel: {C.PRICES_PATH}")
        return pd.read_csv(C.PRICES_PATH, index_col=0, parse_dates=True)
    os.makedirs(C.FIXTURE_DIR, exist_ok=True)
    panel = _download_panel()
    panel.to_csv(C.PRICES_PATH, compression="gzip")
    print(f"Wrote {C.PRICES_PATH}  ({len(panel)} rows, {len(panel.columns)} cols)")
    return panel


def _series(panel: pd.DataFrame, field: str, ticker: str) -> pd.Series | None:
    col = f"{field}|{ticker}"
    if col not in panel.columns:
        return None
    return panel[col].dropna()


def _forward_return(adj: pd.Series, as_of_idx: int, horizon_td: int) -> float | None:
    """Total return from the as-of close to the close `horizon_td` sessions later."""
    end_idx = as_of_idx + horizon_td
    if end_idx >= len(adj):
        return None
    p0, p1 = float(adj.iloc[as_of_idx]), float(adj.iloc[end_idx])
    if not np.isfinite(p0) or not np.isfinite(p1) or p0 <= 0:
        return None
    return p1 / p0 - 1.0


def build() -> dict:
    panel = _load_or_download()

    bench_adj = _series(panel, "Adj Close", C.BENCHMARK)
    if bench_adj is None or bench_adj.empty:
        raise SystemExit(f"No benchmark data for {C.BENCHMARK}.")

    pairs: list[dict] = []
    dropped: list[dict] = []

    for as_of in C.AS_OF_DATES:
        as_of_ts = pd.Timestamp(as_of)

        # Last trading session at or before the as-of date. Everything the
        # pipeline sees is truncated here; nothing after it may be read.
        bench_pos = bench_adj.index.searchsorted(as_of_ts, side="right") - 1
        if bench_pos < 0:
            raise SystemExit(f"No benchmark session on or before {as_of}.")
        session = bench_adj.index[bench_pos]

        bench_fwd = {
            name: _forward_return(bench_adj, bench_pos, td)
            for name, td in C.HORIZONS.items()
        }

        for ticker in C.TICKERS:
            adj = _series(panel, "Adj Close", ticker)
            close = _series(panel, "Close", ticker)
            if adj is None or close is None or adj.empty:
                dropped.append({"ticker": ticker, "as_of": as_of, "reason": "no price data"})
                continue

            pos = adj.index.searchsorted(as_of_ts, side="right") - 1
            if pos < 0:
                dropped.append({"ticker": ticker, "as_of": as_of, "reason": "no session before as_of"})
                continue
            if pos + 1 < C.LOOKBACK_TRADING_DAYS:
                dropped.append({"ticker": ticker, "as_of": as_of, "reason": "insufficient lookback"})
                continue

            labels: dict = {}
            incomplete = False
            for name in C.HORIZONS:
                r = _forward_return(adj, pos, C.HORIZONS[name])
                b = bench_fwd[name]
                if r is None or b is None:
                    incomplete = True
                    break
                labels[f"fwd_ret_{name}"] = round(r, 6)
                labels[f"fwd_excess_{name}"] = round(r - b, 6)

            if incomplete:
                dropped.append({"ticker": ticker, "as_of": as_of, "reason": "forward window not yet realised"})
                continue

            pairs.append({
                "ticker": ticker,
                "sector": C.SECTOR_OF[ticker],
                "as_of_date": as_of,
                "as_of_session": str(session.date()),
                "price_at_as_of": round(float(close.iloc[pos]), 4),
                **labels,
            })

    fixture = {
        "schema_version": 1,
        "generated_at": datetime.utcnow().isoformat() + "Z",
        "benchmark": C.BENCHMARK,
        "horizons_trading_days": C.HORIZONS,
        "as_of_dates": C.AS_OF_DATES,
        "n_tickers": len(C.TICKERS),
        "n_pairs": len(pairs),
        "benchmark_forward_returns": {
            as_of: {
                name: (lambda p: None if p is None else round(p, 6))(
                    _forward_return(
                        bench_adj,
                        bench_adj.index.searchsorted(pd.Timestamp(as_of), side="right") - 1,
                        td,
                    )
                )
                for name, td in C.HORIZONS.items()
            }
            for as_of in C.AS_OF_DATES
        },
        "dropped": dropped,
        "pairs": pairs,
    }

    os.makedirs(C.FIXTURE_DIR, exist_ok=True)
    with open(C.EVAL_SET_PATH, "w") as f:
        json.dump(fixture, f, indent=2)

    print(f"\nWrote {C.EVAL_SET_PATH}")
    print(f"  pairs:   {len(pairs)}")
    print(f"  dropped: {len(dropped)}")
    for as_of in C.AS_OF_DATES:
        n = sum(1 for p in pairs if p["as_of_date"] == as_of)
        bm = fixture["benchmark_forward_returns"][as_of]
        bm_s = ", ".join(f"{k} {v:+.2%}" for k, v in bm.items() if v is not None)
        print(f"  {as_of}: {n:>3} pairs   SPY {bm_s}")
    return fixture


if __name__ == "__main__":
    sys.exit(0 if build() else 1)
