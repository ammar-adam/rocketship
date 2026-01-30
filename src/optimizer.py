"""
Portfolio Optimizer using CVXPY
===============================
Implements convex optimization with:
- Expected return proxy (RocketScore)
- Risk penalty (covariance-based)
- Hard constraints (max weight, sector caps)

OUTPUT: Exactly the final buy list (no additions).
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
    
    # Try batch download first (more efficient)
    try:
        data = yf.download(
            tickers, 
            start=start_date, 
            end=end_date, 
            progress=False,
            auto_adjust=True,
            threads=True
        )
        
        if data.empty:
            return pd.DataFrame()
        
        # Handle multi-ticker format (MultiIndex columns) vs single ticker
        if isinstance(data.columns, pd.MultiIndex):
            # Multi-ticker: columns are ('Close', 'AAPL'), ('Close', 'MSFT'), etc.
            closes = data['Close'] if 'Close' in data.columns.get_level_values(0) else data
        else:
            # Single ticker: columns are 'Close', 'Open', etc.
            closes = data[['Close']].rename(columns={'Close': tickers[0]}) if len(tickers) == 1 else data
        
        # Ensure we have enough data
        if len(closes) < lookback_days // 2:
            return pd.DataFrame()
        
        # Filter to tickers with sufficient data
        valid_tickers = [t for t in tickers if t in closes.columns and closes[t].notna().sum() >= lookback_days // 2]
        if not valid_tickers:
            return pd.DataFrame()
        
        closes = closes[valid_tickers]
        returns = closes.pct_change().dropna()
        return returns
        
    except Exception as e:
        print(f"Batch download failed: {e}, trying individual downloads...")
    
    # Fallback to individual downloads
    prices = {}
    for ticker in tickers:
        try:
            data = yf.download(ticker, start=start_date, end=end_date, progress=False, auto_adjust=True)
            if isinstance(data, pd.DataFrame) and 'Close' in data.columns and len(data) >= lookback_days // 2:
                prices[ticker] = data['Close']
        except Exception as e:
            print(f"Warning: Could not fetch {ticker}: {e}")
    
    if not prices:
        return pd.DataFrame()
    
    # Build DataFrame from Series dict - ensure all are indexed properly
    # Filter out any scalars
    valid_prices = {k: v for k, v in prices.items() if isinstance(v, pd.Series) and len(v) > 0}
    if not valid_prices:
        return pd.DataFrame()
    
    df = pd.DataFrame(valid_prices)
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
    run_dir: Optional[str] = None,
    scores_data: Optional[List[Dict]] = None,
    final_buys_data: Optional[Dict] = None,
) -> Dict[str, Any]:
    """
    Optimize portfolio using CVXPY.
    
    run_dir: optional path to run directory (e.g. /data/runs/run_id). If None, uses runs/run_id relative to cwd.
    scores_data: optional pre-loaded rocket_scores list (bypasses disk read).
    final_buys_data: optional pre-loaded final_buys dict with 'items' key (bypasses disk read).
    
    Objective:
        Maximize: (w · expected_return_proxy) - risk_lambda * (w'Σw)
    
    Constraints:
        - sum(w) <= 1 (cash allowed if max_weight limits apply)
        - min_weight <= w_i <= max_weight
        - sector weights <= sector_cap
        - Result includes all final buys (no additions)
    """
    try:
        import cvxpy as cp
    except ImportError:
        print("CVXPY not installed. Using fallback optimization.")
        return optimize_fallback(run_id, capital, max_weight, sector_cap, min_positions, max_positions, run_dir, scores_data, final_buys_data)
    
    # Load scores: use pre-loaded data if provided, else read from disk
    if scores_data is not None and len(scores_data) > 0:
        scores = scores_data
        print(f"[Optimizer] Using pre-loaded scores_data ({len(scores_data)} items)")
    else:
        # Must read from disk - ensure absolute path
        if run_dir is None:
            run_dir = os.path.abspath(os.path.join(os.getcwd(), 'runs', run_id))
        else:
            run_dir = os.path.abspath(run_dir)
        scores_path = os.path.join(run_dir, 'rocket_scores.json')
        print(f"[Optimizer] Reading scores from disk: {scores_path}")
        if not os.path.exists(scores_path):
            raise FileNotFoundError(f"rocket_scores.json not found: {scores_path}")
        with open(scores_path, 'r') as f:
            scores = json.load(f)
    
    # Build ticker -> score map
    ticker_scores = {s['ticker']: s for s in scores} if isinstance(scores, list) else {}
    if isinstance(scores, list) and not ticker_scores:
        ticker_scores = {s.get('ticker'): s for s in scores if s.get('ticker')}
    
    # Load final_buys: use pre-loaded if provided, else read from disk
    if final_buys_data is not None and isinstance(final_buys_data, dict):
        final_buys = final_buys_data
        print(f"[Optimizer] Using pre-loaded final_buys_data ({len(final_buys.get('items', []))} items)")
    else:
        if run_dir is None:
            run_dir = os.path.abspath(os.path.join(os.getcwd(), 'runs', run_id))
        final_buys_path = os.path.join(run_dir, 'final_buys.json')
        print(f"[Optimizer] Reading final_buys from disk: {final_buys_path}")
        if not os.path.exists(final_buys_path):
            return create_empty_portfolio(capital, max_weight, sector_cap, min_positions, max_positions)
        with open(final_buys_path, 'r') as f:
            final_buys = json.load(f)
    
    eligible_tickers = [item['ticker'] for item in final_buys.get('items', []) if item.get('ticker')]
    
    # Filter to valid tickers
    eligible = [t for t in eligible_tickers if t in ticker_scores]
    
    if len(eligible) == 0:
        return create_empty_portfolio(capital, max_weight, sector_cap, min_positions, max_positions)
    
    # Enforce exact position count based on final buys
    n = len(eligible)
    min_positions = n
    max_positions = n
    print(f"Optimizing over {n} final buys...")
    
    # Expected return proxy (RocketScore)
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
    expected_return_term = rocket_proxy @ w
    risk_term = risk_lambda * cp.quad_form(w, cov_matrix)
    
    objective = cp.Maximize(expected_return_term - risk_term)
    
    # Constraints
    min_weight = min(0.01, 1.0 / n / 2)
    constraints = [
        cp.sum(w) <= 1,
        w >= min_weight,
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
        return optimize_fallback(run_id, capital, max_weight, sector_cap, min_positions, max_positions, run_dir, scores_data, final_buys_data)
    
    weights = np.maximum(w.value, 0)
    if np.sum(weights) > 1:
        weights = weights / np.sum(weights)
    
    # Build allocations
    allocations = []
    for i, ticker in enumerate(eligible):
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
    
    # Ensure allocations sum does not exceed 1.0
    total_weight = sum(a['weight'] for a in allocations)
    if total_weight > 1:
        for a in allocations:
            a['weight'] = round(a['weight'] / total_weight, 4)
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
            'risk_lambda': risk_lambda
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
            'objective': 'Maximize(expected_return_proxy - risk_penalty)',
            'constraints': ['sum(w)<=1', f'w>={min(0.01, 1.0 / n / 2):.3f}', f'w<={max_weight}', f'sector<={sector_cap}', f'positions: {min_positions}']
        }
    }
    
    return portfolio


def optimize_fallback(run_id, capital, max_weight, sector_cap, min_positions, max_positions, run_dir=None, scores_data=None, final_buys_data=None):
    """Fallback to constrained equal-weight when CVXPY fails."""
    print(f"[Optimizer Fallback] Starting for run {run_id}")
    if run_dir is None:
        run_dir = os.path.abspath(os.path.join(os.getcwd(), 'runs', run_id))
    else:
        run_dir = os.path.abspath(run_dir)

    if scores_data is not None and len(scores_data) > 0:
        scores = scores_data
        ticker_scores = {s['ticker']: s for s in scores} if isinstance(scores, list) else {}
        print(f"[Optimizer Fallback] Using pre-loaded scores ({len(scores_data)} items)")
    else:
        scores_path = os.path.join(run_dir, 'rocket_scores.json')
        print(f"[Optimizer Fallback] Reading scores from: {scores_path}")
        if not os.path.exists(scores_path):
            raise FileNotFoundError(f"rocket_scores.json not found: {scores_path}")
        with open(scores_path, 'r') as f:
            scores = json.load(f)
        ticker_scores = {s['ticker']: s for s in scores}

    if final_buys_data is not None and isinstance(final_buys_data, dict):
        final_buys = final_buys_data
        print(f"[Optimizer Fallback] Using pre-loaded final_buys ({len(final_buys.get('items', []))} items)")
    else:
        final_buys_path = os.path.join(run_dir, 'final_buys.json')
        print(f"[Optimizer Fallback] Reading final_buys from: {final_buys_path}")
        if not os.path.exists(final_buys_path):
            return create_empty_portfolio(capital, max_weight, sector_cap, min_positions, max_positions)
        with open(final_buys_path, 'r') as f:
            final_buys = json.load(f)
    
    eligible = [item['ticker'] for item in final_buys.get('items', []) if item.get('ticker') and item['ticker'] in ticker_scores]
    
    if not eligible:
        return create_empty_portfolio(capital, max_weight, sector_cap, min_positions, max_positions)

    min_positions = len(eligible)
    max_positions = len(eligible)
    
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
    
    # Normalize only if we exceed 1.0
    total = sum(weights.values())
    if total > 1:
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
        'methodology': {'optimizer': 'Fallback (equal-weight)', 'constraints': [f'positions: {len(allocations)}', f'max_weight: {max_weight}', f'sector_cap: {sector_cap}']}
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
                'optimized': [round(float(v.item()) if hasattr(v, 'item') else float(v), 4) for v in portfolio_cum.values],
                'equal_weight': [round(float(v.item()) if hasattr(v, 'item') else float(v), 4) for v in equal_cum.values],
                'spy': [round(float(v.item()) if hasattr(v, 'item') else float(v), 4) for v in spy_cum.values] if spy_cum is not None else None
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
    args = parser.parse_args()
    
    print(f"Optimizing portfolio for run {args.run_id}...")
    print(f"Constraints: max weight {args.max_weight*100}%, sector cap {args.sector_cap*100}%")
    
    portfolio = optimize_portfolio(
        args.run_id,
        capital=args.capital,
        max_weight=args.max_weight,
        sector_cap=args.sector_cap,
        min_positions=args.min_positions,
        max_positions=args.max_positions,
        risk_lambda=args.risk_lambda
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
