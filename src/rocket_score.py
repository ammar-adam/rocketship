"""RocketScore algorithm combining technical and macro analysis."""
import json
import pandas as pd


# Load historical patterns and macro trends at module level
with open("data/rocket_patterns.json") as f:
    ROCKET_PATTERNS = json.load(f)

with open("data/macro_trends.json") as f:
    MACRO_TRENDS = json.load(f)


def score_momentum(signals: dict) -> float:
    """
    Score momentum indicators (0-100).
    
    Based on historical rocket patterns showing strong momentum before breakouts.
    
    Args:
        signals: Dictionary of technical signals
        
    Returns:
        Momentum score (0-100)
    """
    score = 0
    if signals["mom_20d"] > 0.15:
        score += 30
    if signals["mom_60d"] > 0.30:
        score += 30
    if signals["acceleration"] > 0.10:
        score += 40
    return min(score, 100)


def score_volume(signals: dict) -> float:
    """
    Score volume surge indicators (0-100).
    
    High volume relative to history indicates institutional interest.
    
    Args:
        signals: Dictionary of technical signals
        
    Returns:
        Volume score (0-100)
    """
    score = 0
    if signals["vol_surge"] > 2.0:
        score += 50
    if signals["vol_surge"] > 3.0:
        score += 20
    if signals["vol_surge"] > 1.5:
        score += 30  # sustained volume
    return min(score, 100)


def score_trend(signals: dict) -> float:
    """
    Score trend strength indicators (0-100).
    
    Strong trends with golden cross and proximity to 52-week highs.
    
    Args:
        signals: Dictionary of technical signals
        
    Returns:
        Trend score (0-100)
    """
    score = 0
    if signals["above_sma50"] and signals["sma50_above_sma200"]:
        score += 40
    if signals["distance_from_52w_high"] > -0.15:
        score += 60
    return min(score, 100)


def score_quality(signals: dict) -> float:
    """
    Score quality indicators (0-100).
    
    Lower volatility indicates more stable, predictable moves.
    
    Args:
        signals: Dictionary of technical signals
        
    Returns:
        Quality score (0-100)
    """
    score = 100
    if signals["volatility"] > 0.60:
        score -= 40
    # Can add more penalties later for gaps/spikes
    return max(score, 0)


def compute_rocket_score(ticker: str, df: pd.DataFrame, signals: dict, sector: str) -> dict:
    """
    Compute RocketScore = Technical (60%) + Macro (40%).
    
    The RocketScore combines:
    - Technical analysis based on historical rocket patterns
    - Macro trend alignment based on sector positioning
    
    Args:
        ticker: Stock ticker symbol
        df: DataFrame with OHLCV data
        signals: Dictionary of technical signals
        sector: Stock sector
        
    Returns:
        Dictionary with:
        - rocket_score: Final score (0-100)
        - technical_score: Technical component (0-100)
        - macro_score: Macro component (0-100)
        - breakdown: Individual component scores
        - macro_trends_matched: List of matching macro trends
    """
    # Calculate component scores
    momentum = score_momentum(signals)
    volume = score_volume(signals)
    trend = score_trend(signals)
    quality = score_quality(signals)
    
    # Weighted technical score
    technical_score = (
        momentum * 0.35 +
        volume * 0.25 +
        trend * 0.25 +
        quality * 0.15
    )
    
    # Macro score: sum confidence of matching trends, cap at 100
    macro_score = 0
    matched_trends = []
    
    for trend_id, trend_data in MACRO_TRENDS.items():
        if sector in trend_data["sectors"]:
            macro_score += trend_data["confidence"]
            matched_trends.append({
                "name": trend_data["name"],
                "confidence": trend_data["confidence"],
                "thesis": trend_data["thesis"]
            })
    
    macro_score = min(macro_score, 100)
    
    # Final RocketScore: 60% technical + 40% macro
    rocket_score = technical_score * 0.6 + macro_score * 0.4
    
    return {
        "rocket_score": round(rocket_score, 2),
        "technical_score": round(technical_score, 2),
        "macro_score": round(macro_score, 2),
        "breakdown": {
            "momentum": round(momentum, 2),
            "volume": round(volume, 2),
            "trend": round(trend, 2),
            "quality": round(quality, 2)
        },
        "macro_trends_matched": matched_trends
    }


if __name__ == "__main__":
    """Test the rocket score module."""
    import sys
    sys.path.append('.')
    from src.data_fetcher import fetch_ohlcv
    from src.signals import compute_signals
    from src.universe import get_sector
    
    print("Testing RocketScore Module")
    print("=" * 60)
    
    # Test with NVDA (should score high - Technology sector with AI trends)
    test_ticker = "NVDA"
    print(f"\n1. Fetching data for {test_ticker}...")
    df = fetch_ohlcv(test_ticker, lookback_days=252)
    
    if df is None:
        print("[ERROR] Could not fetch data")
        sys.exit(1)
    
    print(f"   [OK] Fetched {len(df)} rows")
    
    print("\n2. Computing signals...")
    signals = compute_signals(df)
    print(f"   [OK] Signals computed")
    
    print("\n3. Getting sector...")
    sector = get_sector(test_ticker)
    print(f"   [OK] Sector: {sector}")
    
    print("\n4. Computing RocketScore...")
    score_data = compute_rocket_score(test_ticker, df, signals, sector)
    
    print(f"\n{'='*60}")
    print(f"ROCKET SCORE REPORT: {test_ticker}")
    print(f"{'='*60}")
    print(f"\n[ROCKET SCORE]: {score_data['rocket_score']:.2f}/100")
    print(f"\n   Technical Score: {score_data['technical_score']:.2f}/100 (60% weight)")
    print(f"   Macro Score: {score_data['macro_score']:.2f}/100 (40% weight)")
    
    print(f"\n   Component Breakdown:")
    print(f"      Momentum: {score_data['breakdown']['momentum']:.2f}/100 (35%)")
    print(f"      Volume:   {score_data['breakdown']['volume']:.2f}/100 (25%)")
    print(f"      Trend:    {score_data['breakdown']['trend']:.2f}/100 (25%)")
    print(f"      Quality:  {score_data['breakdown']['quality']:.2f}/100 (15%)")
    
    print(f"\n   Macro Trends Matched ({len(score_data['macro_trends_matched'])}):")
    for trend in score_data['macro_trends_matched']:
        print(f"      • {trend['name']} ({trend['confidence']}%)")
        print(f"        {trend['thesis']}")
    
    print(f"\n{'='*60}")
    print("[OK] RocketScore test completed!")
