const API_BASE = process.env.NEXT_PUBLIC_API_BASE || '';

export async function getLatestRun(): Promise<any | null> {
  try {
    // Use absolute URL for server-side fetching
    const baseUrl = API_BASE || 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/runs/latest`, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  } catch (error) {
    console.error('Failed to fetch latest run:', error);
    return null;
  }
}

export async function getStockAnalysis(ticker: string): Promise<any | null> {
  try {
    // Use absolute URL for server-side fetching
    const baseUrl = API_BASE || 'http://localhost:3000';
    const res = await fetch(`${baseUrl}/api/stock/${ticker}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.json();
  } catch (error) {
    console.error(`Failed to fetch ${ticker}:`, error);
    return null;
  }
}
