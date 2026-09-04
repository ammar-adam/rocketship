"""
Build the wide research panel: many names, many dates.

The evaluation's binding constraint was never the debate - it was sample size.
600 (ticker, date) pairs gave a standard error of ~0.062 on a cross-sectional
rank correlation, while a genuinely good stock-ranking signal has an information
coefficient of 0.02-0.05. The error bars were wider than the effect.

This builds the panel that fixes that:

    python -m evals.build_wide           # download + label
    python -m evals.build_wide --dates 36

KNOWN LIMITATION, stated up front: the universe is CURRENT index membership, so
it carries survivorship bias. Companies that were delisted or acquired over the
window are absent, and their absence flatters every result. That biases returns
optimistically and cannot be fixed without a point-in-time membership source.
Every number derived from this panel inherits it.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

from evals import config as C

PANEL_PATH = os.path.join(C.FIXTURE_DIR, "panel_wide.parquet")
UNIVERSE_PATH = os.path.join(C.FIXTURE_DIR, "universe_wide.json")
RAW_UNIVERSE = os.path.join(C.FIXTURE_DIR, "_universe_raw.json")
LABELS_PATH = os.path.join(C.FIXTURE_DIR, "labels_wide.parquet")

# Liquidity floor. Below this a "return" is a quote nobody could actually hit,
# and including such names inflates every backtest.
MIN_DOLLAR_VOLUME = 2_000_000
MIN_PRICE = 3.0


def month_ends(n: int, last: str) -> list[str]:
    """n monthly as-of dates, the most recent being `last`."""
    end = datetime.strptime(last, "%Y-%m-%d")
    out = []
    y, m = end.year, end.month
    for _ in range(n):
        out.append(f"{y:04d}-{m:02d}-15")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return sorted(out)


def download(tickers: list[str], start: str, end: str) -> pd.DataFrame:
    import yfinance as yf

    print(f"Downloading {len(tickers)} tickers, {start} -> {end} ...")
    frames = []
    B = 120
    for i in range(0, len(tickers), B):
        chunk = tickers[i : i + B]
        raw = yf.download(chunk, start=start, end=end, auto_adjust=False,
                          progress=False, group_by="column", threads=True)
        if raw is None or raw.empty:
            print(f"  batch {i // B + 1}: empty")
            continue
        if isinstance(raw.columns, pd.MultiIndex):
            raw.columns = [f"{a}|{b}" for a, b in raw.columns]
        frames.append(raw)
        print(f"  batch {i // B + 1}/{(len(tickers) - 1) // B + 1}: {raw.shape[1]} cols")
    panel = pd.concat(frames, axis=1)
    panel = panel.loc[:, ~panel.columns.duplicated()]
    panel.index.name = "Date"
    return panel


def build(n_dates: int, last_date: str) -> dict:
    with open(RAW_UNIVERSE, encoding="utf-8") as f:
        tickers = json.load(f)

    dates = month_ends(n_dates, last_date)
    # 252 trading days of lookback before the earliest as-of date.
    start = (datetime.strptime(dates[0], "%Y-%m-%d") - timedelta(days=430)).strftime("%Y-%m-%d")
    end = datetime.now().strftime("%Y-%m-%d")

    if os.path.exists(PANEL_PATH):
        print(f"Reusing {PANEL_PATH}")
        panel = pd.read_parquet(PANEL_PATH)
    else:
        panel = download(tickers, start, end)
        os.makedirs(C.FIXTURE_DIR, exist_ok=True)
        panel.to_parquet(PANEL_PATH, compression="zstd")
        print(f"Wrote {PANEL_PATH}  {panel.shape}")

    adj = {c.split("|", 1)[1]: panel[c] for c in panel.columns if c.startswith("Adj Close|")}
    close = {c.split("|", 1)[1]: panel[c] for c in panel.columns if c.startswith("Close|")}
    vol = {c.split("|", 1)[1]: panel[c] for c in panel.columns if c.startswith("Volume|")}
    have = sorted(set(adj) & set(close) & set(vol))
    print(f"{len(have)} tickers have complete OHLCV")

    A = pd.DataFrame({t: adj[t] for t in have}).sort_index()
    P = pd.DataFrame({t: close[t] for t in have}).sort_index()
    V = pd.DataFrame({t: vol[t] for t in have}).sort_index()
    dollar = (P * V).rolling(21, min_periods=10).median()

    # Force a 1-D Series. A duplicated column label makes A[BENCHMARK] a
    # DataFrame, and .iloc then yields a Series rather than a float.
    def _as_series(x):
        if isinstance(x, pd.DataFrame):
            x = x.iloc[:, 0]
        return pd.Series(x).astype(float)

    bench = None
    if C.BENCHMARK in A.columns:
        bench = _as_series(A[C.BENCHMARK])
    if bench is None or bench.dropna().empty:
        import yfinance as yf
        b = yf.download(C.BENCHMARK, start=start, end=end, auto_adjust=False, progress=False)
        col = "Adj Close" if "Adj Close" in b.columns else "Close"
        bench = _as_series(b[col]).reindex(A.index).ffill()
    bench = bench.reindex(A.index).ffill()

    rows = []
    for as_of in dates:
        ts = pd.Timestamp(as_of)
        pos = A.index.searchsorted(ts, side="right") - 1
        if pos < 252:
            continue
        bpos = pos
        for t in have:
            if t == C.BENCHMARK:
                continue
            a = A[t]
            if not np.isfinite(a.iloc[pos]) or a.iloc[pos] < MIN_PRICE:
                continue
            dv = dollar[t].iloc[pos]
            if not np.isfinite(dv) or dv < MIN_DOLLAR_VOLUME:
                continue
            if a.iloc[max(0, pos - 251) : pos + 1].isna().sum() > 25:
                continue

            rec = {"ticker": t, "as_of_date": as_of,
                   "price": float(P[t].iloc[pos]), "dollar_vol": float(dv)}
            ok = True
            for hname, td in C.HORIZONS.items():
                e = pos + td
                if e >= len(a) or not np.isfinite(a.iloc[e]) or not np.isfinite(a.iloc[pos]):
                    ok = False
                    break
                r = float(a.iloc[e] / a.iloc[pos] - 1.0)
                br = float(bench.iloc[min(bpos + td, len(bench) - 1)] / bench.iloc[bpos] - 1.0)
                rec[f"fwd_ret_{hname}"] = r
                rec[f"fwd_excess_{hname}"] = r - br
            if ok:
                rows.append(rec)

    labels = pd.DataFrame(rows)
    labels.to_parquet(LABELS_PATH, compression="zstd")
    with open(UNIVERSE_PATH, "w", encoding="utf-8") as f:
        json.dump({"tickers": have, "as_of_dates": dates,
                   "min_dollar_volume": MIN_DOLLAR_VOLUME, "min_price": MIN_PRICE,
                   "survivorship_bias": "CURRENT index membership; delisted names absent"},
                  f, indent=2)

    print(f"\nWrote {LABELS_PATH}")
    print(f"  pairs:   {len(labels):,}")
    print(f"  dates:   {labels['as_of_date'].nunique()}")
    print(f"  tickers: {labels['ticker'].nunique()}")
    per = labels.groupby("as_of_date").size()
    print(f"  per date: min {per.min()}, median {int(per.median())}, max {per.max()}")
    return {"labels": labels}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dates", type=int, default=36)
    ap.add_argument("--last", type=str, default="2026-05-15")
    a = ap.parse_args()
    build(a.dates, a.last)
    return 0


if __name__ == "__main__":
    sys.exit(main())
