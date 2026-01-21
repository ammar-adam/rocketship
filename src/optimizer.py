"""
Portfolio Optimizer using CVXPY
===============================
Implements convex optimization with:
- Factor tilts (momentum, quality, expected return proxy)
- Risk penalty (covariance-based)
- L1 sparsity penalty for concentration
- Hard constraints (max weight, sector caps, position count)

OUTPUT: 8-25 positions, NEVER more.
"""
import sys
import os
import json
import argparse
import numpy as np
import pandas as pd
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional

# Add project root to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def fetch_returns_for_tickers(tickers: List[str], lookback_days: int = 252) -> pd.DataFrame:
    """Fetch historical returns for covariance estimation."""
    import yfinance as yf
    
    end_date = datetime.now()
    start_date = end_date - timedelta(days=lookback_days + 30)  # Buffer for trading days
    
    prices = {}
    for ticker in tickers:
        try:
            data = yf.download(ticker, start=start_date, end=end_date, progress=False)
            if len(data) >= lookback_days // 2:  # At least half the data
                prices[ticker] = data['Close']
        except Exception as e:
            print(f"Warning: Could not fetch {ticker}: {e}")
    
    if not prices:
        return pd.DataFrame()
    
    df = pd.DataFrame(prices)
    returns = df.pct_change().dropna()
    return returns


def compute_covariance_matrix(returns: pd.DataFrame) -> np.ndarray:
    """Compute sample covariance matrix with shrinkage."""
    if returns.empty:
        return np.eye(1)
    
    # Sample covariance
    sample_cov = returns.cov().values
    
    # Ledoit-Wolf shrinkage toward identity (simplified)
    n = len(returns)
    p = sample_cov.shape[0]
    
    # Shrinkage target: scaled identity
    trace = np.trace(sample_cov)
    target = (trace / p) * np.eye(p)
    
    # Shrinkage intensity (simplified constant)
    shrinkage = 0.2
    
    # Shrunk covariance
    cov = (1 - shrinkage) * sample_cov + shrinkage * target
    
    # Ensure positive semi-definite
    eigenvalues = np.linalg.eigvalsh(cov)
    if np.min(eigenvalues) < 0:
        cov += (-np.min(eigenvalues) + 1e-6) * np.eye(p)
    
    return cov


def optimize_portfolio(
    run_id: str,
    capital: float = 10000,
    max_weight: float = 0.15,
    sector_cap: float = 0.35,
    min_positions: int = 8,
    max_positions: int = 25,
    risk_lambda: float = 1.0,
    l1_lambda: float = 0.01,
    tilt_momentum: float = 0.5,
    tilt_quality: float = 0.3,
) -> Dict[str, Any]:
    """
    Optimize portfolio using CVXPY.
    
    Objective:
        Maximize: tilt_momentum * (w · momentum_proxy)
                + tilt_quality * (w · quality_proxy)
                - risk_lambda * (w'Σw)
                - l1_lambda * ||w||₁
    
    Constraints:
        - sum(w) = 1
        - 0 <= w_i <= max_weight
        - sector weights <= sector_cap
        - Result has 8-25 positions (enforced via post-processing)
    """
    try:
        import cvxpy as cp
    except ImportError:
        print("CVXPY not installed. Using fallback optimization.")
        return optimize_fallback(run_id, capital, max_weight, sector_cap, min_positions, max_positions)
    
    run_dir = os.path.join('runs', run_id)
    
    # Load required files
    scores_path = os.path.join(run_dir, 'rocket_scores.json')
    summary_path = os.path.join(run_dir, 'debate_summary.json')
    
    with open(scores_path, 'r') as f:
        scores = json.load(f)
    
    # Build ticker -> score map
    ticker_scores = {s['ticker']: s for s in scores}
    
    # Determine eligible tickers
    eligible_tickers = []
    if os.path.exists(summary_path):
        with open(summary_path, 'r') as f:
            summary = json.load(f)
        
        # BUY first, then HOLD
        buy_tickers = summary.get('buy', [])
        hold_tickers = summary.get('hold', [])
        wait_tickers = summary.get('wait', [])
        
        eligible_tickers = buy_tickers + hold_tickers
        
        # If not enough, add top WAIT by rocket_score
        if len(eligible_tickers) < min_positions:
            wait_with_scores = [(t, ticker_scores.get(t, {}).get('rocket_score', 0)) for t in wait_tickers]
            wait_with_scores.sort(key=lambda x: x[1], reverse=True)
            needed = min_positions - len(eligible_tickers)
            eligible_tickers.extend([t for t, _ in wait_with_scores[:needed]])
    else:
        # No debate, use top stocks by rocket_score
        sorted_scores = sorted(scores, key=lambda x: x['rocket_score'], reverse=True)
        eligible_tickers = [s['ticker'] for s in sorted_scores[:max(min_positions, 30)]]
    
    # Filter to valid tickers
    eligible = [t for t in eligible_tickers if t in ticker_scores]
    
    if len(eligible) == 0:
        return create_empty_portfolio(capital, max_weight, sector_cap, min_positions, max_positions)
    
    n = len(eligible)
    print(f"Optimizing over {n} eligible tickers...")
    
    # Build factor proxies
    momentum_proxy = np.array([ticker_scores[t].get('technical_score', 50) / 100 for t in eligible])
    quality_proxy = np.array([ticker_scores[t].get('quality_score', 50) / 100 for t in eligible])
    rocket_proxy = np.array([ticker_scores[t].get('rocket_score', 50) / 100 for t in eligible])
    
    # Build sector mapping
    sectors = [ticker_scores[t].get('sector', 'Unknown') or 'Unknown' for t in eligible]
    unique_sectors = list(set(sectors))
    sector_matrix = np.zeros((len(unique_sectors), n))
    for i, t in enumerate(eligible):
        sector = ticker_scores[t].get('sector', 'Unknown') or 'Unknown'
        sector_idx = unique_sectors.index(sector)
        sector_matrix[sector_idx, i] = 1
    
    # Fetch returns for covariance (optional, use identity if fails)
    print("Fetching historical returns for covariance estimation...")
    returns = fetch_returns_for_tickers(eligible, lookback_days=126)
    
    if returns.empty or len(returns.columns) < 3:
        print("Insufficient return data, using diagonal covariance")
        # Use scaled identity based on volatility proxy
        vol_proxy = np.array([ticker_scores[t].get('breakdown', {}).get('quality', 50) / 100 for t in eligible])
        vol_proxy = np.clip(vol_proxy, 0.1, 1.0)
        cov_matrix = np.diag(vol_proxy ** 2) * 0.04  # ~20% annual vol
    else:
        # Align returns with eligible tickers
        available_tickers = [t for t in eligible if t in returns.columns]
        if len(available_tickers) < len(eligible):
            # Fill missing with avg correlation assumption
            full_cov = np.eye(n) * 0.04
            for i, t in enumerate(eligible):
                if t in returns.columns:
                    for j, t2 in enumerate(eligible):
                        if t2 in returns.columns:
                            full_cov[i, j] = returns[t].cov(returns[t2]) * 252
            cov_matrix = full_cov
        else:
            returns_aligned = returns[eligible]
            cov_matrix = compute_covariance_matrix(returns_aligned) * 252  # Annualize
    
    # CVXPY optimization
    w = cp.Variable(n)
    
    # Objective
    momentum_term = tilt_momentum * (momentum_proxy @ w)
    quality_term = tilt_quality * (quality_proxy @ w)
    risk_term = risk_lambda * cp.quad_form(w, cov_matrix)
    l1_term = l1_lambda * cp.norm(w, 1)
    
    objective = cp.Maximize(momentum_term + quality_term - risk_term - l1_term)
    
    # Constraints
    constraints = [
        cp.sum(w) == 1,
        w >= 0,
        w <= max_weight,
    ]
    
    # Sector constraints
    for i, sector in enumerate(unique_sectors):
        sector_weight = sector_matrix[i, :] @ w
        constraints.append(sector_weight <= sector_cap)
    
    # Solve
    problem = cp.Problem(objective, constraints)
    try:
        problem.solve(solver=cp.OSQP, verbose=False)
    except:
        try:
            problem.solve(solver=cp.CLARABEL, verbose=False)
        except:
            problem.solve(verbose=False)
    
    if problem.status not in ['optimal', 'optimal_inaccurate']:
        print(f"Optimization status: {problem.status}")
        return optimize_fallback(run_id, capital, max_weight, sector_cap, min_positions, max_positions)
    
    weights = w.value
    
    # Post-processing: enforce 8-25 positions
    # Threshold small weights and renormalize
    threshold = 0.005  # 0.5% minimum
    weights[weights < threshold] = 0
    
    # Count non-zero
    nonzero_mask = weights > 0
    nonzero_count = np.sum(nonzero_mask)
    
    # If too many positions, keep top max_positions
    if nonzero_count > max_positions:
        sorted_indices = np.argsort(weights)[::-1]
        for i in sorted_indices[max_positions:]:
            weights[i] = 0
        nonzero_count = max_positions
    
    # If too few positions, lower threshold
    if nonzero_count < min_positions:
        # Sort by weight, keep at least min_positions
        sorted_indices = np.argsort(w.value)[::-1]
        weights = np.zeros(n)
        for i in sorted_indices[:min_positions]:
            weights[i] = w.value[i] if w.value[i] > 0 else 0.01
        nonzero_count = min_positions
    
    # Renormalize
    if np.sum(weights) > 0:
        weights = weights / np.sum(weights)
    else:
        # Fallback to equal weight
        weights = np.ones(min_positions) / min_positions
        weights = np.concatenate([weights, np.zeros(n - min_positions)])
    
    # Build allocations
    allocations = []
    for i, ticker in enumerate(eligible):
        if weights[i] > 0.001:  # 0.1% minimum
            score_data = ticker_scores[ticker]
            allocations.append({
                'ticker': ticker,
                'weight': round(float(weights[i]), 4),
                'dollars': round(float(weights[i]) * capital, 2),
                'sector': score_data.get('sector') or 'Unknown',
                'rocket_score': score_data.get('rocket_score', 0),
                'expected_return_proxy': round(float(rocket_proxy[i]) * 100, 2)
            })
    
    # Sort by weight descending
    allocations.sort(key=lambda x: x['weight'], reverse=True)
    
    # Limit to max_positions
    if len(allocations) > max_positions:
        allocations = allocations[:max_positions]
        # Renormalize
        total = sum(a['weight'] for a in allocations)
        for a in allocations:
            a['weight'] = round(a['weight'] / total, 4)
            a['dollars'] = round(a['weight'] * capital, 2)
    
    # Build sector breakdown
    sector_weights = {}
    for alloc in allocations:
        sector = alloc['sector']
        sector_weights[sector] = sector_weights.get(sector, 0) + alloc['weight']
    
    sector_breakdown = [
        {'sector': s, 'weight': round(w, 4)}
        for s, w in sorted(sector_weights.items(), key=lambda x: x[1], reverse=True)
    ]
    
    # Compute backtest metrics (simplified)
    backtest = compute_backtest(allocations, eligible, returns, capital)
    
    portfolio = {
        'capital': capital,
        'constraints': {
            'max_weight': max_weight,
            'sector_cap': sector_cap,
            'min_positions': min_positions,
            'max_positions': max_positions
        },
        'optimization_params': {
            'risk_lambda': risk_lambda,
            'l1_lambda': l1_lambda,
            'tilt_momentum': tilt_momentum,
            'tilt_quality': tilt_quality
        },
        'allocations': allocations,
        'sector_breakdown': sector_breakdown,
        'summary': {
            'positions': len(allocations),
            'cash_weight': round(1.0 - sum(a['weight'] for a in allocations), 4),
            'avg_rocket_score': round(np.mean([a['rocket_score'] for a in allocations]), 2) if allocations else 0
        },
        'backtest': backtest,
        'methodology': {
            'optimizer': 'CVXPY',
            'objective': 'Maximize(momentum_tilt + quality_tilt - risk_penalty - sparsity_penalty)',
            'constraints': ['sum(w)=1', 'w>=0', f'w<={max_weight}', f'sector<={sector_cap}', f'positions: {min_positions}-{max_positions}']
        }
    }
    
    return portfolio


def optimize_fallback(run_id, capital, max_weight, sector_cap, min_positions, max_positions):
    """Fallback to constrained equal-weight when CVXPY fails."""
    run_dir = os.path.join('runs', run_id)
    
    scores_path = os.path.join(run_dir, 'rocket_scores.json')
    summary_path = os.path.join(run_dir, 'debate_summary.json')
    
    with open(scores_path, 'r') as f:
        scores = json.load(f)
    
    ticker_scores = {s['ticker']: s for s in scores}
    
    # Determine eligible tickers
    eligible_tickers = []
    if os.path.exists(summary_path):
        with open(summary_path, 'r') as f:
            summary = json.load(f)
        buy_tickers = summary.get('buy', [])
        hold_tickers = summary.get('hold', [])
        eligible_tickers = buy_tickers + hold_tickers
    
    if len(eligible_tickers) < min_positions:
        sorted_scores = sorted(scores, key=lambda x: x['rocket_score'], reverse=True)
        eligible_tickers = [s['ticker'] for s in sorted_scores[:max_positions]]
    
    eligible = [t for t in eligible_tickers if t in ticker_scores][:max_positions]
    
    if not eligible:
        return create_empty_portfolio(capital, max_weight, sector_cap, min_positions, max_positions)
    
    # Ensure at least min_positions
    if len(eligible) < min_positions and len(scores) >= min_positions:
        sorted_scores = sorted(scores, key=lambda x: x['rocket_score'], reverse=True)
        for s in sorted_scores:
            if s['ticker'] not in eligible:
                eligible.append(s['ticker'])
            if len(eligible) >= min_positions:
                break
    
    # Equal weight
    n = len(eligible)
    base_weight = 1.0 / n
    weights = {t: min(base_weight, max_weight) for t in eligible}
    
    # Apply sector caps
    sector_map = {}
    for t in eligible:
        sector = ticker_scores[t].get('sector') or 'Unknown'
        if sector not in sector_map:
            sector_map[sector] = []
        sector_map[sector].append(t)
    
    for sector, tickers in sector_map.items():
        sector_weight = sum(weights[t] for t in tickers)
        if sector_weight > sector_cap:
            scale = sector_cap / sector_weight
            for t in tickers:
                weights[t] *= scale
    
    # Normalize
    total = sum(weights.values())
    if total > 0:
        weights = {t: w / total for t, w in weights.items()}
    
    allocations = []
    for ticker in eligible:
        w = weights[ticker]
        if w > 0.001:
            allocations.append({
                'ticker': ticker,
                'weight': round(w, 4),
                'dollars': round(w * capital, 2),
                'sector': ticker_scores[ticker].get('sector') or 'Unknown',
                'rocket_score': ticker_scores[ticker].get('rocket_score', 0),
                'expected_return_proxy': round(ticker_scores[ticker].get('rocket_score', 50), 2)
            })
    
    allocations.sort(key=lambda x: x['weight'], reverse=True)
    
    # Limit positions
    if len(allocations) > max_positions:
        allocations = allocations[:max_positions]
        total = sum(a['weight'] for a in allocations)
        for a in allocations:
            a['weight'] = round(a['weight'] / total, 4)
            a['dollars'] = round(a['weight'] * capital, 2)
    
    sector_weights = {}
    for a in allocations:
        sector_weights[a['sector']] = sector_weights.get(a['sector'], 0) + a['weight']
    
    sector_breakdown = [{'sector': s, 'weight': round(w, 4)} for s, w in sorted(sector_weights.items(), key=lambda x: x[1], reverse=True)]
    
    return {
        'capital': capital,
        'constraints': {'max_weight': max_weight, 'sector_cap': sector_cap, 'min_positions': min_positions, 'max_positions': max_positions},
        'optimization_params': {'method': 'fallback_equal_weight'},
        'allocations': allocations,
        'sector_breakdown': sector_breakdown,
        'summary': {
            'positions': len(allocations),
            'cash_weight': round(1.0 - sum(a['weight'] for a in allocations), 4),
            'avg_rocket_score': round(np.mean([a['rocket_score'] for a in allocations]), 2) if allocations else 0
        },
        'backtest': None,
        'methodology': {'optimizer': 'Fallback (equal-weight)', 'constraints': [f'positions: {min_positions}-{max_positions}']}
    }


def compute_backtest(allocations, tickers, returns, capital):
    """Compute simplified backtest metrics."""
    if returns.empty:
        return None
    
    try:
        # Get weights
        weights = {a['ticker']: a['weight'] for a in allocations}
        
        # Filter to available tickers
        available = [t for t in weights.keys() if t in returns.columns]
        if len(available) < 3:
            return None
        
        # Portfolio returns
        portfolio_weights = np.array([weights.get(t, 0) for t in available])
        portfolio_weights = portfolio_weights / portfolio_weights.sum()
        
        portfolio_returns = (returns[available] * portfolio_weights).sum(axis=1)
        
        # Equal weight returns
        equal_weights = np.ones(len(available)) / len(available)
        equal_returns = (returns[available] * equal_weights).sum(axis=1)
        
        # Cumulative returns
        portfolio_cum = (1 + portfolio_returns).cumprod()
        equal_cum = (1 + equal_returns).cumprod()
        
        # SPY benchmark (if available)
        spy_cum = None
        try:
            import yfinance as yf
            spy = yf.download('SPY', start=returns.index[0], end=returns.index[-1], progress=False)
            if len(spy) > 0:
                spy_returns = spy['Close'].pct_change().dropna()
                spy_returns = spy_returns.reindex(returns.index).fillna(0)
                spy_cum = (1 + spy_returns).cumprod()
        except:
            pass
        
        # Metrics
        portfolio_total_return = (portfolio_cum.iloc[-1] - 1) * 100
        portfolio_vol = portfolio_returns.std() * np.sqrt(252) * 100
        portfolio_sharpe = (portfolio_returns.mean() * 252) / (portfolio_returns.std() * np.sqrt(252)) if portfolio_returns.std() > 0 else 0
        
        # Max drawdown
        rolling_max = portfolio_cum.expanding().max()
        drawdowns = (portfolio_cum - rolling_max) / rolling_max
        max_drawdown = drawdowns.min() * 100
        
        return {
            'total_return_pct': round(portfolio_total_return, 2),
            'annualized_vol_pct': round(portfolio_vol, 2),
            'sharpe_ratio': round(portfolio_sharpe, 2),
            'max_drawdown_pct': round(max_drawdown, 2),
            'series': {
                'dates': [d.strftime('%Y-%m-%d') for d in portfolio_cum.index],
                'optimized': [round(v, 4) for v in portfolio_cum.values],
                'equal_weight': [round(v, 4) for v in equal_cum.values],
                'spy': [round(v, 4) for v in spy_cum.values] if spy_cum is not None else None
            }
        }
    except Exception as e:
        print(f"Backtest error: {e}")
        return None


def create_empty_portfolio(capital, max_weight, sector_cap, min_positions, max_positions):
    """Return empty portfolio when no eligible tickers."""
    return {
        'capital': capital,
        'constraints': {'max_weight': max_weight, 'sector_cap': sector_cap, 'min_positions': min_positions, 'max_positions': max_positions},
        'allocations': [],
        'sector_breakdown': [],
        'summary': {'positions': 0, 'cash_weight': 1.0, 'avg_rocket_score': 0},
        'backtest': None
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('run_id', help='Run ID')
    parser.add_argument('--capital', type=float, default=10000)
    parser.add_argument('--max-weight', type=float, default=0.12)
    parser.add_argument('--sector-cap', type=float, default=0.35)
    parser.add_argument('--min-positions', type=int, default=8)
    parser.add_argument('--max-positions', type=int, default=25)
    parser.add_argument('--risk-lambda', type=float, default=1.0)
    parser.add_argument('--l1-lambda', type=float, default=0.01)
    args = parser.parse_args()
    
    print(f"Optimizing portfolio for run {args.run_id}...")
    print(f"Constraints: {args.min_positions}-{args.max_positions} positions, max weight {args.max_weight*100}%")
    
    portfolio = optimize_portfolio(
        args.run_id,
        capital=args.capital,
        max_weight=args.max_weight,
        sector_cap=args.sector_cap,
        min_positions=args.min_positions,
        max_positions=args.max_positions,
        risk_lambda=args.risk_lambda,
        l1_lambda=args.l1_lambda
    )
    
    # Write portfolio.json
    output_path = os.path.join('runs', args.run_id, 'portfolio.json')
    with open(output_path, 'w') as f:
        json.dump(portfolio, f, indent=2)
    
    print(f"Portfolio written: {len(portfolio['allocations'])} positions")
    print(f"Output: {output_path}")
    
    # Print summary
    if portfolio['allocations']:
        print(f"\nTop 5 allocations:")
        for a in portfolio['allocations'][:5]:
            print(f"  {a['ticker']}: {a['weight']*100:.1f}% (${a['dollars']:.0f})")


if __name__ == '__main__':
    main()
