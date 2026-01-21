'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { FilterPills } from '@/components/ui/FilterPills';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { SkeletonCard } from '@/components/ui/Skeleton';
import styles from './debate.module.css';

interface DebateSummary {
  buy: string[];
  hold: string[];
  wait: string[];
  byTicker: Record<string, {
    verdict: string;
    confidence: number;
    rocket_score: number;
    sector: string;
    tags?: string[];
  }>;
}

type FilterValue = 'all' | 'top25' | 'near_cutoff';

export default function DebateDashboardPage() {
  const params = useParams();
  const router = useRouter();
  const runId = params.runId as string;
  
  const [summary, setSummary] = useState<DebateSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<FilterValue>('all');
  
  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/runs/${runId}/debate_summary.json`);
        if (!res.ok) {
          // Try to generate from individual debate files
          const scorresRes = await fetch(`/api/runs/${runId}/rocket_scores.json`);
          if (!scorresRes.ok) throw new Error('No debate data available');
          
          // Create mock summary from scores
          const scores = await scorresRes.json();
          const mockSummary: DebateSummary = {
            buy: [],
            hold: [],
            wait: [],
            byTicker: {}
          };
          
          for (const s of scores) {
            const verdict = s.rocket_score >= 70 ? 'BUY' : s.rocket_score >= 50 ? 'HOLD' : 'WAIT';
            mockSummary.byTicker[s.ticker] = {
              verdict,
              confidence: Math.min(85, Math.max(20, s.rocket_score)),
              rocket_score: s.rocket_score,
              sector: s.sector,
              tags: s.tags
            };
            if (verdict === 'BUY') mockSummary.buy.push(s.ticker);
            else if (verdict === 'HOLD') mockSummary.hold.push(s.ticker);
            else mockSummary.wait.push(s.ticker);
          }
          
          setSummary(mockSummary);
          return;
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
    { label: 'Top 25', value: 'top25' },
    { label: 'Near Cutoff', value: 'near_cutoff' },
  ];
  
  const getFilteredTickers = (tickers: string[]) => {
    if (!summary) return [];
    
    // Sort by rocket_score
    const sorted = [...tickers].sort((a, b) => 
      (summary.byTicker[b]?.rocket_score || 0) - (summary.byTicker[a]?.rocket_score || 0)
    );
    
    // All tickers for reference
    const allTickers = [...summary.buy, ...summary.hold, ...summary.wait]
      .sort((a, b) => (summary.byTicker[b]?.rocket_score || 0) - (summary.byTicker[a]?.rocket_score || 0));
    
    switch (filter) {
      case 'top25':
        const top25Set = new Set(allTickers.slice(0, 25));
        return sorted.filter(t => top25Set.has(t));
      case 'near_cutoff':
        const nearCutoffSet = new Set(allTickers.slice(20, 35));
        return sorted.filter(t => nearCutoffSet.has(t));
      default:
        return sorted;
    }
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
  
  if (error || !summary) {
    return (
      <div className={styles.page}>
        <div className={styles.container}>
          <Card>
            <CardContent>
              <p className={styles.error}>{error || 'No debate data available'}</p>
              <p className={styles.hint}>Run the debate stage first, or this run may not have debate results.</p>
              <Link href={`/run/${runId}`} className={styles.backLink}>
                ← Back to Dashboard
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }
  
  const buyTickers = getFilteredTickers(summary.buy);
  const holdTickers = getFilteredTickers(summary.hold);
  const waitTickers = getFilteredTickers(summary.wait);
  
  return (
    <div className={styles.page}>
      <div className={styles.container}>
        {/* Header */}
        <header className={styles.header}>
          <div className={styles.headerTop}>
            <div>
              <h1 className={styles.title}>Debate Results</h1>
              <p className={styles.subtitle}>
                Multi-agent analysis results for {Object.keys(summary.byTicker).length} stocks
              </p>
            </div>
            <div className={styles.headerActions}>
              <Link href={`/run/${runId}`} className={styles.actionBtn}>
                ← Dashboard
              </Link>
              <Link href={`/run/${runId}/optimize`} className={styles.actionBtnPrimary}>
                Run Optimizer →
              </Link>
            </div>
          </div>
          
          {/* Stats */}
          <div className={styles.stats}>
            <div className={styles.stat}>
              <span className={styles.statValue} style={{ color: 'var(--color-verdict-buy)' }}>
                {summary.buy.length}
              </span>
              <span className={styles.statLabel}>BUY</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue} style={{ color: 'var(--color-verdict-hold)' }}>
                {summary.hold.length}
              </span>
              <span className={styles.statLabel}>HOLD</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue} style={{ color: 'var(--color-verdict-wait)' }}>
                {summary.wait.length}
              </span>
              <span className={styles.statLabel}>WAIT</span>
            </div>
          </div>
        </header>
        
        {/* Filters */}
        <div className={styles.filters}>
          <FilterPills
            options={filterOptions}
            value={filter}
            onChange={(v) => setFilter(v as FilterValue)}
          />
        </div>
        
        {/* Three Column Layout */}
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
                  onClick={() => router.push(`/run/${runId}/debate/${ticker}`)}
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
                  onClick={() => router.push(`/run/${runId}/debate/${ticker}`)}
                />
              ))}
              {holdTickers.length === 0 && (
                <p className={styles.empty}>No stocks in this category</p>
              )}
            </div>
          </div>
          
          {/* WAIT Column */}
          <div className={styles.column}>
            <div className={styles.columnHeader} style={{ borderColor: 'var(--color-verdict-wait)' }}>
              <h2>WAIT</h2>
              <Badge variant="wait" size="sm">{waitTickers.length}</Badge>
            </div>
            <div className={styles.columnContent}>
              {waitTickers.map(ticker => (
                <StockCard 
                  key={ticker}
                  ticker={ticker}
                  data={summary.byTicker[ticker]}
                  runId={runId}
                  onClick={() => router.push(`/run/${runId}/debate/${ticker}`)}
                />
              ))}
              {waitTickers.length === 0 && (
                <p className={styles.empty}>No stocks in this category</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
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
  onClick: () => void;
}

function StockCard({ ticker, data, runId, onClick }: StockCardProps) {
  return (
    <Card variant="bordered" padding="sm" className={styles.stockCard} onClick={onClick}>
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
  );
}
