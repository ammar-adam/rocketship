"""
RocketScore Algorithm - Capital Allocation System
================================================
WEIGHTING (LOCKED):
- Technical: 45% (momentum, trend, returns)
- Volume: 25% (flow signals)
- Quality: 20% (fundamentals if available)
- Macro: 10% (sector alignment)

Tags are DESCRIPTIVE ONLY and add MAX +2 points total.
"""
import json
import numpy as np
import pandas as pd
from typing import Dict, Any, List, Optional


# Load macro trends data
try:
    with open("data/macro_trends.json") as f:
        MACRO_TRENDS = json.load(f)
except FileNotFoundError:
    MACRO_TRENDS = {}


def compute_technical_score(signals: dict, df: pd.DataFrame) -> tuple[float, dict]:
    """
    Technical score (0-100) based on price momentum and trend.
    Components:
    - 1M/3M/6M returns (scaled)
    - Trend slope proxy
    - Drawdown penalty
    """
    rationale = []
    raw_metrics = {}
    score = 50  # Neutral baseline
    
    # 1-Month return (20 trading days)
    mom_1m = signals.get("mom_20d", 0) * 100
    raw_metrics["return_1m_pct"] = round(mom_1m, 2)
    
    # 3-Month return (60 trading days)
    mom_3m = signals.get("mom_60d", 0) * 100
    raw_metrics["return_3m_pct"] = round(mom_3m, 2)
    
    # 6-Month return (if available)
    if len(df) >= 126:
        mom_6m = (df['Close'].iloc[-1] / df['Close'].iloc[-126] - 1) * 100
    else:
        mom_6m = mom_3m
    raw_metrics["return_6m_pct"] = round(mom_6m, 2)
    
    # 1-Year return (if available)
    if len(df) >= 252:
        mom_1y = (df['Close'].iloc[-1] / df['Close'].iloc[-252] - 1) * 100
    else:
        mom_1y = mom_6m
    raw_metrics["return_1y_pct"] = round(mom_1y, 2)
    
    # Trend slope proxy (regression on log prices, last 60 days)
    try:
        recent_prices = df['Close'].tail(60)
        log_prices = np.log(recent_prices.values)
        x = np.arange(len(log_prices))
        slope, _ = np.polyfit(x, log_prices, 1)
        trend_slope = slope * 252 * 100  # Annualized %
        raw_metrics["trend_slope_annualized"] = round(trend_slope, 2)
    except:
        trend_slope = 0
        raw_metrics["trend_slope_annualized"] = 0
    
    # Drawdown from 52-week high
    high_52w = df['Close'].rolling(252, min_periods=1).max().iloc[-1]
    current = df['Close'].iloc[-1]
    drawdown = (current / high_52w - 1) * 100
    raw_metrics["drawdown_from_52w_high_pct"] = round(drawdown, 2)
    
    # SMA relationships
    sma50 = df['Close'].rolling(50).mean().iloc[-1] if len(df) >= 50 else current
    sma200 = df['Close'].rolling(200).mean().iloc[-1] if len(df) >= 200 else current
    raw_metrics["above_sma50"] = bool(current > sma50)
    raw_metrics["above_sma200"] = bool(current > sma200)
    raw_metrics["golden_cross"] = bool(sma50 > sma200)
    
    # SCORING
    # Returns contribution (40% of technical)
    returns_score = 0
    if mom_1m > 10: returns_score += 10
    elif mom_1m > 5: returns_score += 7
    elif mom_1m > 0: returns_score += 4
    elif mom_1m > -5: returns_score += 2
    
    if mom_3m > 20: returns_score += 15
    elif mom_3m > 10: returns_score += 10
    elif mom_3m > 0: returns_score += 5
    
    if mom_6m > 30: returns_score += 15
    elif mom_6m > 15: returns_score += 10
    elif mom_6m > 0: returns_score += 5
    
    # Trend contribution (35% of technical)
    trend_score = 0
    if trend_slope > 50: trend_score += 20
    elif trend_slope > 25: trend_score += 15
    elif trend_slope > 10: trend_score += 10
    elif trend_slope > 0: trend_score += 5
    
    if raw_metrics["golden_cross"]: trend_score += 10
    if raw_metrics["above_sma50"]: trend_score += 5
    
    # Drawdown penalty (25% of technical)
    drawdown_score = 25  # Start at max
    if drawdown < -30: drawdown_score = 0
    elif drawdown < -20: drawdown_score = 5
    elif drawdown < -15: drawdown_score = 10
    elif drawdown < -10: drawdown_score = 15
    elif drawdown < -5: drawdown_score = 20
    
    score = returns_score + trend_score + drawdown_score
    score = min(100, max(0, score))
    
    # Build rationale
    rationale.append(f"1M: {mom_1m:+.1f}%, 3M: {mom_3m:+.1f}%, 6M: {mom_6m:+.1f}%")
    rationale.append(f"Trend slope: {trend_slope:.1f}% annualized")
    rationale.append(f"Drawdown: {drawdown:.1f}% from 52w high")
    if raw_metrics["golden_cross"]:
        rationale.append("Golden cross active (SMA50 > SMA200)")
    
    return score, {"raw_metrics": raw_metrics, "rationale": rationale, "sub_scores": {
        "returns": returns_score, "trend": trend_score, "drawdown": drawdown_score
    }}


def compute_volume_score(signals: dict, df: pd.DataFrame) -> tuple[float, dict]:
    """
    Volume score (0-100) based on flow signals.
    Components:
    - Volume z-score vs 60d average
    - Up-volume vs down-volume ratio proxy
    """
    rationale = []
    raw_metrics = {}
    score = 50  # Neutral baseline
    
    # Volume surge (short vs long avg)
    vol_surge = signals.get("vol_surge", 1.0)
    raw_metrics["volume_surge_ratio"] = round(vol_surge, 2)
    
    # Volume z-score
    if len(df) >= 60:
        vol_60d = df['Volume'].tail(60)
        vol_mean = vol_60d.mean()
        vol_std = vol_60d.std()
        if vol_std > 0:
            recent_vol = df['Volume'].tail(10).mean()
            vol_zscore = (recent_vol - vol_mean) / vol_std
        else:
            vol_zscore = 0
    else:
        vol_zscore = 0
    raw_metrics["volume_zscore_10d"] = round(vol_zscore, 2)
    
    # Up-volume vs Down-volume proxy (last 20 days)
    try:
        recent = df.tail(20).copy()
        recent['pct_change'] = recent['Close'].pct_change()
        up_vol = recent[recent['pct_change'] > 0]['Volume'].sum()
        down_vol = recent[recent['pct_change'] < 0]['Volume'].sum()
        if down_vol > 0:
            up_down_ratio = up_vol / down_vol
        else:
            up_down_ratio = 2.0 if up_vol > 0 else 1.0
    except:
        up_down_ratio = 1.0
    raw_metrics["up_down_volume_ratio_20d"] = round(up_down_ratio, 2)
    
    # Average daily volume
    avg_volume = df['Volume'].tail(20).mean() if len(df) >= 20 else df['Volume'].mean()
    raw_metrics["avg_daily_volume_20d"] = int(avg_volume)
    
    # SCORING
    # Volume surge (40% of volume)
    surge_score = 0
    if vol_surge > 2.5: surge_score = 40
    elif vol_surge > 2.0: surge_score = 30
    elif vol_surge > 1.5: surge_score = 20
    elif vol_surge > 1.2: surge_score = 10
    
    # Z-score (30% of volume)
    zscore_score = 0
    if vol_zscore > 2.0: zscore_score = 30
    elif vol_zscore > 1.0: zscore_score = 20
    elif vol_zscore > 0.5: zscore_score = 15
    elif vol_zscore > 0: zscore_score = 10
    
    # Up/down ratio (30% of volume)
    ratio_score = 0
    if up_down_ratio > 2.0: ratio_score = 30
    elif up_down_ratio > 1.5: ratio_score = 20
    elif up_down_ratio > 1.2: ratio_score = 15
    elif up_down_ratio > 1.0: ratio_score = 10
    
    score = surge_score + zscore_score + ratio_score
    score = min(100, max(0, score))
    
    # Build rationale
    rationale.append(f"Volume surge: {vol_surge:.2f}x vs 60d avg")
    rationale.append(f"Volume z-score: {vol_zscore:.2f}")
    rationale.append(f"Up/Down volume ratio: {up_down_ratio:.2f}")
    
    return score, {"raw_metrics": raw_metrics, "rationale": rationale, "sub_scores": {
        "surge": surge_score, "zscore": zscore_score, "up_down_ratio": ratio_score
    }}


def compute_quality_score(ticker: str, signals: dict) -> tuple[float, dict]:
    """
    Quality/Fundamentals score (0-100).
    If fundamentals not available, returns neutral 50 with warning.
    Components (if available):
    - Operating margin
    - Revenue growth
    - FCF margin
    """
    rationale = []
    raw_metrics = {}
    warnings = []
    
    # Try to fetch fundamentals from yfinance
    fundamentals_available = False
    try:
        import yfinance as yf
        stock = yf.Ticker(ticker)
        info = stock.info
        
        # Operating margin
        op_margin = info.get('operatingMargins')
        if op_margin is not None:
            raw_metrics["operating_margin"] = round(op_margin * 100, 2)
            fundamentals_available = True
        
        # Gross margin
        gross_margin = info.get('grossMargins')
        if gross_margin is not None:
            raw_metrics["gross_margin"] = round(gross_margin * 100, 2)
            fundamentals_available = True
        
        # Revenue growth
        rev_growth = info.get('revenueGrowth')
        if rev_growth is not None:
            raw_metrics["revenue_growth"] = round(rev_growth * 100, 2)
            fundamentals_available = True
        
        # Profit margins
        profit_margin = info.get('profitMargins')
        if profit_margin is not None:
            raw_metrics["profit_margin"] = round(profit_margin * 100, 2)
            fundamentals_available = True
        
        # Free cash flow (estimate from financials)
        fcf_yield = info.get('freeCashflow')
        market_cap = info.get('marketCap')
        if fcf_yield and market_cap and market_cap > 0:
            raw_metrics["fcf_yield"] = round((fcf_yield / market_cap) * 100, 2)
            fundamentals_available = True
        
    except Exception as e:
        warnings.append(f"Could not fetch fundamentals: {str(e)}")
    
    if not fundamentals_available:
        warnings.append("No fundamental data available - using neutral score")
        rationale.append("Quality score neutral (50) - fundamentals not available")
        return 50, {"raw_metrics": raw_metrics, "rationale": rationale, "warnings": warnings}
    
    # SCORING
    score = 50  # Start neutral
    
    # Operating margin contribution
    op_margin = raw_metrics.get("operating_margin", 0)
    if op_margin > 30: score += 15
    elif op_margin > 20: score += 10
    elif op_margin > 10: score += 5
    elif op_margin < 0: score -= 10
    
    # Revenue growth contribution
    rev_growth = raw_metrics.get("revenue_growth", 0)
    if rev_growth > 30: score += 15
    elif rev_growth > 15: score += 10
    elif rev_growth > 5: score += 5
    elif rev_growth < -10: score -= 10
    
    # Profit margin contribution
    profit_margin = raw_metrics.get("profit_margin", 0)
    if profit_margin > 20: score += 10
    elif profit_margin > 10: score += 5
    elif profit_margin < 0: score -= 5
    
    # FCF yield contribution
    fcf_yield = raw_metrics.get("fcf_yield", 0)
    if fcf_yield > 5: score += 10
    elif fcf_yield > 2: score += 5
    elif fcf_yield < 0: score -= 5
    
    score = min(100, max(0, score))
    
    # Build rationale
    if "operating_margin" in raw_metrics:
        rationale.append(f"Operating margin: {raw_metrics['operating_margin']:.1f}%")
    if "revenue_growth" in raw_metrics:
        rationale.append(f"Revenue growth: {raw_metrics['revenue_growth']:.1f}%")
    if "profit_margin" in raw_metrics:
        rationale.append(f"Profit margin: {raw_metrics['profit_margin']:.1f}%")
    if "fcf_yield" in raw_metrics:
        rationale.append(f"FCF yield: {raw_metrics['fcf_yield']:.1f}%")
    
    return score, {"raw_metrics": raw_metrics, "rationale": rationale, "warnings": warnings}


def compute_macro_score(sector: str) -> tuple[float, dict]:
    """
    Macro/Sector alignment score (0-100).
    Based on sector trends and relative strength.
    """
    rationale = []
    raw_metrics = {"sector": sector}
    matched_trends = []
    
    # Match sector to trends
    trend_bonus = 0
    for trend_id, trend_data in MACRO_TRENDS.items():
        if sector in trend_data.get("sectors", []):
            matched_trends.append({
                "name": trend_data["name"],
                "confidence": trend_data["confidence"],
                "thesis": trend_data["thesis"]
            })
            # Trend contribution is SMALL (max 10 points total from all trends)
            trend_bonus += min(trend_data["confidence"] / 20, 3)  # Max 3 per trend
    
    trend_bonus = min(trend_bonus, 10)  # Cap at 10
    
    # Base sector score (neutral without sector proxy)
    base_score = 50
    
    # Known favorable sectors get small boost
    favorable_sectors = ["Technology", "Healthcare", "Communication Services"]
    neutral_sectors = ["Consumer Discretionary", "Industrials", "Financial Services"]
    unfavorable_sectors = ["Utilities", "Real Estate"]
    
    if sector in favorable_sectors:
        base_score = 60
        rationale.append(f"Sector '{sector}' has favorable macro backdrop")
    elif sector in unfavorable_sectors:
        base_score = 40
        rationale.append(f"Sector '{sector}' faces macro headwinds")
    else:
        rationale.append(f"Sector '{sector}' has neutral positioning")
    
    score = base_score + trend_bonus
    score = min(100, max(0, score))
    
    raw_metrics["trend_bonus"] = round(trend_bonus, 2)
    raw_metrics["matched_trends_count"] = len(matched_trends)
    
    if matched_trends:
        rationale.append(f"Aligned with {len(matched_trends)} macro theme(s)")
        for t in matched_trends[:2]:  # Show max 2
            rationale.append(f"  - {t['name']}")
    else:
        rationale.append("No specific macro theme alignment")
    
    return score, {
        "raw_metrics": raw_metrics,
        "rationale": rationale,
        "matched_trends": matched_trends
    }


def compute_rocket_score(ticker: str, df: pd.DataFrame, signals: dict, sector: str) -> dict:
    """
    Compute RocketScore with transparent methodology.
    
    WEIGHTS (LOCKED):
    - Technical: 45%
    - Volume: 25%
    - Quality: 20%
    - Macro: 10%
    
    Tags add MAX +2 points.
    
    Returns dict with full breakdown and raw metrics.
    """
    # Compute component scores
    technical_score, technical_details = compute_technical_score(signals, df)
    volume_score, volume_details = compute_volume_score(signals, df)
    quality_score, quality_details = compute_quality_score(ticker, signals)
    macro_score, macro_details = compute_macro_score(sector)
    
    # Weighted combination
    weighted_score = (
        technical_score * 0.45 +
        volume_score * 0.25 +
        quality_score * 0.20 +
        macro_score * 0.10
    )
    
    # Tags bonus (MAX +2)
    tags = []
    tag_bonus = 0
    for trend in macro_details.get("matched_trends", []):
        tag_name = trend["name"].split()[0]  # First word as tag
        if tag_name not in tags:
            tags.append(tag_name)
    
    if len(tags) > 0:
        tag_bonus = min(len(tags), 2)  # Max +2
    
    final_score = min(100, weighted_score + tag_bonus)
    
    # Build comprehensive output
    return {
        "rocket_score": round(final_score, 2),
        "weighted_score_before_tags": round(weighted_score, 2),
        "tag_bonus": tag_bonus,
        
        # Component scores
        "technical_score": round(technical_score, 2),
        "volume_score": round(volume_score, 2),
        "quality_score": round(quality_score, 2),
        "macro_score": round(macro_score, 2),
        
        # Weights used
        "weights": {
            "technical": 0.45,
            "volume": 0.25,
            "quality": 0.20,
            "macro": 0.10
        },
        
        # Legacy breakdown (for compatibility)
        "breakdown": {
            "momentum": round(technical_details.get("sub_scores", {}).get("returns", 0) + 
                            technical_details.get("sub_scores", {}).get("trend", 0), 2),
            "volume": round(volume_score, 2),
            "trend": round(technical_details.get("sub_scores", {}).get("trend", 0), 2),
            "quality": round(quality_score, 2)
        },
        
        # Detailed breakdown with raw metrics
        "technical_details": technical_details,
        "volume_details": volume_details,
        "quality_details": quality_details,
        "macro_details": macro_details,
        
        # Tags and trends
        "tags": tags,
        "macro_trends_matched": macro_details.get("matched_trends", []),
        
        # Methodology explanation
        "methodology": {
            "description": "RocketScore combines technical momentum, volume flow, quality fundamentals, and macro alignment",
            "weights_explanation": "Technical 45%, Volume 25%, Quality 20%, Macro 10%",
            "tag_policy": "Tags are descriptive only and add MAX +2 points total",
            "data_sources": ["yfinance price/volume", "yfinance fundamentals (when available)", "internal computations"]
        }
    }


if __name__ == "__main__":
    """Test the rocket score module."""
    import sys
    sys.path.append('.')
    from src.data_fetcher import fetch_ohlcv
    from src.signals import compute_signals
    from src.universe import get_sector
    
    print("Testing RocketScore Module (New Methodology)")
    print("=" * 70)
    
    test_ticker = "NVDA"
    print(f"\n1. Fetching data for {test_ticker}...")
    df = fetch_ohlcv(test_ticker, lookback_days=252)
    
    if df is None:
        print("[ERROR] Could not fetch data")
        sys.exit(1)
    
    print(f"   [OK] Fetched {len(df)} rows")
    
    print("\n2. Computing signals...")
    signals = compute_signals(df)
    
    print("\n3. Getting sector...")
    sector = get_sector(test_ticker)
    print(f"   [OK] Sector: {sector}")
    
    print("\n4. Computing RocketScore...")
    score_data = compute_rocket_score(test_ticker, df, signals, sector)
    
    print(f"\n{'='*70}")
    print(f"ROCKETSCORE REPORT: {test_ticker}")
    print(f"{'='*70}")
    print(f"\n[FINAL SCORE]: {score_data['rocket_score']:.2f}/100")
    print(f"  (Weighted: {score_data['weighted_score_before_tags']:.2f} + Tag bonus: {score_data['tag_bonus']})")
    
    print(f"\nComponent Scores:")
    print(f"  Technical: {score_data['technical_score']:.1f}/100 (45% weight)")
    print(f"  Volume:    {score_data['volume_score']:.1f}/100 (25% weight)")
    print(f"  Quality:   {score_data['quality_score']:.1f}/100 (20% weight)")
    print(f"  Macro:     {score_data['macro_score']:.1f}/100 (10% weight)")
    
    print(f"\nTechnical Details:")
    for r in score_data['technical_details']['rationale']:
        print(f"  • {r}")
    
    print(f"\nVolume Details:")
    for r in score_data['volume_details']['rationale']:
        print(f"  • {r}")
    
    print(f"\nQuality Details:")
    for r in score_data['quality_details']['rationale']:
        print(f"  • {r}")
    if score_data['quality_details'].get('warnings'):
        for w in score_data['quality_details']['warnings']:
            print(f"  [WARNING] {w}")
    
    print(f"\nMacro Details:")
    for r in score_data['macro_details']['rationale']:
        print(f"  • {r}")
    
    print(f"\nTags: {score_data['tags']}")
    print(f"\n{'='*70}")
