"""
Export the factor panel in a form the browser can recompute against.

The evaluation was a static verdict: numbers on a page, and nothing a reader
could do with them. This ships the underlying data instead, so the page can
re-rank 19,000 stock-dates live while someone drags a weight around. That turns
"here is my information coefficient" into "here is the machine, break it".

Everything is quantised into typed arrays and base64'd. The whole panel is a few
hundred KB, which is smaller than one of the fonts.

    python -m evals.export_lab      # -> frontend/src/fixtures/evals/lab.json
"""
from __future__ import annotations

import base64
import json
import os

import numpy as np

from evals import config as C
from evals import factors as F

# int8 at 1/32 covers +/-3.97, which contains the winsorised z range with room
# to spare. Max quantisation error is 1/64 ~ 0.016 z, far below anything that
# could change a ranking.
Z_SCALE = 32
# int16 at 1/5000 covers +/-6.5, i.e. +/-650% excess return. Error 1e-4.
R_SCALE = 5000

OUT = os.path.join(C.REPO_ROOT, "frontend", "src", "fixtures", "evals", "lab.json")


def b64(arr: np.ndarray) -> str:
    return base64.b64encode(arr.tobytes()).decode("ascii")


def main() -> int:
    from evals.stages.model import build_factor_panel

    panel = build_factor_panel(sector_neutral=True)
    factor_cols = [c for c in F.FACTORS if c in panel.columns]

    # Sort by date so the client can slice each cross-section by offset rather
    # than carrying a per-row date index.
    panel = panel.sort_values(["as_of_date", "ticker"]).reset_index(drop=True)

    dates = sorted(panel["as_of_date"].unique().tolist())
    date_of_row = panel["as_of_date"].to_numpy()
    offsets = [0]
    for d in dates:
        offsets.append(int((date_of_row <= d).sum()))

    tickers = sorted(panel["ticker"].unique().tolist())
    tix = {t: i for i, t in enumerate(tickers)}

    z = panel[factor_cols].to_numpy(dtype=np.float32)
    z = np.nan_to_num(z, nan=0.0)
    zq = np.clip(np.round(z * Z_SCALE), -127, 127).astype(np.int8)

    def lab(col: str) -> np.ndarray:
        v = np.nan_to_num(panel[col].to_numpy(dtype=np.float32), nan=0.0)
        return np.clip(np.round(v * R_SCALE), -32767, 32767).astype(np.int16)

    payload = {
        "note": (
            "Factor z-scores and realised forward excess returns for every "
            "(ticker, as-of date) pair. Sector-neutral, winsorised. Quantised: "
            "factors int8 at 1/32, returns int16 at 1/5000. Row order is sorted "
            "by date, so dateOffsets[i]..dateOffsets[i+1] is one cross-section."
        ),
        "nRows": int(len(panel)),
        "factors": factor_cols,
        "factorMeta": {k: F.FACTORS[k] for k in factor_cols},
        "dates": dates,
        "dateOffsets": offsets,
        "tickers": tickers,
        "zScale": Z_SCALE,
        "rScale": R_SCALE,
        "tickerIdx": b64(panel["ticker"].map(tix).to_numpy(dtype=np.int16)),
        "z": b64(zq),
        "fwd1M": b64(lab("fwd_excess_1M")),
        "fwd3M": b64(lab("fwd_excess_3M")),
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, separators=(",", ":"))

    kb = os.path.getsize(OUT) / 1024
    print(f"Wrote {OUT}")
    print(f"  {len(panel):,} rows x {len(factor_cols)} factors over {len(dates)} dates")
    print(f"  {kb:.0f} KB on disk (gzips to roughly a third over the wire)")

    # Prove the quantisation is lossless enough to preserve a ranking.
    back = zq.astype(np.float32) / Z_SCALE
    print(f"  max factor error: {float(np.abs(back - z).max()):.4f} z")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
