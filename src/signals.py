"""Technical signal calculation module."""
import pandas as pd
import numpy as np


def compute_signals(df: pd.DataFrame) -> dict:
    """
    Compute technical signals from OHLCV data.
    
    Args:
        df: DataFrame with OHLCV data (must have 'Close' and 'Volume' columns)
        
    Returns:
        Dictionary with the following keys:
        - mom_20d: 20-day momentum (% change)
        - mom_60d: 60-day momentum (% change)
        - acceleration: Difference between 20d and 60d momentum
        - vol_surge: Ratio of 10-day avg volume to 60-day avg volume
        - volatility: 20-day rolling standard deviation of returns
        - above_sma50: Boolean, is price above 50-day SMA
        - above_sma200: Boolean, is price above 200-day SMA
        - sma50_above_sma200: Boolean, is 50-day SMA above 200-day SMA (golden cross)
        - distance_from_52w_high: Distance from 52-week high (as fraction)
        - trend_score: 1 if golden cross, 0 otherwise
        
    All percentage values are returned as decimals (0.15 for 15%).
    NaN and inf values are replaced with 0.0 for floats and False for bools.
    """
    # Calculate momentum indicators
    mom_20d = df['Close'].pct_change(20).iloc[-1]
    mom_60d = df['Close'].pct_change(60).iloc[-1]
    
    # Handle NaN/inf for momentum
    mom_20d = 0.0 if pd.isna(mom_20d) or np.isinf(mom_20d) else float(mom_20d)
    mom_60d = 0.0 if pd.isna(mom_60d) or np.isinf(mom_60d) else float(mom_60d)
    
    acceleration = mom_20d - mom_60d
    
    # Calculate volume surge
    vol_10d_avg = df['Volume'].rolling(10).mean().iloc[-1]
    vol_60d_avg = df['Volume'].rolling(60).mean().iloc[-1]
    
    if pd.isna(vol_10d_avg) or pd.isna(vol_60d_avg) or vol_60d_avg == 0:
        vol_surge = 0.0
    else:
        vol_surge = vol_10d_avg / vol_60d_avg
        vol_surge = 0.0 if np.isinf(vol_surge) else float(vol_surge)
    
    # Calculate volatility
    returns = df['Close'].pct_change()
    volatility = returns.rolling(20).std().iloc[-1]
    volatility = 0.0 if pd.isna(volatility) or np.isinf(volatility) else float(volatility)
    
    # Calculate SMAs
    sma_50 = df['Close'].rolling(50).mean().iloc[-1]
    sma_200 = df['Close'].rolling(200).mean().iloc[-1]
    current_price = df['Close'].iloc[-1]
    
    # Boolean indicators
    above_sma50 = bool(current_price > sma_50 if not pd.isna(sma_50) else False)
    above_sma200 = bool(current_price > sma_200 if not pd.isna(sma_200) else False)
    sma50_above_sma200 = bool(sma_50 > sma_200 if not (pd.isna(sma_50) or pd.isna(sma_200)) else False)
    
    # Distance from 52-week high (252 trading days)
    high_252d = df['Close'].rolling(252).max().iloc[-1]
    if pd.isna(high_252d) or high_252d == 0:
        distance_from_52w_high = 0.0
    else:
        distance_from_52w_high = (current_price - high_252d) / high_252d
        distance_from_52w_high = 0.0 if np.isinf(distance_from_52w_high) else float(distance_from_52w_high)
    
    # Trend score
    trend_score = 1 if sma50_above_sma200 else 0
    
    return {
        "mom_20d": mom_20d,
        "mom_60d": mom_60d,
        "acceleration": acceleration,
        "vol_surge": vol_surge,
        "volatility": volatility,
        "above_sma50": above_sma50,
        "above_sma200": above_sma200,
        "sma50_above_sma200": sma50_above_sma200,
        "distance_from_52w_high": distance_from_52w_high,
        "trend_score": trend_score,
    }


if __name__ == "__main__":
    """Test the signals module."""
    import sys
    sys.path.append('.')
    from src.data_fetcher import fetch_ohlcv
    
    print("Testing Signals Module")
    print("=" * 50)
    
    # Fetch test data
    print("\n1. Fetching test data for AAPL...")
    df = fetch_ohlcv("AAPL", lookback_days=300)
    
    if df is None:
        print("[ERROR] Could not fetch data")
        sys.exit(1)
    
    print(f"   [OK] Fetched {len(df)} rows")
    
    # Compute signals
    print("\n2. Computing signals...")
    signals = compute_signals(df)
    
    print(f"   [OK] Computed {len(signals)} signals")
    print("\n3. Signal values:")
    print(f"   mom_20d: {signals['mom_20d']:.4f} ({signals['mom_20d']*100:.2f}%)")
    print(f"   mom_60d: {signals['mom_60d']:.4f} ({signals['mom_60d']*100:.2f}%)")
    print(f"   acceleration: {signals['acceleration']:.4f}")
    print(f"   vol_surge: {signals['vol_surge']:.2f}x")
    print(f"   volatility: {signals['volatility']:.4f} ({signals['volatility']*100:.2f}%)")
    print(f"   above_sma50: {signals['above_sma50']}")
    print(f"   above_sma200: {signals['above_sma200']}")
    print(f"   sma50_above_sma200: {signals['sma50_above_sma200']}")
    print(f"   distance_from_52w_high: {signals['distance_from_52w_high']:.4f} ({signals['distance_from_52w_high']*100:.2f}%)")
    print(f"   trend_score: {signals['trend_score']}")
    
    # Verify no NaN/inf values
    print("\n4. Validating signal values...")
    has_issues = False
    for key, value in signals.items():
        if isinstance(value, float):
            if pd.isna(value) or np.isinf(value):
                print(f"   [ERROR] {key} has invalid value: {value}")
                has_issues = True
    
    if not has_issues:
        print("   [OK] All values are valid (no NaN/inf)")
    
    print("\n" + "=" * 50)
    print("[OK] All tests completed!")
