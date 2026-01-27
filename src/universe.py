"""Stock universe management and ticker fetching."""
import pandas as pd
import yfinance as yf
from typing import List
import time
import httpx
from io import StringIO
import os


# Hardcoded MAG7 stocks to exclude
MAG7 = ["AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "NVDA", "META", "TSLA"]


def get_sp500_tickers() -> List[str]:
    """
    Fetch S&P 500 tickers from Wikipedia with retry logic and fallback.
    
    Returns:
        List of ticker symbols (uppercase, dots replaced with dashes)
        
    Raises:
        RuntimeError: If all sources fail
    """
    url = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
    max_retries = 3
    
    # Try Wikipedia first
    for attempt in range(max_retries):
        try:
            # Use httpx with proper headers and timeout
            with httpx.Client(
                timeout=30.0,
                headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
                follow_redirects=True
            ) as client:
                response = client.get(url)
                response.raise_for_status()
                
                # CRITICAL FIX: Use .text (string) not .content (bytes)
                # pandas.read_html expects text via StringIO, not raw bytes
                html_text = response.text
                
                # Parse HTML using StringIO to pass text to pandas
                tables = pd.read_html(StringIO(html_text))
                
                if not tables or len(tables) == 0:
                    raise RuntimeError("No tables found in Wikipedia HTML")
                
                sp500_table = tables[0]
                
                # Validate table structure
                if "Symbol" not in sp500_table.columns:
                    raise RuntimeError(f"Wikipedia table structure changed. Expected 'Symbol' column, got: {list(sp500_table.columns)}")
                
                # Extract and clean tickers
                tickers = sp500_table['Symbol'].astype(str).str.strip().str.upper().tolist()
                
                # Replace dots with dashes for yfinance compatibility (BRK.B -> BRK-B)
                tickers = [t.replace('.', '-') for t in tickers]
                
                # Remove empty strings and de-duplicate while preserving order
                tickers = list(dict.fromkeys([t for t in tickers if t]))
                
                if len(tickers) < 450:
                    raise RuntimeError(f"Too few tickers extracted: {len(tickers)} (expected ~500)")
                
                print(f"[OK] Fetched {len(tickers)} S&P 500 tickers from Wikipedia")
                return tickers
                
        except Exception as e:
            if attempt < max_retries - 1:
                wait_time = 2 ** attempt  # Exponential backoff: 1s, 2s, 4s
                print(f"[WARN] Attempt {attempt + 1} failed: {e}. Retrying in {wait_time}s...")
                time.sleep(wait_time)
            else:
                print(f"[ERROR] Wikipedia fetch failed after {max_retries} attempts: {e}")
                # Fall through to fallback
    
    # Fallback: Load from local CSV file
    try:
        # Try multiple possible paths for the fallback file
        fallback_paths = [
            os.path.join(os.path.dirname(__file__), "..", "backend", "data", "sp500_fallback.csv"),
            os.path.join(os.path.dirname(os.path.dirname(__file__)), "backend", "data", "sp500_fallback.csv"),
            "backend/data/sp500_fallback.csv",
            "data/sp500_fallback.csv"
        ]
        
        fallback_path = None
        for path in fallback_paths:
            if os.path.exists(path):
                fallback_path = path
                break
        
        if not fallback_path:
            raise FileNotFoundError("Fallback CSV not found in any expected location")
        
        # Read fallback CSV
        df = pd.read_csv(fallback_path)
        
        # Handle different CSV formats (ticker column or single column)
        if "ticker" in df.columns:
            tickers = df["ticker"].astype(str).str.strip().str.upper().tolist()
        elif "Symbol" in df.columns:
            tickers = df["Symbol"].astype(str).str.strip().str.upper().tolist()
        elif len(df.columns) == 1:
            # Single column CSV
            tickers = df.iloc[:, 0].astype(str).str.strip().str.upper().tolist()
        else:
            raise RuntimeError(f"Fallback CSV format not recognized. Columns: {list(df.columns)}")
        
        # Clean and validate
        tickers = [t.replace('.', '-') for t in tickers if t]
        tickers = list(dict.fromkeys([t for t in tickers if t]))
        
        if len(tickers) < 450:
            raise RuntimeError(f"Fallback CSV has too few tickers: {len(tickers)}")
        
        print(f"[OK] Loaded {len(tickers)} S&P 500 tickers from fallback CSV: {fallback_path}")
        return tickers
        
    except Exception as e:
        error_msg = f"All S&P 500 ticker sources failed. Wikipedia: failed after retries. Fallback CSV: {e}"
        print(f"[ERROR] {error_msg}")
        raise RuntimeError(error_msg)


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
