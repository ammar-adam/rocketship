'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './stock.module.css';

interface PageProps {
  params: Promise<{ runId: string; ticker: string }>;
}

interface RocketScore {
  ticker: string;
  sector: string;
  current_price: number;
  rocket_score: number;
  technical_score: number;
  macro_score: number;
  breakdown: Record<string, number>;
  tags: string[];
  macro_trends_matched: Array<{ name: string; confidence: number; thesis: string }>;
}

interface DebateData {
  ticker: string;
  agents: {
    bull: { summary: string; points: string[]; risks: string[] };
    bear: { summary: string; points: string[]; risks: string[] };
    regime: { summary: string; regime: string; why: string };
    volume: { summary: string; signals: string[]; why: string };
  };
  judge: {
    verdict: string;
    confidence: number;
    rationale: string;
    key_disagreements: string[];
    what_would_change_mind: string[];
  };
}

export default function StockPage({ params }: PageProps) {
  const router = useRouter();
  const [runId, setRunId] = useState('');
  const [ticker, setTicker] = useState('');
  const [score, setScore] = useState<RocketScore | null>(null);
  const [debate, setDebate] = useState<DebateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showJson, setShowJson] = useState(false);
  
  useEffect(() => {
    params.then(p => {
      setRunId(p.runId);
      setTicker(p.ticker.toUpperCase());
    });
  }, [params]);
  
  useEffect(() => {
    if (!runId || !ticker) return;
    
    const loadData = async () => {
      try {
        // Load rocket_scores to find this ticker
        const scoresRes = await fetch(`/api/runs/${runId}/rocket_scores.json`);
        if (scoresRes.ok) {
          const scores = await scoresRes.json();
          const found = scores.find((s: RocketScore) => s.ticker.toUpperCase() === ticker);
          if (found) setScore(found);
        }
        
        // Load debate file
        const debateRes = await fetch(`/api/runs/${runId}/debate/${ticker}.json`);
        if (debateRes.ok) {
          setDebate(await debateRes.json());
        }
        
        setLoading(false);
      } catch (err) {
        console.error('Error loading stock:', err);
        setLoading(false);
      }
    };
    
    loadData();
  }, [runId, ticker]);
  
  if (loading) {
    return (
      <div className={styles.container}>
        <div className={styles.loading}>Loading...</div>
      </div>
    );
  }
  
  if (!score) {
    return (
      <div className={styles.container}>
        <div className={styles.notFound}>
          <h1>Stock Not Found</h1>
          <p>{ticker} not found in this run.</p>
          <button onClick={() => router.push(`/run/${runId}`)}>Back to Dashboard</button>
        </div>
      </div>
    );
  }
  
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.backButton} onClick={() => router.push(`/run/${runId}`)}>
            ← Back
          </button>
          <div>
            <h1 className={styles.ticker}>{ticker}</h1>
            <p className={styles.sector}>{score.sector}</p>
          </div>
        </div>
        <div className={styles.headerRight}>
          <div className={styles.scoreDisplay}>
            <span className={styles.scoreValue}>{score.rocket_score.toFixed(1)}</span>
            <span className={styles.scoreLabel}>RocketScore</span>
          </div>
          {debate && (
            <span className={`${styles.verdict} ${styles[`verdict${debate.judge.verdict}`]}`}>
              {debate.judge.verdict}
            </span>
          )}
        </div>
      </header>
      
      <main className={styles.main}>
        <div className={styles.columns}>
          {/* Left Column: Metrics */}
          <div className={styles.leftColumn}>
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Score Breakdown</h2>
              <div className={styles.breakdown}>
                <div className={styles.breakdownItem}>
                  <span className={styles.breakdownLabel}>Technical</span>
                  <span className={styles.breakdownValue}>{score.technical_score.toFixed(1)}</span>
                </div>
                <div className={styles.breakdownItem}>
                  <span className={styles.breakdownLabel}>Macro</span>
                  <span className={styles.breakdownValue}>{score.macro_score.toFixed(1)}</span>
                </div>
                {Object.entries(score.breakdown || {}).map(([key, value]) => (
                  <div key={key} className={styles.breakdownItem}>
                    <span className={styles.breakdownLabel}>{key}</span>
                    <span className={styles.breakdownValue}>{value}</span>
                  </div>
                ))}
              </div>
            </section>
            
            <section className={styles.section}>
              <h2 className={styles.sectionTitle}>Price</h2>
              <p className={styles.price}>${(score.current_price || 0).toFixed(2)}</p>
            </section>
            
            {score.tags && score.tags.length > 0 && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Tags</h2>
                <div className={styles.tags}>
                  {score.tags.map((tag, i) => (
                    <span key={i} className={styles.tag}>{tag}</span>
                  ))}
                </div>
              </section>
            )}
            
            {score.macro_trends_matched && score.macro_trends_matched.length > 0 && (
              <section className={styles.section}>
                <h2 className={styles.sectionTitle}>Macro Trends</h2>
                <div className={styles.trends}>
                  {score.macro_trends_matched.map((trend, i) => (
                    <div key={i} className={styles.trend}>
                      <div className={styles.trendHeader}>
                        <span className={styles.trendName}>{trend.name}</span>
                        <span className={styles.trendConfidence}>{trend.confidence}%</span>
                      </div>
                      <p className={styles.trendThesis}>{trend.thesis}</p>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
          
          {/* Right Column: Debate */}
          <div className={styles.rightColumn}>
            {debate ? (
              <>
                {/* Judge Verdict */}
                <section className={`${styles.section} ${styles.judgeSection}`}>
                  <h2 className={styles.sectionTitle}>Judge Verdict</h2>
                  <div className={styles.judgeCard}>
                    <div className={styles.judgeHeader}>
                      <span className={`${styles.verdict} ${styles[`verdict${debate.judge.verdict}`]}`}>
                        {debate.judge.verdict}
                      </span>
                      <span className={styles.confidence}>
                        {(debate.judge.confidence * 100).toFixed(0)}% confidence
                      </span>
                    </div>
                    <p className={styles.rationale}>{debate.judge.rationale}</p>
                    {debate.judge.key_disagreements?.length > 0 && (
                      <div className={styles.judgeList}>
                        <strong>Key Disagreements:</strong>
                        <ul>
                          {debate.judge.key_disagreements.map((d, i) => (
                            <li key={i}>{d}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {debate.judge.what_would_change_mind?.length > 0 && (
                      <div className={styles.judgeList}>
                        <strong>What Would Change Mind:</strong>
                        <ul>
                          {debate.judge.what_would_change_mind.map((w, i) => (
                            <li key={i}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </section>
                
                {/* Agent Cards */}
                <div className={styles.agentGrid}>
                  <div className={`${styles.agentCard} ${styles.bullCard}`}>
                    <h3>Bull</h3>
                    <p className={styles.agentSummary}>{debate.agents.bull.summary}</p>
                    {debate.agents.bull.points?.length > 0 && (
                      <ul className={styles.agentPoints}>
                        {debate.agents.bull.points.map((p, i) => <li key={i}>{p}</li>)}
                      </ul>
                    )}
                  </div>
                  
                  <div className={`${styles.agentCard} ${styles.bearCard}`}>
                    <h3>Bear</h3>
                    <p className={styles.agentSummary}>{debate.agents.bear.summary}</p>
                    {debate.agents.bear.points?.length > 0 && (
                      <ul className={styles.agentPoints}>
                        {debate.agents.bear.points.map((p, i) => <li key={i}>{p}</li>)}
                      </ul>
                    )}
                  </div>
                  
                  <div className={`${styles.agentCard} ${styles.regimeCard}`}>
                    <h3>Regime</h3>
                    <span className={styles.regimeBadge}>{debate.agents.regime.regime}</span>
                    <p className={styles.agentSummary}>{debate.agents.regime.summary}</p>
                    <p className={styles.agentWhy}>{debate.agents.regime.why}</p>
                  </div>
                  
                  <div className={`${styles.agentCard} ${styles.volumeCard}`}>
                    <h3>Volume</h3>
                    <p className={styles.agentSummary}>{debate.agents.volume.summary}</p>
                    {debate.agents.volume.signals?.length > 0 && (
                      <ul className={styles.agentPoints}>
                        {debate.agents.volume.signals.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className={styles.noDebate}>
                <h2>Debate Not Run</h2>
                <p>Run the debate stage to see agent analysis.</p>
                <button 
                  className={styles.actionButton}
                  onClick={() => router.push(`/run/${runId}/debate`)}
                >
                  Go to Debate
                </button>
              </div>
            )}
          </div>
        </div>
        
        {/* Raw JSON Toggle */}
        <div className={styles.jsonSection}>
          <button 
            className={styles.jsonToggle}
            onClick={() => setShowJson(!showJson)}
          >
            {showJson ? 'Hide' : 'Show'} Raw JSON
          </button>
          {showJson && (
            <pre className={styles.jsonContent}>
              {JSON.stringify({ score, debate }, null, 2)}
            </pre>
          )}
        </div>
      </main>
    </div>
  );
}
