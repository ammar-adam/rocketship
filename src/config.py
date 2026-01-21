"""Configuration management using pydantic-settings."""
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # API Configuration
    deepseek_api_key: str
    deepseek_base_url: str = "https://api.deepseek.com/v1"
    
    # Universe Configuration
    universe: str = "SP500_EX_MAG7"
    lookback_days: int = 252
    top_n_candidates: int = 25
    
    # Technical Indicators
    momentum_short: int = 20
    momentum_long: int = 60
    volume_short: int = 10
    volume_long: int = 60
    volatility_window: int = 20
    
    # Scoring Weights
    technical_weight: float = 0.6
    macro_weight: float = 0.4
    momentum_weight: float = 0.35
    volume_weight: float = 0.25
    trend_weight: float = 0.25
    quality_weight: float = 0.15
    
    # Portfolio Configuration
    portfolio_size: float = 10000.0
    min_position_pct: float = 0.05
    max_position_pct: float = 0.20
    
    # Agent Configuration
    agent_temperature: float = 0.5
    judge_temperature: float = 0.2
    
    class Config:
        env_file = ".env"


@lru_cache()
def get_config() -> Settings:
    """Get singleton configuration instance."""
    return Settings()
