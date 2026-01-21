interface StockCardProps {
  stock: {
    ticker: string;
    rocket_score: number;
    sector: string;
    macro_trends_matched?: Array<{ name: string }>;
    judge?: { verdict: "ENTER" | "WAIT" | "KILL" };
  };
}

export default function StockCard({ stock }: StockCardProps) {
  const verdictColor = stock.judge?.verdict === "ENTER" 
    ? "bg-verdict-enter" 
    : stock.judge?.verdict === "WAIT" 
    ? "bg-verdict-wait" 
    : stock.judge?.verdict === "KILL"
    ? "bg-verdict-kill"
    : "bg-muted";
  
  return (
    <a 
      href={`/stock/${stock.ticker}`}
      className="block p-4 border border-border rounded bg-white hover:border-accent transition-colors"
    >
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-lg font-semibold text-foreground">{stock.ticker}</h3>
        {stock.judge && (
          <span className={`text-xs px-2 py-1 rounded text-white ${verdictColor}`}>
            {stock.judge.verdict}
          </span>
        )}
      </div>
      
      <div className="mb-3">
        <div className="flex items-baseline gap-2 mb-1">
          <span className="text-2xl font-bold text-foreground">{stock.rocket_score.toFixed(1)}</span>
          <span className="text-sm text-muted">RocketScore</span>
        </div>
        <div className="h-2 bg-border rounded-full overflow-hidden">
          <div 
            className="h-full bg-accent" 
            style={{ width: `${stock.rocket_score}%` }}
          />
        </div>
      </div>
      
      <p className="text-sm text-muted mb-2">{stock.sector}</p>
      
      {stock.macro_trends_matched && stock.macro_trends_matched.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {stock.macro_trends_matched.slice(0, 2).map((trend, i) => (
            <span key={i} className="text-xs px-2 py-0.5 bg-background text-accent rounded">
              {trend.name.split(' ')[0]}
            </span>
          ))}
        </div>
      )}
    </a>
  );
}
