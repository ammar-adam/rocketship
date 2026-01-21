/**
 * Server-only data access layer for run outputs.
 * Handles case-insensitive lookups, missing files, schema variations.
 */
import 'server-only';
import fs from 'fs';
import path from 'path';

const REPO_ROOT = path.join(process.cwd(), '..');
const RUNS_DIR = path.join(REPO_ROOT, 'runs');

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
export function getRuns(): string[] {
  try {
    if (!fs.existsSync(RUNS_DIR)) {
      return [];
    }
    
    return fs.readdirSync(RUNS_DIR)
      .filter(name => {
        const fullPath = path.join(RUNS_DIR, name);
        return fs.statSync(fullPath).isDirectory();
      })
      .sort()
      .reverse();
  } catch (error) {
    console.error('Error listing runs:', error);
    return [];
  }
}

/**
 * Resolve absolute path to run directory
 */
export function resolveRunDir(runId: string): string {
  return path.join(RUNS_DIR, runId);
}

/**
 * Find first existing summary file in run directory
 */
export function findSummaryFile(runDir: string): string | null {
  const candidates = ['manifest.json', 'summary.json', 'results.json', 'top_25.json'];
  
  for (const filename of candidates) {
    const fullPath = path.join(runDir, filename);
    if (fs.existsSync(fullPath)) {
      return fullPath;
    }
  }
  
  return null;
}

/**
 * Safely read and parse JSON file
 */
export function safeReadJson(filePath: string): JsonResult {
  try {
    if (!fs.existsSync(filePath)) {
      return { ok: false, error: 'File not found' };
    }
    
    const content = fs.readFileSync(filePath, 'utf-8');
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
export function listStocks(runId: string): string[] {
  const runDir = resolveRunDir(runId);
  const stocksDir = path.join(runDir, 'stocks');
  
  // Try stocks directory first
  if (fs.existsSync(stocksDir) && fs.statSync(stocksDir).isDirectory()) {
    try {
      return fs.readdirSync(stocksDir)
        .filter(f => f.endsWith('.json'))
        .map(f => f.replace('.json', '').toUpperCase());
    } catch (error) {
      console.error(`Error reading stocks directory: ${error}`);
    }
  }
  
  // Fallback to summary file
  const summaryPath = findSummaryFile(runDir);
  if (summaryPath) {
    const result = safeReadJson(summaryPath);
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
export function readStock(runId: string, ticker: string): StockResult {
  const runDir = resolveRunDir(runId);
  const stocksDir = path.join(runDir, 'stocks');
  const tickerUpper = ticker.toUpperCase();
  const tickerLower = ticker.toLowerCase();
  
  // Try stocks directory first (case-insensitive)
  if (fs.existsSync(stocksDir) && fs.statSync(stocksDir).isDirectory()) {
    try {
      const files = fs.readdirSync(stocksDir);
      
      // Find matching file (case-insensitive)
      const matchingFile = files.find(f => {
        const baseName = f.replace('.json', '');
        return baseName.toLowerCase() === tickerLower;
      });
      
      if (matchingFile) {
        const fullPath = path.join(stocksDir, matchingFile);
        const result = safeReadJson(fullPath);
        
        if (result.ok) {
          return {
            ticker: tickerUpper,
            data: result.data,
            source: 'file',
            loadedPath: fullPath,
            keys: Object.keys(result.data),
          };
        }
      }
    } catch (error) {
      console.error(`Error reading from stocks directory: ${error}`);
    }
  }
  
  // Fallback to summary file
  const summaryPath = findSummaryFile(runDir);
  if (summaryPath) {
    const result = safeReadJson(summaryPath);
    
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
          loadedPath: summaryPath,
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
