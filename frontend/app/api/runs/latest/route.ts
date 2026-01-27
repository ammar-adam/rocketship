import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const runsDir = path.join(process.cwd(), '..', 'runs');
    
    if (!fs.existsSync(runsDir)) {
      return NextResponse.json({ error: 'No runs found' }, { status: 404 });
    }
    
    const runs = fs.readdirSync(runsDir)
      .filter(f => fs.statSync(path.join(runsDir, f)).isDirectory())
      .sort()
      .reverse();
    
    if (runs.length === 0) {
      return NextResponse.json({ error: 'No runs found' }, { status: 404 });
    }
    
    const latestRun = runs[0];
    const runPath = path.join(runsDir, latestRun);
    
    const top25Path = path.join(runPath, 'top_25.json');
    const portfolioPath = path.join(runPath, 'portfolio.csv');
    
    const top25 = JSON.parse(fs.readFileSync(top25Path, 'utf-8'));
    
    let portfolio = null;
    if (fs.existsSync(portfolioPath)) {
      // Parse portfolio.csv if exists
      const csv = fs.readFileSync(portfolioPath, 'utf-8');
      // Simple CSV parsing
      const lines = csv.split('\n').filter(l => l.trim());
      const headers = lines[0].split(',');
      portfolio = {
        positions: lines.slice(1).map(line => {
          const values = line.split(',');
          return headers.reduce((obj, header, i) => {
            obj[header] = isNaN(Number(values[i])) ? values[i] : Number(values[i]);
            return obj;
          }, {} as any);
        })
      };
    }
    
    return NextResponse.json({
      timestamp: latestRun,
      top_25: top25,
      portfolio
    });
    
  } catch (error) {
    console.error('Error fetching latest run:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
