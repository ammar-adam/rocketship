"""
One-time sector fetch for the wide universe, cached to fixtures/.

Sector labels are needed to demean factor z-scores within sector. Without that
the model can score highly by simply loading on whichever sector rallied, which
is a sector bet wearing a stock-picker's clothes.

    python -m evals.fetch_sectors
"""
from __future__ import annotations

import concurrent.futures as cf
import json
import os
from collections import Counter

from evals import config as C

OUT = os.path.join(C.FIXTURE_DIR, "sectors_wide.json")
RAW = os.path.join(C.FIXTURE_DIR, "_universe_raw.json")


def one(t: str) -> tuple[str, str]:
    import yfinance as yf
    try:
        return t, (yf.Ticker(t).info or {}).get("sector") or "Unknown"
    except Exception:
        return t, "Unknown"


def main() -> int:
    with open(RAW, encoding="utf-8") as f:
        tickers = json.load(f)
    res: dict[str, str] = {}
    with cf.ThreadPoolExecutor(max_workers=16) as ex:
        for t, s in ex.map(one, tickers):
            res[t] = s
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(res, f, indent=2)
    unknown = sum(1 for v in res.values() if v == "Unknown")
    print(f"Wrote {OUT}: {len(res)} tickers, {unknown} Unknown")
    print(Counter(res.values()).most_common(8))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
