'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { PillFilters } from '@/components/ui/PillFilters';
import { EmptyState } from '@/components/ui/EmptyState';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { PageShell } from '@/components/ui/PageShell';
import styles from './debate.module.css';

interface DebateSummary {
  buy: string[];
  hold: string[];
  sell: string[];
  byTicker: Record<string, {
    verdict: string;
    confidence: number;
    rocket_score: number;
    sector: string;
    tags?: string[];
  }>;
}

type FilterValue = 'all' | 'top23' | 'edge';

export default function DebateDashboardPage() {
  const params = useParams();
  const runId = params.runId as string;
  
  const [summary, setSummary] = useState<DebateSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<FilterValue>('all');
  const [search, setSearch] = useState('');
  const [runningDebate, setRunningDebate] = useState(false);
  const [debateError, setDebateError] = useState('');
  
  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/runs/${runId}/debate/debate_summary.json`);
        if (!res.ok) {
          throw new Error('No debate data available');
        }
        
        const data = await res.json();
        setSummary(data);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load debate data');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [runId]);
  
  const filterOptions = [
    { label: 'All', value: 'all' },
    { label: 'Top 23', value: 'top23' },
    { label: 'Edge Cases', value: 'edge' },
  ];
  
  const getFilteredTickers = (tickers: string[]) => {
    if (!summary) return [];
    
    // Sort by rocket_score
    const sorted = [...tickers].sort((a, b) => 
      (summary.byTicker[b]?.rocket_score || 0) - (summary.byTicker[a]?.rocket_score || 0)
    );
    
    // All tickers for reference
    const allTickers = [...summary.buy, ...summary.hold, ...summary.sell]
      .sort((a, b) => (summary.byTicker[b]?.rocket_score || 0) - (summary.byTicker[a]?.rocket_score || 0));
    
    let filtered = sorted;
    switch (filter) {
      case 'top23':
        const top23Set = new Set(allTickers.slice(0, 23));
        filtered = sorted.filter(t => top23Set.has(t));
        break;
      case 'edge':
        const edgeSet = new Set(allTickers.slice(23, 28));
        filtered = sorted.filter(t => edgeSet.has(t));
        break;
      default:
        filtered = sorted;
    }
    
    if (search.trim()) {
      const q = search.trim().toUpperCase();
      filtered = filtered.filter(t => t.includes(q));
    }
    
    return filtered;
  };
  
  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.container}>
          <header className={styles.header}>
            <h1>Debate Results</h1>
            <p>Loading...</p>
          </header>
          <div className={styles.columns}>
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </div>
      </div>
    );
  }
  
  const startDebate = async () => {
    setRunningDebate(true);
    setDebateError('');
    try {
      const res = await fetch(`/api/run/${runId}/debate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        // Navigate to loading page
        window.location.href = `/run/${runId}/debate/loading`;
      } else {
        const data = await res.json().catch(() => ({}));
        setDebateError(data.error || 'Failed to start debate');
      }
    } catch (e) {
      setDebateError(e instanceof Error ? e.message : 'Failed to start debate');
    } finally {
      setRunningDebate(false);
    }
  };

  if (error || !summary) {
    return (
      <PageShell title="Debate Results" subtitle={`Run: ${runId}`}>
        <EmptyState
          title="Debate not run yet"
          description={error || 'Run the full debate stage to generate BUY / HOLD / SELL verdicts.'}
        />
        <div style={{ textAlign: 'center', marginTop: '2rem' }}>
          {debateError && <p style={{ color: 'var(--color-negative)', marginBottom: '1rem' }}>{debateError}</p>}
          <button
            onClick={startDebate}
            disabled={runningDebate}
            style={{
              padding: '12px 24px',
              backgroundColor: 'var(--color-accent)',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: '500',
              cursor: runningDebate ? 'not-allowed' : 'pointer',
              opacity: runningDebate ? 0.7 : 1
            }}
          >
            {runningDebate ? 'Starting Debate...' : '🚀 Run Full Debate'}
          </button>
          <p style={{ marginTop: '1rem', fontSize: '14px', color: 'var(--color-muted)' }}>
            This will analyze 30 RocketScore candidates (23 top + 5 edge + 2 best-of-worst) with AI agents
          </p>
        </div>
        <div style={{ textAlign: 'center', marginTop: '1rem' }}>
          <Link href={`/run/${runId}`} style={{ color: 'var(--color-accent)' }}>
            ← Back to Dashboard
          </Link>
        </div>
      </PageShell>
    );
  }
  
  const buyTickers = getFilteredTickers(summary.buy);
  const holdTickers = getFilteredTickers(summary.hold);
  const sellTickers = getFilteredTickers(summary.sell);
  
  return (
    <PageShell
      title="Debate Results"
      subtitle={`Multi-agent analysis for ${Object.keys(summary.byTicker).length} stocks`}
      actions={(
        <>
          <Link href={`/run/${runId}`} className={styles.actionBtn}>Dashboard</Link>
          <Link href={`/run/${runId}/final-buys`} className={styles.actionBtnPrimary}>View Final Buys</Link>
        </>
      )}
    >
      <div className={styles.toolbar}>
        <PillFilters
          options={filterOptions}
          value={filter}
          onChange={(v) => setFilter(v as FilterValue)}
        />
        <input
          className={styles.search}
          placeholder="Search ticker..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search tickers"
        />
      </div>
      <div className={styles.columns}>
          {/* BUY Column */}
          <div className={styles.column}>
            <div className={styles.columnHeader} style={{ borderColor: 'var(--color-verdict-buy)' }}>
              <h2>BUY</h2>
              <Badge variant="buy" size="sm">{buyTickers.length}</Badge>
            </div>
            <div className={styles.columnContent}>
              {buyTickers.map(ticker => (
                <StockCard 
                  key={ticker}
                  ticker={ticker}
                  data={summary.byTicker[ticker]}
                  runId={runId}
                />
              ))}
              {buyTickers.length === 0 && (
                <p className={styles.empty}>No stocks in this category</p>
              )}
            </div>
          </div>
          
          {/* HOLD Column */}
          <div className={styles.column}>
            <div className={styles.columnHeader} style={{ borderColor: 'var(--color-verdict-hold)' }}>
              <h2>HOLD</h2>
              <Badge variant="hold" size="sm">{holdTickers.length}</Badge>
            </div>
            <div className={styles.columnContent}>
              {holdTickers.map(ticker => (
                <StockCard 
                  key={ticker}
                  ticker={ticker}
                  data={summary.byTicker[ticker]}
                  runId={runId}
                />
              ))}
              {holdTickers.length === 0 && (
                <p className={styles.empty}>No stocks in this category</p>
              )}
            </div>
          </div>
          
          {/* SELL Column */}
          <div className={styles.column}>
            <div className={styles.columnHeader} style={{ borderColor: 'var(--color-verdict-wait)' }}>
              <h2>SELL</h2>
              <Badge variant="danger" size="sm">{sellTickers.length}</Badge>
            </div>
            <div className={styles.columnContent}>
              {sellTickers.map(ticker => (
                <StockCard 
                  key={ticker}
                  ticker={ticker}
                  data={summary.byTicker[ticker]}
                  runId={runId}
                />
              ))}
              {sellTickers.length === 0 && (
                <p className={styles.empty}>No stocks in this category</p>
              )}
            </div>
          </div>
        </div>
    </PageShell>
  );
}

interface StockCardProps {
  ticker: string;
  data: {
    verdict: string;
    confidence: number;
    rocket_score: number;
    sector: string;
    tags?: string[];
  };
  runId: string;
}

function StockCard({ ticker, data, runId }: Omit<StockCardProps, 'onClick'>) {
  const href = `/run/${runId}/debate/${encodeURIComponent(ticker)}`;
  
  return (
    <Link href={href} className={styles.stockCardLink}>
      <Card variant="bordered" padding="sm" className={styles.stockCard}>
        <div className={styles.cardHeader}>
          <span className={styles.cardTicker}>{ticker}</span>
          <span className={styles.cardConfidence}>{data.confidence}%</span>
        </div>
        <div className={styles.cardBody}>
          <span className={styles.cardScore}>Score: {data.rocket_score.toFixed(1)}</span>
          <span className={styles.cardSector}>{data.sector}</span>
        </div>
        {data.tags && data.tags.length > 0 && (
          <div className={styles.cardTags}>
            {data.tags.slice(0, 2).map(tag => (
              <Badge key={tag} variant="default" size="sm">{tag}</Badge>
            ))}
          </div>
        )}
      </Card>
    </Link>
  );
}
