"""
Portfolio optimizer using constrained equal-weight or risk-adjusted allocation.
Outputs portfolio.json in the required schema.
"""
import sys
import os
import json
import argparse

def optimize_portfolio(
    run_id: str,
    capital: float = 10000,
    max_weight: float = 0.15,
    sector_cap: float = 0.35,
    min_positions: int = 8
):
    """
    Optimize portfolio allocation based on debate verdicts and rocket scores.
    Falls back to constrained equal-weight if no return data available.
    """
    run_dir = os.path.join('runs', run_id)
    
    # Load required files
    scores_path = os.path.join(run_dir, 'rocket_scores.json')
    summary_path = os.path.join(run_dir, 'debate_summary.json')
    
    with open(scores_path, 'r') as f:
        scores = json.load(f)
    
    # Build ticker -> score map
    ticker_scores = {s['ticker']: s for s in scores}
    
    # Load debate summary if exists
    eligible_tickers = []
    if os.path.exists(summary_path):
        with open(summary_path, 'r') as f:
            summary = json.load(f)
        
        # BUY + HOLD are eligible
        eligible_tickers = summary.get('buy', []) + summary.get('hold', [])
        
        # If not enough, add top WAIT by rocket_score
        if len(eligible_tickers) < min_positions:
            wait_tickers = summary.get('wait', [])
            wait_with_scores = [(t, ticker_scores.get(t, {}).get('rocket_score', 0)) for t in wait_tickers]
            wait_with_scores.sort(key=lambda x: x[1], reverse=True)
            
            needed = min_positions - len(eligible_tickers)
            eligible_tickers.extend([t for t, _ in wait_with_scores[:needed]])
    else:
        # No debate, use top stocks by rocket_score
        sorted_scores = sorted(scores, key=lambda x: x['rocket_score'], reverse=True)
        eligible_tickers = [s['ticker'] for s in sorted_scores[:min_positions]]
    
    # Filter to valid tickers
    eligible = [t for t in eligible_tickers if t in ticker_scores]
    
    if len(eligible) == 0:
        # No eligible tickers, return empty portfolio
        portfolio = {
            'capital': capital,
            'constraints': {
                'max_weight': max_weight,
                'sector_cap': sector_cap,
                'min_positions': min_positions
            },
            'allocations': [],
            'sector_breakdown': [],
            'summary': {
                'positions': 0,
                'cash_weight': 1.0
            }
        }
        return portfolio
    
    # Build sector map
    sector_map = {}
    for ticker in eligible:
        sector = ticker_scores[ticker].get('sector') or 'Unknown'
        if sector not in sector_map:
            sector_map[sector] = []
        sector_map[sector].append(ticker)
    
    # Constrained equal-weight allocation
    # Start with equal weight
    n = len(eligible)
    base_weight = 1.0 / n
    
    # Cap at max_weight
    weights = {t: min(base_weight, max_weight) for t in eligible}
    
    # Apply sector caps
    for sector, tickers in sector_map.items():
        sector_weight = sum(weights[t] for t in tickers)
        if sector_weight > sector_cap:
            # Scale down sector tickers
            scale = sector_cap / sector_weight
            for t in tickers:
                weights[t] *= scale
    
    # Normalize to sum to 1
    total = sum(weights.values())
    if total > 0:
        weights = {t: w / total for t, w in weights.items()}
    
    # Build allocations
    allocations = []
    for ticker in eligible:
        w = weights[ticker]
        score_data = ticker_scores[ticker]
        allocations.append({
            'ticker': ticker,
            'weight': round(w, 4),
            'dollars': round(w * capital, 2),
            'sector': score_data.get('sector') or 'Unknown'
        })
    
    # Sort by weight descending
    allocations.sort(key=lambda x: x['weight'], reverse=True)
    
    # Build sector breakdown
    sector_weights = {}
    for alloc in allocations:
        sector = alloc['sector']
        sector_weights[sector] = sector_weights.get(sector, 0) + alloc['weight']
    
    sector_breakdown = [
        {'sector': s, 'weight': round(w, 4)}
        for s, w in sorted(sector_weights.items(), key=lambda x: x[1], reverse=True)
    ]
    
    portfolio = {
        'capital': capital,
        'constraints': {
            'max_weight': max_weight,
            'sector_cap': sector_cap,
            'min_positions': min_positions
        },
        'allocations': allocations,
        'sector_breakdown': sector_breakdown,
        'summary': {
            'positions': len(allocations),
            'cash_weight': round(1.0 - sum(a['weight'] for a in allocations), 4)
        }
    }
    
    return portfolio


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('run_id', help='Run ID')
    parser.add_argument('--capital', type=float, default=10000)
    parser.add_argument('--max-weight', type=float, default=0.15)
    parser.add_argument('--sector-cap', type=float, default=0.35)
    parser.add_argument('--min-positions', type=int, default=8)
    args = parser.parse_args()
    
    print(f"Optimizing portfolio for run {args.run_id}...")
    
    portfolio = optimize_portfolio(
        args.run_id,
        capital=args.capital,
        max_weight=args.max_weight,
        sector_cap=args.sector_cap,
        min_positions=args.min_positions
    )
    
    # Write portfolio.json
    output_path = os.path.join('runs', args.run_id, 'portfolio.json')
    with open(output_path, 'w') as f:
        json.dump(portfolio, f, indent=2)
    
    print(f"Portfolio written: {len(portfolio['allocations'])} positions")
    print(f"Output: {output_path}")


if __name__ == '__main__':
    main()
