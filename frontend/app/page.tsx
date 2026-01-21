import StockCard from '@/components/StockCard';
import fs from 'fs';
import path from 'path';

async function getLatestRun() {
  try {
    const runsDir = path.join(process.cwd(), '..', 'runs');
    
    if (!fs.existsSync(runsDir)) {
      return null;
    }
    
    const runs = fs.readdirSync(runsDir)
      .filter(f => fs.statSync(path.join(runsDir, f)).isDirectory())
      .sort()
      .reverse();
    
    if (runs.length === 0) {
      return null;
    }
    
    const latestRun = runs[0];
    const runPath = path.join(runsDir, latestRun);
    const top25Path = path.join(runPath, 'top_25.json');
    
    const top25 = JSON.parse(fs.readFileSync(top25Path, 'utf-8'));
    
    return {
      timestamp: latestRun,
      top_25: top25,
    };
  } catch (error) {
    console.error('Error loading data:', error);
    return null;
  }
}

export default async function Dashboard() {
  const data = await getLatestRun();
  
  if (!data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-semibold text-foreground mb-2">No Data Available</h1>
          <p className="text-muted">Run the backend pipeline first: python run.py</p>
        </div>
      </div>
    );
  }
  
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
            25 Stocks Analyzed
          </h2>
          <p className="text-sm text-muted">
            Last run: {new Date(data.timestamp).toLocaleString()}
          </p>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
          {data.top_25.map((stock: any) => (
            <StockCard key={stock.ticker} stock={stock} />
          ))}
        </div>
      </main>
    </div>
  );
}
