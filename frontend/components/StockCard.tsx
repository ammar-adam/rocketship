import Link from 'next/link';

interface StockCardProps {
  stock: any;
  runId: string;
}

export default function StockCard({ stock, runId }: StockCardProps) {
  const ticker = stock.ticker || stock.symbol || 'UNKNOWN';
  const rocketScore = stock.rocket_score ?? stock.rocketScore ?? 0;
  const verdict = stock.judge?.verdict || stock.verdict;
  const sector = stock.sector;
  const macroTrends = stock.macro_trends_matched || [];
  
  const verdictColor = verdict === "ENTER" 
    ? "bg-verdict-enter" 
    : verdict === "WAIT" 
    ? "bg-verdict-wait" 
    : verdict === "KILL"
    ? "bg-verdict-kill"
    : "bg-muted";
  
  return (
    <Link 
      href={`/run/${runId}/stock/${ticker}`}
      className="block p-4 border border-border rounded bg-white hover:border-accent transition-colors"
    >
      <div className="flex items-start justify-between mb-2">
        <h3 className="text-lg font-semibold text-foreground">{ticker}</h3>
        {verdict && (
          <span className={`text-xs px-2 py-1 rounded text-white ${verdictColor}`}>
            {verdict}
          </span>
        )}
      </div>
      
      {rocketScore > 0 && (
        <div className="mb-3">
          <div className="flex items-baseline gap-2 mb-1">
            <span className="text-2xl font-bold text-foreground">{rocketScore.toFixed(1)}</span>
            <span className="text-sm text-muted">RocketScore</span>
          </div>
          <div className="h-2 bg-border rounded-full overflow-hidden">
            <div 
              className="h-full bg-accent" 
              style={{ width: `${Math.min(rocketScore, 100)}%` }}
            />
          </div>
        </div>
      )}
      
      {sector && (
        <p className="text-sm text-muted mb-2">{sector}</p>
      )}
      
      {macroTrends.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {macroTrends.slice(0, 2).map((trend: any, i: number) => (
            <span key={i} className="text-xs px-2 py-0.5 bg-background text-accent rounded">
              {(trend.name || '').split(' ')[0]}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
