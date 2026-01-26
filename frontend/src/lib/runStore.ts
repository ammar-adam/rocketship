/**
 * Server-only data access layer for run outputs.
 * Handles case-insensitive lookups, missing files, schema variations.
 */
import 'server-only';
import { readArtifact, exists, list } from './storage';

export type JsonResult = 
  | { ok: true; data: any }
  | { ok: false; error: string };

export interface StockResult {
  ticker: string;
  data: any;
  source: 'file' | 'summary' | 'missing';
  loadedPath?: string;
  keys?: string[];
}

/**
 * Get list of all runs, sorted newest-first
 */
export async function getRuns(): Promise<string[]> {
  try {
    // Use listRuns from storage which handles both filesystem and blob storage
    const { listRuns } = await import('./storage');
    return await listRuns();
  } catch (error) {
    console.error('Error listing runs:', error);
    return [];
  }
}

/**
 * Find first existing summary file in run directory
 */
export async function findSummaryFile(runId: string): Promise<string | null> {
  const candidates = ['manifest.json', 'summary.json', 'results.json', 'top_25.json'];
  
  for (const filename of candidates) {
    if (await exists(runId, filename)) {
      return filename;
    }
  }
  
  return null;
}

/**
 * Safely read and parse JSON file
 */
export async function safeReadJson(runId: string, filename: string): Promise<JsonResult> {
  try {
    if (!(await exists(runId, filename))) {
      return { ok: false, error: 'File not found' };
    }
    
    const content = await readArtifact(runId, filename);
    const data = JSON.parse(content);
    return { ok: true, data };
  } catch (error) {
    return { 
      ok: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * List all stock tickers in a run
 */
export async function listStocks(runId: string): Promise<string[]> {
  // Try stocks directory first
  try {
    const stocksFiles = await list(runId, 'stocks');
    if (stocksFiles.length > 0) {
      return stocksFiles
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', '').replace('stocks/', '').toUpperCase());
    }
  } catch (error) {
    console.error(`Error reading stocks directory: ${error}`);
  }
  
  // Fallback to summary file
  const summaryFile = await findSummaryFile(runId);
  if (summaryFile) {
    const result = await safeReadJson(runId, summaryFile);
    if (result.ok && Array.isArray(result.data)) {
      return result.data
        .map((item: any) => item.ticker || item.symbol || item.TICKER)
        .filter(Boolean)
        .map((t: string) => t.toUpperCase());
    }
  }
  
  return [];
}

/**
 * Read stock data with case-insensitive matching
 */
export async function readStock(runId: string, ticker: string): Promise<StockResult> {
  const tickerUpper = ticker.toUpperCase();
  const tickerLower = ticker.toLowerCase();
  
  // Try stocks directory first (case-insensitive)
  try {
    const stocksFiles = await list(runId, 'stocks');
    
    // Find matching file (case-insensitive)
    const matchingFile = stocksFiles.find(f => {
      const baseName = f.replace('.json', '').replace('stocks/', '');
      return baseName.toLowerCase() === tickerLower;
    });
    
    if (matchingFile) {
      const result = await safeReadJson(runId, `stocks/${matchingFile}`);
      
      if (result.ok) {
        return {
          ticker: tickerUpper,
          data: result.data,
          source: 'file',
          loadedPath: `stocks/${matchingFile}`,
          keys: Object.keys(result.data),
        };
      }
    }
  } catch (error) {
    console.error(`Error reading from stocks directory: ${error}`);
  }
  
  // Fallback to summary file
  const summaryFile = await findSummaryFile(runId);
  if (summaryFile) {
    const result = await safeReadJson(runId, summaryFile);
    
    if (result.ok && Array.isArray(result.data)) {
      const match = result.data.find((item: any) => {
        const itemTicker = item.ticker || item.symbol || item.TICKER;
        return itemTicker && itemTicker.toUpperCase() === tickerUpper;
      });
      
      if (match) {
        return {
          ticker: tickerUpper,
          data: match,
          source: 'summary',
          loadedPath: summaryFile,
          keys: Object.keys(match),
        };
      }
    }
  }
  
  // Not found
  return {
    ticker: tickerUpper,
    data: null,
    source: 'missing',
  };
}
