"""Facts pack builder for agent consumption."""
import pandas as pd


def build_facts_pack(ticker: str, df: pd.DataFrame, signals: dict, rocket_score_data: dict, sector: str) -> dict:
    """
    Build compact facts pack (<300 tokens) for agent consumption.
    
    Args:
        ticker: Stock ticker symbol
        df: DataFrame with OHLCV data
        signals: Dictionary of technical signals
        rocket_score_data: RocketScore breakdown
        sector: Stock sector
        
    Returns:
        Dictionary with essential stock information for agent analysis
    """
    return {
        "ticker": ticker,
        "sector": sector,
        "current_price": float(df['Close'].iloc[-1]),
        "date": df.index[-1].strftime("%Y-%m-%d"),
        "rocket_score": rocket_score_data["rocket_score"],
        "rocket_score_breakdown": {
            "technical": rocket_score_data["technical_score"],
            "macro": rocket_score_data["macro_score"],
            "momentum": rocket_score_data["breakdown"]["momentum"],
            "volume": rocket_score_data["breakdown"]["volume"],
            "trend": rocket_score_data["breakdown"]["trend"],
            "quality": rocket_score_data["breakdown"]["quality"]
        },
        "macro_trends_matched": rocket_score_data["macro_trends_matched"],
        "signals": {
            "price_change_20d": round(signals["mom_20d"] * 100, 2),  # as percentage
            "price_change_60d": round(signals["mom_60d"] * 100, 2),
            "acceleration": round(signals["acceleration"] * 100, 2),
            "volume_surge": round(signals["vol_surge"], 2),
            "volatility_20d": round(signals["volatility"] * 100, 2),
            "52w_high": float(df['Close'].rolling(252).max().iloc[-1]),
            "52w_low": float(df['Close'].rolling(252).min().iloc[-1]),
            "distance_from_52w_high": round(signals["distance_from_52w_high"] * 100, 2),
            "above_sma50": signals["above_sma50"],
            "above_sma200": signals["above_sma200"]
        }
    }
