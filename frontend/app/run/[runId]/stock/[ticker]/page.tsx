import Link from 'next/link';
import { readStock, getRuns } from '@/src/lib/runStore';

interface PageProps {
  params: Promise<{
    runId: string;
    ticker: string;
  }>;
}

export default async function StockDetailPage({ params }: PageProps) {
  const { runId, ticker } = await params;
  
  // Validate run exists
  const runs = getRuns();
  if (!runs.includes(runId)) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b border-border bg-white">
          <div className="max-w-7xl mx-auto px-6 py-4">
            <Link href="/" className="text-sm text-accent hover:text-accent-dark">
              ← Back to Dashboard
            </Link>
          </div>
        </header>
        <main className="max-w-4xl mx-auto px-6 py-12">
          <div className="text-center">
            <h1 className="text-2xl font-semibold text-foreground mb-2">Run Not Found</h1>
            <p className="text-muted">Run ID: {runId}</p>
          </div>
        </main>
      </div>
    );
  }

  // Get stock data (case-insensitive)
  const stock = readStock(runId, ticker);
  
  if (stock.source === 'missing' || !stock.data) {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b border-border bg-white">
          <div className="max-w-7xl mx-auto px-6 py-4">
            <Link href="/" className="text-sm text-accent hover:text-accent-dark">
              ← Back to Dashboard
            </Link>
          </div>
        </header>
        <main className="max-w-4xl mx-auto px-6 py-12">
          <div className="text-center">
            <h1 className="text-2xl font-semibold text-foreground mb-2">
              No data for {ticker.toUpperCase()} in this run
            </h1>
            <p className="text-muted mb-4">Run: {runId}</p>
            <Link 
              href="/" 
              className="inline-block px-4 py-2 bg-accent text-white rounded hover:bg-accent-dark transition-colors"
            >
              Return to Dashboard
            </Link>
          </div>
        </main>
      </div>
    );
  }

  const data = stock.data;
  const rocketScore = data.rocket_score ?? data.rocketScore ?? 0;
  const verdict = data.judge?.verdict || data.verdict;
  const sector = data.sector;

  const verdictColor = verdict === "ENTER" 
    ? "text-verdict-enter" 
    : verdict === "WAIT" 
    ? "text-verdict-wait" 
    : verdict === "KILL"
    ? "text-verdict-kill"
    : "text-muted";

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-white">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <Link href="/" className="text-sm text-accent hover:text-accent-dark">
            ← Back to Dashboard
          </Link>
        </div>
      </header>
      
      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="text-3xl font-semibold text-foreground mb-2">
                {stock.ticker}
              </h1>
              {sector && (
                <p className="text-muted">{sector}</p>
              )}
            </div>
            {verdict && (
              <div className={`text-xl font-semibold ${verdictColor}`}>
                {verdict}
              </div>
            )}
          </div>
          
          {rocketScore > 0 && (
            <div className="mb-4">
              <div className="flex items-baseline gap-3 mb-2">
                <span className="text-4xl font-bold text-foreground">
                  {rocketScore.toFixed(1)}
                </span>
                <span className="text-lg text-muted">RocketScore</span>
              </div>
              <div className="h-3 bg-border rounded-full overflow-hidden max-w-md">
                <div 
                  className="h-full bg-accent" 
                  style={{ width: `${Math.min(rocketScore, 100)}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Developer Diagnostics */}
        <div className="mb-6 p-4 bg-white border border-border rounded">
          <h3 className="text-sm font-semibold text-foreground mb-2">Developer Diagnostics</h3>
          <div className="text-sm space-y-1">
            <p className="text-muted">
              <span className="font-medium">Source:</span> {stock.source}
            </p>
            {stock.loadedPath && (
              <p className="text-muted break-all">
                <span className="font-medium">Path:</span> {stock.loadedPath.replace(/\\/g, '/')}
              </p>
            )}
            {stock.keys && (
              <p className="text-muted">
                <span className="font-medium">Keys:</span> {stock.keys.join(', ')}
              </p>
            )}
          </div>
        </div>

        {/* Data Display */}
        <div className="border border-border rounded bg-white p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">Analysis Data</h2>
          
          {/* Score Breakdown */}
          {data.breakdown && (
            <div className="mb-6">
              <h3 className="font-medium text-foreground mb-2">Score Breakdown</h3>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {Object.entries(data.breakdown).map(([key, value]) => (
                  <div key={key} className="flex justify-between">
                    <span className="text-muted capitalize">{key}:</span>
                    <span className="font-medium text-foreground">{String(value)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Judge Analysis */}
          {data.judge && (
            <div className="mb-6">
              <h3 className="font-medium text-foreground mb-2">Judge Analysis</h3>
              <div className="space-y-2 text-sm">
                {data.judge.conviction !== undefined && (
                  <p className="text-muted">
                    <span className="font-medium">Conviction:</span> {data.judge.conviction}%
                  </p>
                )}
                {data.judge.position_rationale && Array.isArray(data.judge.position_rationale) && (
                  <div>
                    <p className="font-medium text-foreground mb-1">Rationale:</p>
                    <ul className="list-disc list-inside space-y-1 text-muted">
                      {data.judge.position_rationale.map((item: string, i: number) => (
                        <li key={i}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Macro Trends */}
          {data.macro_trends_matched && Array.isArray(data.macro_trends_matched) && data.macro_trends_matched.length > 0 && (
            <div className="mb-6">
              <h3 className="font-medium text-foreground mb-2">Macro Trends</h3>
              <div className="space-y-2">
                {data.macro_trends_matched.map((trend: any, i: number) => (
                  <div key={i} className="text-sm">
                    <p className="font-medium text-foreground">{trend.name}</p>
                    <p className="text-muted text-xs">{trend.thesis}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Raw JSON */}
          <details className="mt-6">
            <summary className="cursor-pointer text-sm font-medium text-accent hover:text-accent-dark">
              View Raw JSON
            </summary>
            <pre className="mt-2 p-3 bg-background rounded text-xs overflow-auto max-h-96">
              {JSON.stringify(data, null, 2)}
            </pre>
          </details>
        </div>
      </main>
    </div>
  );
}
