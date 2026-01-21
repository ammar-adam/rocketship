"""Portfolio allocation logic."""
import pandas as pd


def allocate_portfolio(analysis_results: list, portfolio_size: float = 10000.0) -> dict:
    """
    Allocate portfolio based on ENTER verdicts, weighted by RocketScore × Conviction.
    
    Args:
        analysis_results: List of analysis dictionaries from agents
        portfolio_size: Total portfolio value in dollars
        
    Returns:
        Dictionary with positions, allocation details, and statistics
    """
    # Filter to ENTER verdicts only
    enter_stocks = [
        r for r in analysis_results 
        if r['judge'].get('verdict') == 'ENTER'
    ]
    
    if not enter_stocks:
        return {
            "positions": [],
            "total_allocated": 0.0,
            "cash_remaining": portfolio_size,
            "num_positions": 0,
            "avg_conviction": 0
        }
    
    # Calculate weights: (rocket_score × conviction) / 100
    for stock in enter_stocks:
        rocket_score = stock['facts_pack']['rocket_score']
        conviction = stock['judge'].get('conviction', 50)
        stock['weight'] = (rocket_score * conviction) / 10000  # Normalize
    
    # Normalize weights to sum to 1.0
    total_weight = sum(s['weight'] for s in enter_stocks)
    for stock in enter_stocks:
        stock['normalized_weight'] = stock['weight'] / total_weight
    
    # Apply position size constraints (5-20%)
    min_position = portfolio_size * 0.05
    max_position = portfolio_size * 0.20
    
    positions = []
    for stock in enter_stocks:
        position_value = stock['normalized_weight'] * portfolio_size
        
        # Apply constraints
        position_value = max(min_position, min(position_value, max_position))
        
        price = stock['facts_pack']['current_price']
        shares = int(position_value / price)
        actual_value = shares * price
        
        positions.append({
            "ticker": stock['ticker'],
            "shares": shares,
            "price": price,
            "position_value": actual_value,
            "weight": actual_value / portfolio_size,
            "conviction": stock['judge'].get('conviction', 0),
            "rocket_score": stock['facts_pack']['rocket_score']
        })
    
    # Calculate totals
    total_allocated = sum(p['position_value'] for p in positions)
    cash_remaining = portfolio_size - total_allocated
    avg_conviction = sum(p['conviction'] for p in positions) / len(positions) if positions else 0
    
    return {
        "positions": positions,
        "total_allocated": total_allocated,
        "cash_remaining": cash_remaining,
        "num_positions": len(positions),
        "avg_conviction": avg_conviction
    }


def save_portfolio(portfolio: dict, output_dir: str) -> None:
    """
    Save portfolio to CSV and summary to markdown.
    
    Args:
        portfolio: Portfolio allocation dictionary
        output_dir: Output directory for files
    """
    # Save portfolio.csv
    if portfolio['positions']:
        df = pd.DataFrame(portfolio['positions'])
        df.to_csv(f"{output_dir}/portfolio.csv", index=False)
    
    # Save portfolio_summary.md
    summary = f"""# Portfolio Allocation

**Total Allocated:** ${portfolio['total_allocated']:.2f}  
**Cash Remaining:** ${portfolio['cash_remaining']:.2f}  
**Number of Positions:** {portfolio['num_positions']}  
**Average Conviction:** {portfolio['avg_conviction']:.1f}/100

## Positions

"""
    
    if portfolio['positions']:
        for p in sorted(portfolio['positions'], key=lambda x: x['position_value'], reverse=True):
            summary += f"- **{p['ticker']}**: {p['shares']} shares @ ${p['price']:.2f} = ${p['position_value']:.2f} ({p['weight']*100:.1f}%)\n"
            summary += f"  - Conviction: {p['conviction']}/100, RocketScore: {p['rocket_score']:.1f}\n\n"
    else:
        summary += "No positions (no ENTER verdicts)\n"
    
    with open(f"{output_dir}/portfolio_summary.md", "w") as f:
        f.write(summary)
