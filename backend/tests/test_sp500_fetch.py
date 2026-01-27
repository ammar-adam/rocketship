"""
Smoke test for S&P 500 ticker fetching.
Tests the fixed implementation to ensure it works correctly.
"""
import sys
import os

# Add repo root to path
repo_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, repo_root)

from src.universe import get_sp500_tickers


def test_sp500_fetch():
    """Test that S&P 500 ticker fetching works correctly."""
    print("=" * 60)
    print("S&P 500 Ticker Fetch Smoke Test")
    print("=" * 60)
    
    try:
        # Fetch tickers
        print("\n[1] Fetching S&P 500 tickers...")
        tickers = get_sp500_tickers()
        
        # Assertions
        print(f"\n[2] Validating results...")
        
        # Check length
        assert len(tickers) > 450, f"Expected >450 tickers, got {len(tickers)}"
        print(f"   [PASS] Length check passed: {len(tickers)} tickers")
        
        # Check AAPL is present
        assert "AAPL" in tickers, "AAPL not found in tickers"
        print(f"   [PASS] AAPL found in tickers")
        
        # Check BRK-B format conversion (if BRK.B exists in raw data)
        # Note: We check for BRK-B since we convert . to -
        if "BRK-B" in tickers:
            print(f"   [PASS] BRK-B format conversion works (BRK.B -> BRK-B)")
        else:
            # Check if BRK.B would have been converted
            print(f"   [INFO] BRK-B not in list (may not be in S&P 500 or already converted)")
        
        # Check all tickers are uppercase
        assert all(t == t.upper() for t in tickers), "Not all tickers are uppercase"
        print(f"   [PASS] All tickers are uppercase")
        
        # Check no dots in tickers (should be converted to dashes)
        assert not any('.' in t for t in tickers), "Found dots in tickers (should be converted to dashes)"
        print(f"   [PASS] No dots in tickers (all converted to dashes)")
        
        # Check no duplicates
        assert len(tickers) == len(set(tickers)), "Found duplicate tickers"
        print(f"   [PASS] No duplicates found")
        
        # Check no empty strings
        assert all(t.strip() for t in tickers), "Found empty tickers"
        print(f"   [PASS] No empty tickers")
        
        # Show sample
        print(f"\n[3] Sample tickers (first 10):")
        for i, ticker in enumerate(tickers[:10], 1):
            print(f"   {i:2d}. {ticker}")
        
        print(f"\n[4] Summary:")
        print(f"   Total tickers: {len(tickers)}")
        print(f"   Expected range: 490-510")
        status = "[PASS]" if 490 <= len(tickers) <= 510 else "[WARNING] (unusual count)"
        print(f"   Status: {status}")
        
        print("\n" + "=" * 60)
        print("[PASS] ALL TESTS PASSED")
        print("=" * 60)
        return True
        
    except Exception as e:
        print(f"\n[FAIL] TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = test_sp500_fetch()
    sys.exit(0 if success else 1)
