'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/Button';
import styles from './setup.module.css';

export default function SetupPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'sp500' | 'import'>('sp500');
  const [tickersInput, setTickersInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  const handleSubmit = async () => {
    setError('');
    setLoading(true);
    
    try {
      let tickers: string[] = [];
      
      if (mode === 'import') {
        // Parse tickers from input
        tickers = tickersInput
          .split(/[\s,\n]+/)
          .map(t => t.trim().toUpperCase())
          .filter(t => t.length > 0);
        
        if (tickers.length === 0) {
          setError('Please enter at least one ticker');
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
    <div className={styles.container}>
      <div className={styles.content}>
        <h1 className={styles.title}>Select Universe</h1>
        
        <div className={styles.segmented}>
          <button
            className={`${styles.segmentButton} ${mode === 'sp500' ? styles.active : ''}`}
            onClick={() => setMode('sp500')}
          >
            S&P 500
          </button>
          <button
            className={`${styles.segmentButton} ${mode === 'import' ? styles.active : ''}`}
            onClick={() => setMode('import')}
          >
            Import List
          </button>
        </div>
        
        {mode === 'import' && (
          <div className={styles.inputGroup}>
            <label className={styles.label}>
              Paste tickers (comma, space, or newline separated)
            </label>
            <textarea
              className={styles.textarea}
              value={tickersInput}
              onChange={(e) => setTickersInput(e.target.value)}
              placeholder="AAPL, MSFT, GOOGL&#10;TSLA&#10;NVDA"
              rows={6}
            />
          </div>
        )}
        
        {error && (
          <div className={styles.error}>{error}</div>
        )}
        
        <Button
          variant="primary"
          onClick={handleSubmit}
          loading={loading}
          disabled={loading}
        >
          Run RocketScore
        </Button>
      </div>
    </div>
  );
}
