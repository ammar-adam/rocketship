"""Discovery engine to screen stocks and find top candidates."""
import os
import sys
import json
import pandas as pd
from datetime import datetime
from rich.console import Console
from rich.progress import track

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.universe import get_universe, get_sector
from src.data_fetcher import fetch_ohlcv
from src.signals import compute_signals
from src.rocket_score import compute_rocket_score


def run_discovery() -> dict:
    """
    Screen entire universe, compute RocketScore for each, return top 25.
    
    Process:
    1. Get universe of ~493 stocks (S&P 500 minus MAG7)
    2. For each stock:
       - Fetch OHLCV data
       - Compute technical signals
       - Compute RocketScore (technical + macro)
    3. Rank by RocketScore, select top 25
    4. Save results to runs/{timestamp}/
    
    Returns:
        Dictionary with:
        - timestamp: Run timestamp
        - run_dir: Output directory path
        - top_25: List of top 25 stocks with scores
        - total_analyzed: Number of stocks successfully analyzed
    """
    console = Console()
    console.print("\n[bold green]RocketShip Discovery Engine[/bold green]\n")
    
    # Get universe
    universe = get_universe()
    console.print(f"[cyan]Analyzing {len(universe)} stocks from S&P 500 (ex-MAG7)...[/cyan]\n")
    
    results = []
    
    # Screen all stocks
    for ticker in track(universe, description="Screening stocks"):
        try:
            # Fetch data
            df = fetch_ohlcv(ticker, lookback_days=252)
            if df is None or len(df) < 252:
                continue
            
            # Compute signals
            signals = compute_signals(df)
            
            # Get sector
            sector = get_sector(ticker)
            
            # Compute RocketScore
            score_data = compute_rocket_score(ticker, df, signals, sector)
            
            # Collect result
            results.append({
                "ticker": ticker,
                **score_data,
                "current_price": float(df['Close'].iloc[-1]),
                "sector": sector
            })
            
        except Exception as e:
            console.log(f"[yellow]Warning: {ticker} failed - {str(e)}[/yellow]")
            continue
    
    # Sort by rocket_score descending
    ranked = sorted(results, key=lambda x: x['rocket_score'], reverse=True)
    top_25 = ranked[:25]
    
    # Create output directory
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir = f"runs/{timestamp}"
    os.makedirs(run_dir, exist_ok=True)
    
    # Save all ranked stocks to CSV
    df_ranked = pd.DataFrame(ranked)
    df_ranked.to_csv(f"{run_dir}/all_ranked.csv", index=False)
    
    # Save top 25 as JSON
    with open(f"{run_dir}/top_25.json", "w") as f:
        json.dump(top_25, f, indent=2)
    
    # Print summary
    console.print(f"\n[bold green]Analysis complete![/bold green]\n")
    console.print(f"[cyan]Top 5 stocks:[/cyan]")
    for i, stock in enumerate(top_25[:5], 1):
        console.print(f"  {i}. {stock['ticker']:6s} - RocketScore: {stock['rocket_score']:.2f} ({stock['sector']})")
    
    console.print(f"\n[cyan]Total analyzed:[/cyan] {len(results)} stocks")
    console.print(f"[cyan]Saved to:[/cyan] {run_dir}/")
    console.print(f"  • all_ranked.csv - All {len(results)} stocks ranked by score")
    console.print(f"  • top_25.json - Top 25 candidates with full details\n")
    
    return {
        "timestamp": timestamp,
        "run_dir": run_dir,
        "top_25": top_25,
        "total_analyzed": len(results)
    }


if __name__ == "__main__":
    """Run the discovery engine."""
    print("\n" + "="*60)
    print("ROCKETSHIP DISCOVERY ENGINE")
    print("="*60 + "\n")
    
    result = run_discovery()
    
    print("\n" + "="*60)
    print("RUN SUMMARY")
    print("="*60)
    print(f"Timestamp: {result['timestamp']}")
    print(f"Total analyzed: {result['total_analyzed']} stocks")
    print(f"Top 25 candidates saved to: {result['run_dir']}")
    print("="*60 + "\n")
