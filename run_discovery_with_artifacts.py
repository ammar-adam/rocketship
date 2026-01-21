"""
Discovery pipeline that writes proper artifacts for frontend integration.
Usage: python run_discovery_with_artifacts.py <runId> [--mode sp500|import] [--tickers TICKER1,TICKER2,...]
"""
import sys
import os
import asyncio
import argparse
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from src.discovery import run_discovery
from src.universe import get_universe
from src.run_orchestrator import RunOrchestrator


async def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('run_id', help='Run ID (timestamp format)')
    parser.add_argument('--mode', choices=['sp500', 'import'], default='sp500')
    parser.add_argument('--tickers', help='Comma-separated tickers for import mode')
    args = parser.parse_args()
    
    run_id = args.run_id
    mode = args.mode
    
    # Initialize orchestrator
    orchestrator = RunOrchestrator(run_id)
    
    try:
        # Determine tickers
        if mode == 'sp500':
            orchestrator.append_log("Fetching S&P 500 universe...")
            tickers = get_universe()
            orchestrator.append_log(f"Got {len(tickers)} tickers from S&P 500")
        else:
            if not args.tickers:
                raise ValueError("--tickers required for import mode")
            tickers = [t.strip().upper() for t in args.tickers.split(',')]
            orchestrator.append_log(f"Using {len(tickers)} imported tickers")
        
        # Write universe
        orchestrator.write_universe(mode, tickers)
        
        # Write initial status
        orchestrator.write_status("rocket", {
            "done": 0,
            "total": len(tickers),
            "current": None,
            "message": "Starting RocketScore analysis..."
        })
        
        orchestrator.append_log("Starting discovery pipeline...")
        
        # Import required modules
        from src.data_fetcher import fetch_ohlcv
        from src.signals import compute_signals
        from src.rocket_score import compute_rocket_score
        from src.universe import get_sector
        
        # Analyze specified tickers
        rocket_scores = []
        for i, ticker in enumerate(tickers):
            try:
                orchestrator.write_status("rocket", {
                    "done": i,
                    "total": len(tickers),
                    "current": ticker,
                    "message": f"Analyzing {ticker}..."
                })
                orchestrator.append_log(f"Analyzing {ticker}...")
                
                # Fetch data
                df = fetch_ohlcv(ticker, lookback_days=252)
                if df is None or len(df) < 252:
                    orchestrator.append_log(f"Warning: {ticker} - insufficient data")
                    continue
                
                # Compute signals
                signals = compute_signals(df)
                
                # Get sector
                sector = get_sector(ticker)
                
                # Compute RocketScore
                score_data = compute_rocket_score(ticker, df, signals, sector)
                
                # Build result
                result = {
                    "ticker": ticker,
                    "sector": sector,
                    "current_price": float(df['Close'].iloc[-1]),
                    "rocket_score": score_data["rocket_score"],
                    "technical_score": score_data["technical_score"],
                    "macro_score": score_data["macro_score"],
                    "breakdown": score_data["breakdown"],
                    "tags": [trend["name"].split()[0] for trend in score_data.get("macro_trends_matched", [])],
                    "macro_trends_matched": score_data.get("macro_trends_matched", [])
                }
                
                rocket_scores.append(result)
                orchestrator.append_log(f"Completed {ticker}: score={score_data['rocket_score']:.1f}")
                
            except Exception as e:
                orchestrator.append_log(f"Error analyzing {ticker}: {str(e)}")
                continue
        
        # Sort by rocket_score descending
        rocket_scores.sort(key=lambda x: x['rocket_score'], reverse=True)
        
        orchestrator.append_log(f"Discovery complete. Analyzed {len(rocket_scores)} stocks")
        orchestrator.write_rocket_scores(rocket_scores)
        
        # Update status to done
        orchestrator.write_status("done", {
            "done": len(rocket_scores),
            "total": len(tickers),
            "current": None,
            "message": "Analysis complete"
        })
        
        orchestrator.append_log("Pipeline complete")
        print(f"Success: {run_id}")
        
    except Exception as e:
        orchestrator.append_log(f"ERROR: {str(e)}")
        orchestrator.write_status("error", errors=[str(e)])
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
