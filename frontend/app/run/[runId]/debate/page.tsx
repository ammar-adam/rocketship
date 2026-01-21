'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './debate.module.css';

interface PageProps {
  params: Promise<{ runId: string }>;
}

interface DebateSummary {
  buy: string[];
  hold: string[];
  wait: string[];
}

interface RocketScore {
  ticker: string;
  rocket_score: number;
  sector: string;
}

interface DebateFile {
  judge: {
    verdict: string;
    confidence: number;
  };
}

export default function DebatePage({ params }: PageProps) {
  const router = useRouter();
  const [runId, setRunId] = useState('');
  const [summary, setSummary] = useState<DebateSummary | null>(null);
  const [scores, setScores] = useState<Record<string, RocketScore>>({});
  const [debates, setDebates] = useState<Record<string, DebateFile>>({});
  const [loading, setLoading] = useState(true);
  const [debateRunning, setDebateRunning] = useState(false);
  
  useEffect(() => {
    params.then(p => setRunId(p.runId));
  }, [params]);
  
  useEffect(() => {
    if (!runId) return;
    
    const loadData = async () => {
      try {
        // Load debate_summary
        const summaryRes = await fetch(`/api/runs/${runId}/debate_summary.json`);
        if (!summaryRes.ok) {
          // Debate not run yet
          setLoading(false);
          return;
        }
        const summaryData = await summaryRes.json();
        setSummary(summaryData);
        
        // Load rocket_scores for additional data
        const scoresRes = await fetch(`/api/runs/${runId}/rocket_scores.json`);
        if (scoresRes.ok) {
          const scoresData = await scoresRes.json();
          const scoresMap: Record<string, RocketScore> = {};
          for (const s of scoresData) {
            scoresMap[s.ticker] = s;
          }
          setScores(scoresMap);
        }
        
        // Load debate files for confidence
        const allTickers = [...summaryData.buy, ...summaryData.hold, ...summaryData.wait];
        const debatesMap: Record<string, DebateFile> = {};
        
        for (const ticker of allTickers) {
          try {
            const debateRes = await fetch(`/api/runs/${runId}/debate/${ticker}.json`);
            if (debateRes.ok) {
              debatesMap[ticker] = await debateRes.json();
            }
          } catch (e) {
            // Skip
          }
        }
        setDebates(debatesMap);
        
        setLoading(false);
      } catch (err) {
        console.error('Error loading debate:', err);
        setLoading(false);
      }
    };
    
    loadData();
  }, [runId]);
  
  const handleRunDebate = async () => {
    setDebateRunning(true);
    try {
      const res = await fetch(`/api/run/${runId}/debate`, { method: 'POST' });
      if (res.ok) {
        window.location.reload();
      } else {
        const err = await res.json();
        alert(`Debate failed: ${err.error}`);
      }
    } catch (e) {
      alert(`Error: ${e}`);
    }
    setDebateRunning(false);
  };
  
  const handleOptimize = () => {
    router.push(`/run/${runId}/optimize/loading`);
  };
  
  const renderCard = (ticker: string, verdict: string) => {
    const score = scores[ticker];
    const debate = debates[ticker];
    
    return (
      <div 
        key={ticker}
        className={styles.card}
        onClick={() => router.push(`/run/${runId}/stock/${ticker}`)}
      >
        <div className={styles.cardHeader}>
          <span className={styles.cardTicker}>{ticker}</span>
          <span className={`${styles.verdict} ${styles[`verdict${verdict}`]}`}>
            {verdict}
          </span>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.cardScore}>
            <span className={styles.scoreValue}>{score?.rocket_score?.toFixed(1) || '—'}</span>
            <span className={styles.scoreLabel}>Score</span>
          </div>
          <div className={styles.cardConfidence}>
            <span className={styles.confidenceValue}>
              {debate ? `${(debate.judge.confidence * 100).toFixed(0)}%` : '—'}
            </span>
            <span className={styles.confidenceLabel}>Confidence</span>
          </div>
        </div>
        <div className={styles.cardSector}>{score?.sector || 'Unknown'}</div>
      </div>
    );
  };
  
  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading debate results...</div>
      </div>
    );
  }
  
  if (!summary) {
    return (
      <div className={styles.container}>
        <header className={styles.header}>
          <h1 className={styles.title}>Debate Analysis</h1>
          <p className={styles.subtitle}>Run: {runId}</p>
        </header>
        <main className={styles.main}>
          <div className={styles.emptyState}>
            <h2>Debate Not Run</h2>
            <p>Run the DeepSeek multi-agent debate to get BUY/HOLD/WAIT verdicts.</p>
            <button 
              className={styles.actionButton}
              onClick={handleRunDebate}
              disabled={debateRunning}
            >
              {debateRunning ? 'Running Debate...' : 'Run Debate'}
            </button>
          </div>
        </main>
      </div>
    );
  }
  
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>Debate Results</h1>
          <p className={styles.subtitle}>Run: {runId}</p>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.backButton} onClick={() => router.push(`/run/${runId}`)}>
            ← Dashboard
          </button>
          <button className={styles.actionButton} onClick={handleOptimize}>
            Next: Optimize Portfolio
          </button>
        </div>
      </header>
      
      <main className={styles.main}>
        <section className={styles.section}>
          <h2 className={`${styles.sectionTitle} ${styles.buyTitle}`}>
            BUY ({summary.buy.length})
          </h2>
          <div className={styles.grid}>
            {summary.buy.map(ticker => renderCard(ticker, 'BUY'))}
          </div>
        </section>
        
        <section className={styles.section}>
          <h2 className={`${styles.sectionTitle} ${styles.holdTitle}`}>
            HOLD ({summary.hold.length})
          </h2>
          <div className={styles.grid}>
            {summary.hold.map(ticker => renderCard(ticker, 'HOLD'))}
          </div>
        </section>
        
        <section className={styles.section}>
          <h2 className={`${styles.sectionTitle} ${styles.waitTitle}`}>
            WAIT ({summary.wait.length})
          </h2>
          <div className={styles.grid}>
            {summary.wait.map(ticker => renderCard(ticker, 'WAIT'))}
          </div>
        </section>
      </main>
    </div>
  );
}
