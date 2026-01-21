"""Stock universe management and ticker fetching."""
import pandas as pd
import yfinance as yf
from typing import List
import time
import urllib.request


# Hardcoded MAG7 stocks to exclude
MAG7 = ["AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "NVDA", "META", "TSLA"]


def get_sp500_tickers() -> List[str]:
    """
    Fetch S&P 500 tickers from Wikipedia with retry logic.
    
    Returns:
        List of ticker symbols
        
    Raises:
        Exception: If all retry attempts fail
    """
    url = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
    max_retries = 3
    
    for attempt in range(max_retries):
        try:
            # Add User-Agent header to avoid 403 errors
            req = urllib.request.Request(url)
            req.add_header('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36')
            
            # Open the URL and read the HTML
            with urllib.request.urlopen(req) as response:
                html = response.read()
            
            # Read the first table from Wikipedia HTML
            tables = pd.read_html(html)
            sp500_table = tables[0]
            
            # Extract ticker symbols from the 'Symbol' column
            tickers = sp500_table['Symbol'].tolist()
            
            # Clean up tickers (replace dots with dashes for Yahoo Finance compatibility)
            tickers = [ticker.replace('.', '-') for ticker in tickers]
            
            print(f"[OK] Fetched {len(tickers)} S&P 500 tickers")
            return tickers
            
        except Exception as e:
            if attempt < max_retries - 1:
                wait_time = 2 ** attempt  # Exponential backoff: 1s, 2s, 4s
                print(f"[WARN] Attempt {attempt + 1} failed: {e}. Retrying in {wait_time}s...")
                time.sleep(wait_time)
            else:
                print(f"[ERROR] Failed to fetch S&P 500 tickers after {max_retries} attempts")
                raise Exception(f"Failed to fetch S&P 500 tickers: {e}")


def get_universe() -> List[str]:
    """
    Get the stock universe: S&P 500 minus MAG7.
    
    Returns:
        List of ticker symbols (~493 stocks)
    """
    sp500 = get_sp500_tickers()
    
    # Remove MAG7 stocks
    universe = [ticker for ticker in sp500 if ticker not in MAG7]
    
    print(f"[OK] Universe created: {len(universe)} stocks (S&P 500 minus MAG7)")
    print(f"  Excluded MAG7: {', '.join(MAG7)}")
    
    return universe


def get_sector(ticker: str) -> str:
    """
    Get the sector for a given ticker using yfinance.
    
    Args:
        ticker: Stock ticker symbol
        
    Returns:
        Sector name or "Unknown" if not available
    """
    try:
        stock = yf.Ticker(ticker)
        info = stock.info
        sector = info.get("sector", "Unknown")
        return sector
        
    except Exception as e:
        print(f"[WARN] Failed to fetch sector for {ticker}: {e}")
        return "Unknown"


if __name__ == "__main__":
    """Test the universe module."""
    print("Testing Universe Module")
    print("=" * 50)
    
    # Test get_universe
    print("\n1. Testing get_universe():")
    universe = get_universe()
    print(f"   Total stocks in universe: {len(universe)}")
    print(f"   First 10 tickers: {universe[:10]}")
    
    # Test get_sector with a few examples
    print("\n2. Testing get_sector():")
    test_tickers = ["AAPL", "JPM", "XOM", "INVALID_TICKER"]
    for ticker in test_tickers:
        sector = get_sector(ticker)
        print(f"   {ticker}: {sector}")
    
    print("\n" + "=" * 50)
    print("[OK] All tests completed!")
