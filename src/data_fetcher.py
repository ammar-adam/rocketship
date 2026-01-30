"""Data fetching module with caching and retry logic."""
import os
import pandas as pd
import yfinance as yf
from datetime import datetime, timedelta
from typing import Optional
import time
import signal
import threading
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FuturesTimeoutError

# Rich is optional - only used in interactive mode
try:
    from rich.progress import track
    HAS_RICH = True
except ImportError:
    HAS_RICH = False
    # Fallback: simple iteration without progress bar
    def track(iterable, description=""):
        return iterable

# Track request timing for rate limiting
_last_request_time = 0
_request_lock = threading.Lock()
_MIN_REQUEST_INTERVAL = 0.1  # 100ms between requests to avoid rate limiting


def _download_with_timeout(ticker: str, lookback_days: int, timeout: int = 30) -> Optional[pd.DataFrame]:
    """Download data with a hard timeout using ThreadPoolExecutor."""
    def _do_download():
        return yf.download(
            ticker,
            period=f"{lookback_days}d",
            auto_adjust=False,
            progress=False,
            timeout=15  # yfinance internal timeout
        )

    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(_do_download)
        try:
            return future.result(timeout=timeout)
        except FuturesTimeoutError:
            print(f"[WARN] Timeout fetching {ticker} after {timeout}s")
            return None
        except Exception as e:
            print(f"[WARN] Error fetching {ticker}: {e}")
            return None


def fetch_ohlcv(ticker: str, lookback_days: int = 252) -> Optional[pd.DataFrame]:
    """
    Fetch OHLCV data for a ticker with caching support.
    
    Args:
        ticker: Stock ticker symbol
        lookback_days: Number of days of historical data to fetch
        
    Returns:
        DataFrame with OHLCV data, or None if fetch fails
        
    The function caches data to cache/{ticker}_{date}.pkl and reuses it
    if the cache file is less than 1 day old.
    """
    # Create cache directory if it doesn't exist
    os.makedirs("cache", exist_ok=True)
    
    # Generate cache filename with today's date and lookback period
    today = datetime.now().strftime("%Y-%m-%d")
    cache_file = f"cache/{ticker}_{lookback_days}d_{today}.pkl"
    
    # Check if cache exists and is fresh (< 1 day old)
    if os.path.exists(cache_file):
        file_modified = datetime.fromtimestamp(os.path.getmtime(cache_file))
        if datetime.now() - file_modified < timedelta(days=1):
            try:
                df = pd.read_pickle(cache_file)
                return df
            except Exception as e:
                print(f"[WARN] Failed to load cache for {ticker}: {e}")
    
    # Rate limiting - ensure minimum interval between requests
    global _last_request_time
    with _request_lock:
        now = time.time()
        elapsed = now - _last_request_time
        if elapsed < _MIN_REQUEST_INTERVAL:
            time.sleep(_MIN_REQUEST_INTERVAL - elapsed)
        _last_request_time = time.time()

    # Fetch data with retry logic and hard timeout
    max_retries = 3

    for attempt in range(max_retries):
        try:
            # Use timeout wrapper to prevent hanging
            df = _download_with_timeout(ticker, lookback_days, timeout=30)

            # Check if data is valid
            if df is None or df.empty:
                raise ValueError(f"No data returned for {ticker}")

            # Flatten multi-level columns if present
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = [col[0] for col in df.columns]

            # Validate minimum data points
            if len(df) < 60:
                raise ValueError(f"Insufficient data points: {len(df)} (need at least 60)")

            # Save to cache
            df.to_pickle(cache_file)
            return df

        except Exception as e:
            error_msg = str(e)
            # Clean error message - truncate if too long
            if len(error_msg) > 200:
                error_msg = error_msg[:200] + "..."

            if attempt < max_retries - 1:
                # Exponential backoff with jitter: 1-2s, 2-4s, 4-8s
                wait_time = (2 ** attempt) + (time.time() % 1)
                print(f"[WARN] Attempt {attempt + 1} failed for {ticker}: {error_msg}. Retrying in {wait_time:.1f}s...")
                time.sleep(wait_time)
            else:
                print(f"[WARN] Failed to fetch data for {ticker} after {max_retries} attempts: {error_msg}")
                return None


def fetch_multiple(tickers: list[str], lookback_days: int = 252) -> dict[str, pd.DataFrame]:
    """
    Fetch OHLCV data for multiple tickers with progress bar.
    
    Args:
        tickers: List of stock ticker symbols
        lookback_days: Number of days of historical data to fetch
        
    Returns:
        Dictionary mapping ticker symbols to DataFrames for successful fetches only
        
    Failed fetches are skipped and not included in the returned dictionary.
    """
    results = {}
    
    for ticker in track(tickers, description="Fetching market data..."):
        df = fetch_ohlcv(ticker, lookback_days)
        if df is not None:
            results[ticker] = df
    
    return results


if __name__ == "__main__":
    """Test the data fetcher module."""
    print("Testing Data Fetcher Module")
    print("=" * 50)
    
    # Test single fetch
    print("\n1. Testing fetch_ohlcv() for AAPL:")
    df = fetch_ohlcv("AAPL", lookback_days=90)
    if df is not None:
        print(f"   [OK] Fetched {len(df)} rows")
        print(f"   Columns: {list(df.columns)}")
        print(f"   Date range: {df.index[0]} to {df.index[-1]}")
    else:
        print("   [ERROR] Failed to fetch data")
    
    # Test cache
    print("\n2. Testing cache (fetch AAPL again):")
    df2 = fetch_ohlcv("AAPL", lookback_days=90)
    if df2 is not None:
        print(f"   [OK] Fetched from cache: {len(df2)} rows")
    
    # Test multiple fetch
    print("\n3. Testing fetch_multiple():")
    test_tickers = ["MSFT", "GOOGL", "JPM"]
    data = fetch_multiple(test_tickers, lookback_days=90)
    print(f"   [OK] Fetched {len(data)}/{len(test_tickers)} tickers")
    for ticker, df in data.items():
        print(f"   {ticker}: {len(df)} rows")
    
    print("\n" + "=" * 50)
    print("[OK] All tests completed!")
