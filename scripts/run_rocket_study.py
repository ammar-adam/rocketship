"""Historical rocket analysis to find common patterns in 100%+ gainers."""
import os
import sys
import json
from datetime import datetime
import pandas as pd
import numpy as np
from tqdm import tqdm

# Add parent directory to path to import modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.data_fetcher import fetch_ohlcv
from src.signals import compute_signals
from src.universe import get_sector


def calculate_lookback_days(start_date: str, end_date: str) -> int:
    """Calculate number of calendar days between two dates."""
    start = datetime.strptime(start_date, "%Y-%m-%d")
    end = datetime.strptime(end_date, "%Y-%m-%d")
    return (end - start).days


def find_rocket_events(ticker: str, start_date: str, end_date: str):
    """
    Find rocket events (100%+ gains in 126 trading days) for a ticker.
    
    Args:
        ticker: Stock ticker symbol
        start_date: Start date in YYYY-MM-DD format
        end_date: End date in YYYY-MM-DD format
        
    Returns:
        List of dictionaries containing rocket event data
    """
    print(f"\n[INFO] Analyzing {ticker}...")
    
    # Fetch historical data
    lookback_days = calculate_lookback_days(start_date, end_date) + 200  # Extra buffer
    df = fetch_ohlcv(ticker, lookback_days=lookback_days)
    
    if df is None or len(df) < 150:
        print(f"[WARN] Insufficient data for {ticker}")
        return []
    
    # Calculate rolling 126-day forward returns
    df['forward_return'] = df['Close'].shift(-126) / df['Close'] - 1.0
    
    # Find rocket events (100%+ forward return)
    rocket_indices = df[df['forward_return'] >= 1.0].index
    
    print(f"[INFO] Found {len(rocket_indices)} rocket events for {ticker}")
    
    # Get sector
    sector = get_sector(ticker)
    
    # Extract signals 20 days BEFORE each rocket event
    rocket_events = []
    for event_date in rocket_indices:
        try:
            # Get index position of event date
            event_idx = df.index.get_loc(event_date)
            
            # Need at least 20 days before + 252 days for full signal calculation
            if event_idx < 272:
                continue
            
            # Get data up to 20 days BEFORE the rocket event
            signal_idx = event_idx - 20
            df_before_rocket = df.iloc[:signal_idx + 1]
            
            # Compute signals at that point in time
            signals = compute_signals(df_before_rocket)
            
            # Get forward return value
            forward_return = df.loc[event_date, 'forward_return']
            
            # Store event data
            event = {
                "ticker": ticker,
                "sector": sector,
                "event_date": event_date.strftime("%Y-%m-%d"),
                "forward_return": float(forward_return),
                "signals": {
                    "mom_20d": signals["mom_20d"],
                    "mom_60d": signals["mom_60d"],
                    "acceleration": signals["acceleration"],
                    "vol_surge": signals["vol_surge"],
                    "volatility": signals["volatility"],
                    "above_sma50": signals["above_sma50"],
                    "above_sma200": signals["above_sma200"],
                    "sma50_above_sma200": signals["sma50_above_sma200"],
                    "distance_from_52w_high": signals["distance_from_52w_high"],
                    "trend_score": signals["trend_score"]
                }
            }
            rocket_events.append(event)
            
        except Exception as e:
            print(f"[WARN] Error processing event on {event_date} for {ticker}: {e}")
            continue
    
    return rocket_events


def aggregate_rocket_data(all_events):
    """
    Aggregate rocket event data into summary statistics.
    
    Args:
        all_events: List of all rocket event dictionaries
        
    Returns:
        Dictionary with aggregated statistics
    """
    if not all_events:
        return {
            "total_rockets": 0,
            "date_range": "2020-2025",
            "sector_distribution": {},
            "average_signals_pre_rocket": {},
            "thresholds_75th_percentile": {}
        }
    
    # Convert to DataFrame for easier aggregation
    df = pd.DataFrame(all_events)
    
    # Sector distribution
    sector_dist = df['sector'].value_counts().to_dict()
    
    # Extract all signal values into separate columns
    signal_cols = ['mom_20d', 'mom_60d', 'acceleration', 'vol_surge', 'volatility']
    signal_df = pd.DataFrame([event['signals'] for event in all_events])
    
    # Calculate average signals
    avg_signals = {}
    for col in signal_cols:
        avg_signals[col] = float(signal_df[col].mean())
    
    # Calculate 75th percentile thresholds
    thresholds = {
        "mom_20d": float(signal_df['mom_20d'].quantile(0.75)),
        "vol_surge": float(signal_df['vol_surge'].quantile(0.75)),
        "volatility": float(signal_df['volatility'].quantile(0.75))
    }
    
    return {
        "total_rockets": len(all_events),
        "date_range": "2020-2025",
        "sector_distribution": sector_dist,
        "average_signals_pre_rocket": avg_signals,
        "thresholds_75th_percentile": thresholds
    }


def main():
    """Run the rocket study analysis."""
    print("=" * 60)
    print("ROCKETSHIP HISTORICAL STUDY (2020-2025)")
    print("=" * 60)
    print("\nAnalyzing stocks that gained 100%+ in 6-month periods...")
    print("Extracting common signals 20 days before rocket events\n")
    
    # Test set tickers
    test_tickers = [
        "NVDA", "TSLA", "PLTR", "AMD", "SMCI",
        "ENPH", "MRNA", "COIN", "RIOT", "MARA"
    ]
    
    # Date range
    start_date = "2020-01-01"
    end_date = "2025-12-31"
    
    # Find rocket events for all tickers
    all_events = []
    for ticker in tqdm(test_tickers, desc="Analyzing tickers"):
        try:
            events = find_rocket_events(ticker, start_date, end_date)
            all_events.extend(events)
        except Exception as e:
            print(f"[ERROR] Failed to analyze {ticker}: {e}")
            continue
    
    print(f"\n[INFO] Total rocket events found: {len(all_events)}")
    
    # Aggregate results
    print("[INFO] Aggregating results...")
    summary = aggregate_rocket_data(all_events)
    
    # Create output directory
    os.makedirs("data", exist_ok=True)
    
    # Save to JSON
    output_file = "data/rocket_patterns.json"
    with open(output_file, 'w') as f:
        json.dump(summary, f, indent=2)
    
    print(f"\n[OK] Results saved to {output_file}")
    
    # Print summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"Total rocket events: {summary['total_rockets']}")
    print(f"\nSector distribution:")
    for sector, count in summary['sector_distribution'].items():
        print(f"  {sector}: {count}")
    
    print(f"\nAverage signals 20 days before rocket:")
    for signal, value in summary['average_signals_pre_rocket'].items():
        if signal in ['mom_20d', 'mom_60d', 'acceleration']:
            print(f"  {signal}: {value:.4f} ({value*100:.2f}%)")
        elif signal == 'vol_surge':
            print(f"  {signal}: {value:.2f}x")
        else:
            print(f"  {signal}: {value:.4f}")
    
    print(f"\n75th percentile thresholds:")
    for signal, value in summary['thresholds_75th_percentile'].items():
        if 'mom' in signal:
            print(f"  {signal}: {value:.4f} ({value*100:.2f}%)")
        elif signal == 'vol_surge':
            print(f"  {signal}: {value:.2f}x")
        else:
            print(f"  {signal}: {value:.4f}")
    
    print("\n" + "=" * 60)
    print("[OK] Rocket study completed!")
    print("=" * 60)


if __name__ == "__main__":
    main()
