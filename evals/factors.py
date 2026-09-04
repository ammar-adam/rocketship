"""
Price-based cross-sectional factors, and a walk-forward fitted model.

Replaces the hand-set thresholds in src/rocket_score.py. Three differences, each
of which the evaluation showed matters:

1. STANDARDISED, NOT ABSOLUTE. Every factor becomes a z-score across the
   universe on that date. RocketScore compares a stock to fixed cutoffs
   ("+10 if 1-month return > 10%"), so when a whole sector rallies every score
   in it rises and the ranking picks up sector beta rather than stock selection.

2. SECTOR-NEUTRAL. Z-scores are demeaned within sector, so the model ranks
   stocks against their peers rather than betting on sectors. If the edge is
   really a sector call, that should be a deliberate decision, not a side effect.

3. FITTED, NOT GUESSED. Weights come from a walk-forward rank regression using
   only prior data, rather than the hardcoded 45/25/20/10 - which Stage A
   measured as effectively 75/20/0/5 in any case.

Only price and volume factors are here. Fundamental factors (gross
profitability, accruals, earnings yield) need point-in-time data the project
does not have, and backtesting them on restated current fundamentals would be
worse than omitting them.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

# Factor definitions. `sign` is the direction the literature expects, applied so
# every factor is oriented "higher = predicted better forward return".
FACTORS: dict[str, dict] = {
    "mom_12_1": {
        "sign": +1,
        "desc": "12-month return skipping the most recent month",
        "why": "the canonical momentum construction; the skip avoids contaminating "
               "it with short-term reversal",
    },
    "reversal_1m": {
        "sign": -1,
        "desc": "1-month return, sign flipped",
        "why": "short-horizon winners tend to give some back. Kept SEPARATE from "
               "momentum rather than folded in, which is what RocketScore does",
    },
    "vol_surge": {
        "sign": +1,
        "desc": "10d/60d average volume",
        "why": "the only signal that was nominally significant in the exploratory "
               "sweep. Pre-registered here so the follow-up is a real test",
    },
    "idio_vol": {
        "sign": -1,
        "desc": "60d return volatility, sign flipped",
        "why": "the low-volatility anomaly: high-vol names have historically "
               "underperformed on a risk-adjusted basis",
    },
    "trend": {
        "sign": +1,
        "desc": "annualised slope of log price over 60d",
        "why": "a smoother momentum proxy, less sensitive to endpoint noise",
    },
    "drawdown": {
        "sign": +1,
        "desc": "distance from the 52-week high (negative)",
        "why": "proximity to the 52-week high; distinct from raw momentum",
    },
    "liquidity": {
        "sign": -1,
        "desc": "log median dollar volume, sign flipped",
        "why": "the illiquidity premium. Within a liquidity-floored universe this "
               "is a size proxy",
    },
}


# ---------------------------------------------------------------------------
# factor computation
# ---------------------------------------------------------------------------

def compute_factors(adj: pd.DataFrame, close: pd.DataFrame, vol: pd.DataFrame,
                    pos: int, tickers: list[str]) -> pd.DataFrame:
    """Raw factor values for every ticker at one as-of index position."""
    out = {}
    lo = max(0, pos - 252)

    win_a = adj.iloc[lo : pos + 1]
    win_v = vol.iloc[lo : pos + 1]
    win_p = close.iloc[lo : pos + 1]

    rets = win_a.pct_change()

    px_now = win_a.iloc[-1]
    px_1m = win_a.iloc[-22] if len(win_a) > 22 else win_a.iloc[0]
    px_12m = win_a.iloc[0]

    out["mom_12_1"] = (px_1m / px_12m - 1.0)
    out["reversal_1m"] = (px_now / px_1m - 1.0)
    out["idio_vol"] = rets.tail(60).std()

    v10 = win_v.tail(10).mean()
    v60 = win_v.tail(60).mean()
    out["vol_surge"] = (v10 / v60.replace(0, np.nan))

    logp = np.log(win_a.tail(60).clip(lower=1e-6))
    x = np.arange(len(logp))
    xm = x.mean()
    denom = ((x - xm) ** 2).sum()
    slope = ((logp.sub(logp.mean(axis=0), axis=1)).mul(x - xm, axis=0)).sum(axis=0) / denom
    out["trend"] = slope * 252

    high52 = win_a.max()
    out["drawdown"] = (px_now / high52 - 1.0)

    dv = (win_p * win_v).tail(21).median()
    out["liquidity"] = np.log(dv.clip(lower=1.0))

    df = pd.DataFrame(out)
    return df.reindex(tickers)


# ---------------------------------------------------------------------------
# standardisation
# ---------------------------------------------------------------------------

def winsorised_z(s: pd.Series, limit: float = 3.0) -> pd.Series:
    """Z-score with tails clipped. One outlier can otherwise dominate a rank."""
    s = s.astype(float)
    mu, sd = s.mean(), s.std()
    if not np.isfinite(sd) or sd == 0:
        return pd.Series(0.0, index=s.index)
    z = (s - mu) / sd
    return z.clip(-limit, limit)


def standardise(raw: pd.DataFrame, sectors: pd.Series | None = None,
                sector_neutral: bool = True) -> pd.DataFrame:
    """Sign-align, z-score within date, then demean within sector."""
    out = {}
    for name, meta in FACTORS.items():
        if name not in raw.columns:
            continue
        col = raw[name] * meta["sign"]
        z = winsorised_z(col)
        if sector_neutral and sectors is not None:
            grp = sectors.reindex(z.index).fillna("Unknown")
            z = z - z.groupby(grp).transform("mean")
        out[name] = z.fillna(0.0)
    return pd.DataFrame(out)


# ---------------------------------------------------------------------------
# walk-forward fitting
# ---------------------------------------------------------------------------

def rank_ic(scores: pd.Series, labels: pd.Series) -> float | None:
    """
    Spearman between a score and a label, on the overlap.

    Drops pairs where EITHER side is missing. np.corrcoef propagates NaN, so a
    single missing value silently turns the whole period's IC into nan and the
    period then vanishes from the average - which looks like a smaller sample
    rather than like a bug.
    """
    idx = scores.index.intersection(labels.index)
    if len(idx) < 10:
        return None
    a = pd.to_numeric(scores.loc[idx], errors="coerce")
    b = pd.to_numeric(labels.loc[idx], errors="coerce")
    ok = a.notna() & b.notna()
    if ok.sum() < 10:
        return None
    a, b = a[ok].rank(), b[ok].rank()
    if a.std() == 0 or b.std() == 0:
        return None
    return float(np.corrcoef(a, b)[0, 1])


def fit_weights(train: pd.DataFrame, factor_cols: list[str], label_col: str,
                ridge: float = 10.0) -> np.ndarray:
    """
    Ridge on cross-sectionally ranked factors and labels.

    Ranking both sides makes this a rank regression: robust to the fat tails
    single-name returns always have, and it estimates the same thing the
    evaluation metric measures.
    """
    if train.empty:
        return np.zeros(len(factor_cols))

    parts = []
    for _d, g in train.groupby("as_of_date"):
        if len(g) < 20:
            continue
        X = g[factor_cols].rank(pct=True) - 0.5
        y = g[label_col].rank(pct=True) - 0.5
        parts.append((X.to_numpy(), y.to_numpy()))
    if not parts:
        return np.zeros(len(factor_cols))

    X = np.vstack([p[0] for p in parts])
    y = np.concatenate([p[1] for p in parts])
    XtX = X.T @ X + ridge * np.eye(X.shape[1])
    try:
        w = np.linalg.solve(XtX, X.T @ y)
    except np.linalg.LinAlgError:
        w = np.zeros(X.shape[1])
    return w


def purged_walk_forward(panel: pd.DataFrame, factor_cols: list[str],
                        label_col: str, horizon_days: int,
                        min_train_dates: int = 12) -> pd.DataFrame:
    """
    Expanding-window walk-forward with a purge gap.

    THE PURGE IS THE POINT. A 3-month forward label on a monthly date grid
    overlaps the next two dates' labels. Training on a date whose outcome window
    overlaps the test date leaks the answer, and a naive split reports an
    optimistic number for that reason alone. Dates within `horizon_days` of the
    test date are dropped from training.
    """
    dates = sorted(panel["as_of_date"].unique())
    gap_months = max(1, int(round(horizon_days / 21)))
    rows = []

    for i, test_date in enumerate(dates):
        if i < min_train_dates:
            continue
        train_dates = dates[: max(0, i - gap_months)]
        if len(train_dates) < min_train_dates:
            continue

        train = panel[panel["as_of_date"].isin(train_dates)]
        test = panel[panel["as_of_date"] == test_date]
        if test.empty:
            continue

        w = fit_weights(train, factor_cols, label_col)
        Xt = test[factor_cols].rank(pct=True) - 0.5
        score = pd.Series(Xt.to_numpy() @ w, index=test.index)

        rows.append(pd.DataFrame({
            "as_of_date": test_date,
            "ticker": test["ticker"].to_numpy(),
            "score": score.to_numpy(),
            "label": test[label_col].to_numpy(),
            "n_train_dates": len(train_dates),
            "purged_dates": gap_months,
        }))

    return pd.concat(rows, ignore_index=True) if rows else pd.DataFrame()
