"""Main entry point for RocketShip full pipeline."""
import sys
import os
import asyncio

# Add current directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from rich.console import Console
from rich.progress import track

from src.discovery import run_discovery
from src.data_fetcher import fetch_ohlcv
from src.signals import compute_signals
from src.rocket_score import compute_rocket_score
from src.universe import get_sector
from src.agents import analyze_stock
from src.memos import write_memo
from src.allocation import allocate_portfolio, save_portfolio

console = Console()


async def main():
    """Run the full RocketShip pipeline."""
    console.print("\n[bold green]RocketShip - Full Pipeline[/bold green]")
    console.print("=" * 60)
    
    # Step 1: Discovery (get top 25 stocks)
    console.print("\n[cyan]Step 1: Running discovery engine...[/cyan]")
    discovery_result = run_discovery()
    top_25 = discovery_result['top_25']
    run_dir = discovery_result['run_dir']
    
    console.print(f"[green]Analysis complete![/green]")
    console.print(f"Top 5: {[s['ticker'] for s in top_25[:5]]}")
    
    # Step 2: Multi-agent analysis for each stock
    console.print(f"\n[cyan]Step 2: Analyzing top 25 stocks with agents...[/cyan]")
    analysis_results = []
    
    for stock_data in track(top_25, description="Running agent debates"):
        try:
            ticker = stock_data['ticker']
            
            # Fetch data and compute signals (may be cached)
            df = fetch_ohlcv(ticker, lookback_days=252)
            if df is None:
                continue
                
            signals = compute_signals(df)
            sector = get_sector(ticker)
            rocket_score_data = compute_rocket_score(ticker, df, signals, sector)
            
            # Run all 5 agents
            analysis = await analyze_stock(ticker, df, signals, rocket_score_data, sector)
            analysis_results.append(analysis)
            
            # Write memo
            write_memo(ticker, analysis, run_dir)
            
        except Exception as e:
            console.log(f"[yellow]Warning: {ticker} analysis failed - {str(e)}[/yellow]")
            continue
    
    console.print(f"[green]Analyzed {len(analysis_results)} stocks[/green]")
    
    # Step 3: Portfolio allocation
    console.print(f"\n[cyan]Step 3: Allocating portfolio...[/cyan]")
    portfolio = allocate_portfolio(analysis_results, portfolio_size=10000.0)
    save_portfolio(portfolio, run_dir)
    
    console.print(f"[green]Portfolio allocated: {portfolio['num_positions']} positions[/green]")
    
    # Summary
    console.print("\n" + "=" * 60)
    console.print(f"[bold green]Pipeline Complete![/bold green]")
    console.print(f"\nOutput directory: {run_dir}")
    
    if portfolio['positions']:
        console.print(f"Top positions: {[p['ticker'] for p in portfolio['positions'][:5]]}")
        console.print(f"Total allocated: ${portfolio['total_allocated']:.2f}")
        console.print(f"Cash remaining: ${portfolio['cash_remaining']:.2f}")
    else:
        console.print("No positions allocated (no ENTER verdicts)")
    
    console.print("\nFiles created:")
    console.print(f"  - {run_dir}/all_ranked.csv")
    console.print(f"  - {run_dir}/top_25.json")
    console.print(f"  - {run_dir}/portfolio.csv")
    console.print(f"  - {run_dir}/portfolio_summary.md")
    console.print(f"  - {run_dir}/memos/*.md (25 files)")
    console.print("\n" + "=" * 60 + "\n")


if __name__ == "__main__":
    asyncio.run(main())
