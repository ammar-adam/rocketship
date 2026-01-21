import StockCard from '@/components/StockCard';
import { getRuns, resolveRunDir, findSummaryFile, safeReadJson, listStocks } from '@/src/lib/runStore';

export default async function Dashboard() {
  const runs = getRuns();
  
  if (runs.length === 0) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-foreground mb-2">No Data Available</h1>
          <p className="text-muted">Run the backend pipeline first: python run.py</p>
        </div>
      </div>
    );
  }

  const latestRunId = runs[0];
  const runDir = resolveRunDir(latestRunId);
  const summaryPath = findSummaryFile(runDir);
  
  if (!summaryPath) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-foreground mb-2">No Summary File</h1>
          <p className="text-muted">Run: {latestRunId}</p>
        </div>
      </div>
    );
  }

  const result = safeReadJson(summaryPath);
  if (!result.ok || !Array.isArray(result.data)) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-foreground mb-2">Invalid Data</h1>
          <p className="text-muted">Run: {latestRunId}</p>
          <p className="text-sm text-muted mt-2">{result.ok ? 'Data is not an array' : result.error}</p>
        </div>
      </div>
    );
  }

  const stocks = result.data;
  
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-white">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <h1 className="text-xl font-semibold text-foreground">RocketShip</h1>
          <p className="text-sm text-muted">Multi-agent stock discovery system</p>
        </div>
      </header>
      
      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-foreground mb-1">
            {stocks.length} Stock{stocks.length !== 1 ? 's' : ''} Analyzed
          </h2>
          <p className="text-sm text-muted">
            Last run: {latestRunId}
          </p>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {stocks.map((stock: any) => (
            <StockCard key={stock.ticker} stock={stock} runId={latestRunId} />
          ))}
        </div>
      </main>
    </div>
  );
}
