export interface StockAnalysis {
  ticker: string;
  rocket_score: number;
  technical_score: number;
  macro_score: number;
  breakdown: {
    momentum: number;
    volume: number;
    trend: number;
    quality: number;
  };
  macro_trends_matched: Array<{
    name: string;
    confidence: number;
    thesis: string;
  }>;
  current_price: number;
  sector: string;
  judge?: {
    verdict: "ENTER" | "WAIT" | "KILL";
    conviction: number;
    position_rationale: string[];
    risk_controls: {
      stop_loss: string;
      invalidation: string;
      max_position_size: string;
    };
  };
}

export interface Portfolio {
  positions: Array<{
    ticker: string;
    shares: number;
    price: number;
    position_value: number;
    weight: number;
    conviction: number;
    rocket_score: number;
  }>;
  total_allocated: number;
  cash_remaining: number;
  num_positions: number;
  avg_conviction: number;
}

export interface RunData {
  timestamp: string;
  top_25: StockAnalysis[];
  portfolio?: Portfolio;
}
