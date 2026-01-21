'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './optimize.module.css';

interface PageProps {
  params: Promise<{ runId: string }>;
}

interface Portfolio {
  capital: number;
  constraints: {
    max_weight: number;
    sector_cap: number;
    min_positions: number;
  };
  allocations: Array<{
    ticker: string;
    weight: number;
    dollars: number;
    sector: string;
  }>;
  sector_breakdown: Array<{
    sector: string;
    weight: number;
  }>;
  summary: {
    positions: number;
    cash_weight: number;
  };
}

export default function OptimizePage({ params }: PageProps) {
  const router = useRouter();
  const [runId, setRunId] = useState('');
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  
  useEffect(() => {
    params.then(p => setRunId(p.runId));
  }, [params]);
  
  useEffect(() => {
    if (!runId) return;
    
    const loadData = async () => {
      try {
        const res = await fetch(`/api/runs/${runId}/portfolio.json`);
        if (res.ok) {
          setPortfolio(await res.json());
        } else {
          // Portfolio doesn't exist, redirect to loading
          router.push(`/run/${runId}/optimize/loading`);
          return;
        }
        setLoading(false);
      } catch (err) {
        console.error('Error loading portfolio:', err);
        setLoading(false);
      }
    };
    
    loadData();
  }, [runId, router]);
  
  const handleCopy = () => {
    if (!portfolio) return;
    
    const text = portfolio.allocations
      .map(a => `${a.ticker}: ${(a.weight * 100).toFixed(1)}% ($${a.dollars.toFixed(0)})`)
      .join('\n');
    
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  
  const handleDownload = () => {
    if (!portfolio) return;
    
    const blob = new Blob([JSON.stringify(portfolio, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `portfolio_${runId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  
  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading portfolio...</div>
      </div>
    );
  }
  
  if (!portfolio) {
    return (
      <div className={styles.container}>
        <div className={styles.error}>
          <h1>Portfolio Not Found</h1>
          <button onClick={() => router.push(`/run/${runId}/optimize/loading`)}>
            Run Optimization
          </button>
        </div>
      </div>
    );
  }
  
  const maxSectorWeight = Math.max(...portfolio.sector_breakdown.map(s => s.weight));
  
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Portfolio Allocation</h1>
          <p className={styles.subtitle}>Run: {runId}</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.backButton} onClick={() => router.push(`/run/${runId}`)}>
            ← Dashboard
          </button>
          <button className={styles.actionButton} onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy Allocations'}
          </button>
          <button className={styles.actionButton} onClick={handleDownload}>
            Download JSON
          </button>
        </div>
      </header>
      
      <main className={styles.main}>
        {/* Summary Cards */}
        <div className={styles.summaryGrid}>
          <div className={styles.summaryCard}>
            <span className={styles.summaryValue}>${portfolio.capital.toLocaleString()}</span>
            <span className={styles.summaryLabel}>Capital</span>
          </div>
          <div className={styles.summaryCard}>
            <span className={styles.summaryValue}>{portfolio.summary.positions}</span>
            <span className={styles.summaryLabel}>Positions</span>
          </div>
          <div className={styles.summaryCard}>
            <span className={styles.summaryValue}>{(portfolio.summary.cash_weight * 100).toFixed(1)}%</span>
            <span className={styles.summaryLabel}>Cash</span>
          </div>
        </div>
        
        {/* Constraints */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Constraints</h2>
          <div className={styles.constraints}>
            <span>Max Weight: {(portfolio.constraints.max_weight * 100).toFixed(0)}%</span>
            <span>Sector Cap: {(portfolio.constraints.sector_cap * 100).toFixed(0)}%</span>
            <span>Min Positions: {portfolio.constraints.min_positions}</span>
          </div>
        </section>
        
        <div className={styles.columns}>
          {/* Allocations Table */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Allocations</h2>
            <div className={styles.tableContainer}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Ticker</th>
                    <th>Weight</th>
                    <th>Dollars</th>
                    <th>Sector</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolio.allocations.map((alloc) => (
                    <tr key={alloc.ticker}>
                      <td className={styles.ticker}>{alloc.ticker}</td>
                      <td>
                        <div className={styles.weightCell}>
                          <div 
                            className={styles.weightBar}
                            style={{ width: `${alloc.weight * 100 / portfolio.constraints.max_weight * 100}%` }}
                          />
                          <span>{(alloc.weight * 100).toFixed(1)}%</span>
                        </div>
                      </td>
                      <td>${alloc.dollars.toFixed(0)}</td>
                      <td>{alloc.sector}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          
          {/* Sector Breakdown */}
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>Sector Breakdown</h2>
            <div className={styles.sectorList}>
              {portfolio.sector_breakdown.map((sector) => (
                <div key={sector.sector} className={styles.sectorItem}>
                  <div className={styles.sectorHeader}>
                    <span className={styles.sectorName}>{sector.sector}</span>
                    <span className={styles.sectorWeight}>{(sector.weight * 100).toFixed(1)}%</span>
                  </div>
                  <div className={styles.sectorBarContainer}>
                    <div 
                      className={styles.sectorBar}
                      style={{ width: `${(sector.weight / maxSectorWeight) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
