'use client';

import { useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import styles from './setup.module.css';

interface ParsedFile {
  name: string;
  tickers: string[];
  error?: string;
}

export default function SetupPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'sp500' | 'import'>('sp500');
  const [tickersInput, setTickersInput] = useState('');
  const [parsedTickers, setParsedTickers] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<ParsedFile | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Parse tickers from various formats
  const parseTickers = useCallback((input: string): string[] => {
    // Split by common delimiters
    const tickers = input
      .split(/[\s,;\n\r\t]+/)
      .map(t => t.trim().toUpperCase())
      .filter(t => /^[A-Z]{1,5}$/.test(t)); // Valid ticker format
    
    // Deduplicate
    return [...new Set(tickers)];
  }, []);
  
  // Parse CSV file
  const parseCSV = useCallback((content: string): string[] => {
    const lines = content.split(/\r?\n/);
    const tickers: string[] = [];
    
    // Check if first line is header
    const firstLine = lines[0]?.toLowerCase() || '';
    const hasHeader = firstLine.includes('ticker') || firstLine.includes('symbol');
    
    // Find ticker column index
    let tickerColIndex = 0;
    if (hasHeader) {
      const headers = firstLine.split(',');
      tickerColIndex = headers.findIndex(h => 
        h.trim() === 'ticker' || h.trim() === 'symbol'
      );
      if (tickerColIndex === -1) tickerColIndex = 0;
    }
    
    const startIndex = hasHeader ? 1 : 0;
    
    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      const cols = line.split(',');
      const ticker = cols[tickerColIndex]?.trim().toUpperCase();
      
      if (ticker && /^[A-Z]{1,5}$/.test(ticker)) {
        tickers.push(ticker);
      }
    }
    
    return [...new Set(tickers)];
  }, []);
  
  // Parse JSON file
  const parseJSON = useCallback((content: string): string[] => {
    try {
      const data = JSON.parse(content);
      
      // Format: { "tickers": ["AAPL", "MSFT"] }
      if (data.tickers && Array.isArray(data.tickers)) {
        return data.tickers
          .map((t: unknown) => String(t).trim().toUpperCase())
          .filter((t: string) => /^[A-Z]{1,5}$/.test(t));
      }
      
      // Format: ["AAPL", "MSFT"]
      if (Array.isArray(data)) {
        return data
          .map((t: unknown) => String(t).trim().toUpperCase())
          .filter((t: string) => /^[A-Z]{1,5}$/.test(t));
      }
      
      return [];
    } catch {
      return [];
    }
  }, []);
  
  // Handle file upload
  const handleFile = useCallback((file: File) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const content = e.target?.result as string;
      let tickers: string[] = [];
      
      if (file.name.endsWith('.csv')) {
        tickers = parseCSV(content);
      } else if (file.name.endsWith('.json')) {
        tickers = parseJSON(content);
      } else {
        // Try as plain text
        tickers = parseTickers(content);
      }
      
      if (tickers.length === 0) {
        setUploadedFile({
          name: file.name,
          tickers: [],
          error: 'No valid tickers found in file'
        });
      } else {
        setUploadedFile({
          name: file.name,
          tickers
        });
        setParsedTickers(tickers);
        setTickersInput(tickers.join(', '));
      }
    };
    
    reader.readAsText(file);
  }, [parseCSV, parseJSON, parseTickers]);
  
  // Drag and drop handlers
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);
  
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);
  
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFile(file);
    }
  }, [handleFile]);
  
  // Update parsed tickers when input changes
  const handleInputChange = (value: string) => {
    setTickersInput(value);
    setUploadedFile(null);
    const parsed = parseTickers(value);
    setParsedTickers(parsed);
  };
  
  // Remove ticker from list
  const removeTicker = (ticker: string) => {
    const newTickers = parsedTickers.filter(t => t !== ticker);
    setParsedTickers(newTickers);
    setTickersInput(newTickers.join(', '));
  };
  
  // Calculate estimated time
  const getEstimate = () => {
    const count = mode === 'sp500' ? 493 : parsedTickers.length;
    if (count === 0) return null;
    
    // ~2 seconds per ticker
    const minSeconds = Math.ceil(count * 1.5);
    const maxSeconds = Math.ceil(count * 3);
    
    const formatTime = (s: number) => {
      if (s < 60) return `${s}s`;
      const m = Math.floor(s / 60);
      const remainder = s % 60;
      return remainder > 0 ? `${m}m ${remainder}s` : `${m}m`;
    };
    
    return `${formatTime(minSeconds)} – ${formatTime(maxSeconds)}`;
  };
  
  // Submit handler
  const handleSubmit = async () => {
    setError('');
    setLoading(true);
    
    try {
      let tickers: string[] = [];
      
      if (mode === 'import') {
        tickers = parsedTickers;
        
        if (tickers.length === 0) {
          setError('Please enter at least one valid ticker');
          setLoading(false);
          return;
        }
      }
      
      const response = await fetch('/api/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, tickers })
      });
      
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create run');
      }
      
      const { runId } = await response.json();
      router.push(`/run/${runId}/rocket`);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setLoading(false);
    }
  };
  
  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <header className={styles.header}>
          <h1 className={styles.title}>Select Universe</h1>
          <p className={styles.subtitle}>
            Choose your stock universe for RocketScore analysis
          </p>
        </header>
        
        <div className={styles.content}>
          {/* Mode Selector */}
          <div className={styles.modeSelector}>
            <button
              className={`${styles.modeButton} ${mode === 'sp500' ? styles.active : ''}`}
              onClick={() => setMode('sp500')}
            >
              <span className={styles.modeIcon}>📊</span>
              <div className={styles.modeInfo}>
                <span className={styles.modeName}>S&P 500</span>
                <span className={styles.modeDesc}>493 stocks (ex MAG7)</span>
              </div>
            </button>
            
            <button
              className={`${styles.modeButton} ${mode === 'import' ? styles.active : ''}`}
              onClick={() => setMode('import')}
            >
              <span className={styles.modeIcon}>📁</span>
              <div className={styles.modeInfo}>
                <span className={styles.modeName}>Custom List</span>
                <span className={styles.modeDesc}>Upload or paste tickers</span>
              </div>
            </button>
          </div>
          
          {/* Import Section */}
          {mode === 'import' && (
            <div className={styles.importSection}>
              {/* Drag & Drop Zone */}
              <div
                className={`${styles.dropZone} ${isDragOver ? styles.dropZoneActive : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.json,.txt"
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                  style={{ display: 'none' }}
                />
                
                <div className={styles.dropZoneContent}>
                  <span className={styles.dropZoneIcon}>📄</span>
                  <p className={styles.dropZoneText}>
                    <strong>Drop file here</strong> or click to browse
                  </p>
                  <p className={styles.dropZoneHint}>
                    Supports CSV, JSON, or plain text
                  </p>
                </div>
              </div>
              
              {uploadedFile && (
                <div className={`${styles.fileStatus} ${uploadedFile.error ? styles.fileError : styles.fileSuccess}`}>
                  <span>{uploadedFile.name}</span>
                  {uploadedFile.error ? (
                    <span className={styles.fileErrorMsg}>{uploadedFile.error}</span>
                  ) : (
                    <span>{uploadedFile.tickers.length} tickers found</span>
                  )}
                </div>
              )}
              
              <div className={styles.divider}>
                <span>or paste tickers</span>
              </div>
              
              {/* Textarea */}
              <textarea
                className={styles.textarea}
                value={tickersInput}
                onChange={(e) => handleInputChange(e.target.value)}
                placeholder="AAPL, MSFT, GOOGL, NVDA, AMD&#10;TSLA&#10;META"
                rows={4}
              />
              
              {/* Parsed Tickers Preview */}
              {parsedTickers.length > 0 && (
                <div className={styles.tickersPreview}>
                  <div className={styles.tickersHeader}>
                    <span>{parsedTickers.length} tickers</span>
                    <button 
                      className={styles.clearButton}
                      onClick={() => { setParsedTickers([]); setTickersInput(''); }}
                    >
                      Clear all
                    </button>
                  </div>
                  <div className={styles.tickersList}>
                    {parsedTickers.slice(0, 50).map(ticker => (
                      <span key={ticker} className={styles.tickerChip}>
                        {ticker}
                        <button 
                          className={styles.removeChip}
                          onClick={() => removeTicker(ticker)}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    {parsedTickers.length > 50 && (
                      <span className={styles.moreChip}>
                        +{parsedTickers.length - 50} more
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* Time Estimate */}
          {(mode === 'sp500' || parsedTickers.length > 0) && (
            <div className={styles.estimate}>
              <span className={styles.estimateIcon}>⏱</span>
              <span className={styles.estimateText}>
                RocketScore typically takes <strong>{getEstimate()}</strong> for {mode === 'sp500' ? '493' : parsedTickers.length} stocks
              </span>
            </div>
          )}
          
          {/* Error */}
          {error && (
            <div className={styles.error}>
              {error}
            </div>
          )}
          
          {/* Submit Button */}
          <button
            className={styles.submitButton}
            onClick={handleSubmit}
            disabled={loading || (mode === 'import' && parsedTickers.length === 0)}
          >
            {loading ? (
              <>
                <span className={styles.spinner} />
                Starting analysis...
              </>
            ) : (
              'Run RocketScore →'
            )}
          </button>
          
          {/* Info */}
          <div className={styles.info}>
            <h3>What is RocketScore?</h3>
            <p>
              RocketScore is a proprietary scoring algorithm that combines technical analysis, 
              volume flow signals, fundamental quality metrics, and macro sector alignment to 
              identify stocks with strong momentum characteristics.
            </p>
            <ul>
              <li><strong>Technical (45%)</strong> – Price momentum, trend slope, drawdown</li>
              <li><strong>Volume (25%)</strong> – Flow signals, accumulation patterns</li>
              <li><strong>Quality (20%)</strong> – Operating margins, revenue growth</li>
              <li><strong>Macro (10%)</strong> – Sector alignment with macro themes</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
