'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './dashboard.module.css';

interface PageProps {
  params: Promise<{ runId: string }>;
}

interface RocketScore {
  ticker: string;
  sector: string;
  current_price: number;
  rocket_score: number;
  technical_score: number;
  macro_score: number;
  tags: string[];
}

type SortKey = 'ticker' | 'rocket_score' | 'sector';
type SortDir = 'asc' | 'desc';

export default function DashboardPage({ params }: PageProps) {
  const router = useRouter();
  const [runId, setRunId] = useState('');
  const [scores, setScores] = useState<RocketScore[]>([]);
  const [sortKey, setSortKey] = useState<SortKey>('rocket_score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [loading, setLoading] = useState(true);
  
  useEffect(() => {
    params.then(p => setRunId(p.runId));
  }, [params]);
  
  useEffect(() => {
    if (!runId) return;
    
    fetch(`/api/run/${runId}/status`)
      .then(res => res.json())
      .then(async (status) => {
        if (status.stage === 'rocket') {
          // Still processing, redirect back
          router.push(`/run/${runId}/rocket`);
          return;
        }
        
        // Load rocket_scores.json
        const scoresRes = await fetch(`/runs/${runId}/rocket_scores.json`);
        if (scoresRes.ok) {
          const data = await scoresRes.json();
          setScores(data);
        }
        setLoading(false);
      })
      .catch(err => {
        console.error('Error loading dashboard:', err);
        setLoading(false);
      });
  }, [runId, router]);
  
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'rocket_score' ? 'desc' : 'asc');
    }
  };
  
  const sortedScores = [...scores].sort((a, b) => {
    const aVal = a[sortKey];
    const bVal = b[sortKey];
    
    if (typeof aVal === 'string' && typeof bVal === 'string') {
      return sortDir === 'asc' 
        ? aVal.localeCompare(bVal)
        : bVal.localeCompare(aVal);
    }
    
    if (typeof aVal === 'number' && typeof bVal === 'number') {
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    }
    
    return 0;
  });
  
  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading...</div>
      </div>
    );
  }
  
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>RocketShip Dashboard</h1>
          <p className={styles.subtitle}>Run: {runId}</p>
        </div>
      </header>
      
      <main className={styles.main}>
        <div className={styles.tableContainer}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th onClick={() => handleSort('ticker')} className={styles.sortable}>
                  Ticker {sortKey === 'ticker' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th onClick={() => handleSort('rocket_score')} className={styles.sortable}>
                  Score {sortKey === 'rocket_score' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th onClick={() => handleSort('sector')} className={styles.sortable}>
                  Sector {sortKey === 'sector' && (sortDir === 'asc' ? '↑' : '↓')}
                </th>
                <th>Tags</th>
                <th>Price</th>
              </tr>
            </thead>
            <tbody>
              {sortedScores.map((score) => (
                <tr 
                  key={score.ticker}
                  onClick={() => router.push(`/run/${runId}/stock/${score.ticker}`)}
                  className={styles.row}
                >
                  <td className={styles.ticker}>{score.ticker}</td>
                  <td className={styles.score}>
                    <div className={styles.scoreBar}>
                      <div 
                        className={styles.scoreFill}
                        style={{ width: `${score.rocket_score}%` }}
                      />
                      <span className={styles.scoreText}>{score.rocket_score.toFixed(1)}</span>
                    </div>
                  </td>
                  <td>{score.sector}</td>
                  <td>
                    <div className={styles.tags}>
                      {score.tags?.slice(0, 2).map((tag, i) => (
                        <span key={i} className={styles.tag}>{tag}</span>
                      ))}
                    </div>
                  </td>
                  <td>${score.current_price.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
