'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Collapsible } from '@/components/ui/Collapsible';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { PageShell } from '@/components/ui/PageShell';
import { EmptyState } from '@/components/ui/EmptyState';
import styles from './stock.module.css';

interface RocketScore {
  ticker: string;
  rocket_score: number;
  technical_score: number;
  volume_score: number;
  quality_score: number;
  macro_score: number;
  sector: string;
  current_price: number;
  tags: string[];
  weights: {
    technical: number;
    volume: number;
    quality: number;
    macro: number;
  };
  technical_details?: {
    raw_metrics: Record<string, unknown>;
    rationale: string[];
    sub_scores?: Record<string, number>;
  };
  volume_details?: {
    raw_metrics: Record<string, unknown>;
    rationale: string[];
    sub_scores?: Record<string, number>;
  };
  quality_details?: {
    raw_metrics: Record<string, unknown>;
    rationale: string[];
    warnings?: string[];
  };
  macro_details?: {
    raw_metrics: Record<string, unknown>;
    rationale: string[];
    matched_trends?: Array<{ name: string; confidence: number; thesis: string }>;
  };
  weighted_score_before_tags?: number;
  tag_bonus?: number;
  methodology?: {
    description: string;
    weights_explanation: string;
    tag_policy: string;
    data_sources: string[];
  };
}

interface DebateData {
  ticker: string;
  agents: {
    bull?: unknown;
    bear?: unknown;
    regime?: unknown;
    volume?: unknown;
  };
  judge?: {
    verdict: string;
    confidence: number;
    executive_summary: string;
  };
  warnings?: string[];
}

export default function StockDetailPage() {
  const params = useParams();
  const runId = params.runId as string;
  const ticker = params.ticker as string;
  
  const [scoreData, setScoreData] = useState<RocketScore | null>(null);
  const [debateData, setDebateData] = useState<DebateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  useEffect(() => {
    async function fetchData() {
      try {
        // Fetch rocket scores
        const scoresRes = await fetch(`/api/runs/${runId}/rocket_scores.json`);
        if (scoresRes.ok) {
          const scores: RocketScore[] = await scoresRes.json();
          const found = scores.find(s => s.ticker.toUpperCase() === ticker.toUpperCase());
          if (found) setScoreData(found);
        }
        
        // Try to fetch debate data
        try {
          const debateRes = await fetch(`/api/runs/${runId}/debate/${ticker}.json`);
          if (debateRes.ok) {
            const debate = await debateRes.json();
            setDebateData(debate);
          }
        } catch {
          // Debate not available, that's fine
        }
        
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [runId, ticker]);
  
  if (loading) {
    return (
      <PageShell title="Stock Detail" subtitle={`${ticker} • Run ${runId}`}>
        <SkeletonCard />
        <SkeletonCard />
      </PageShell>
    );
  }
  
  if (error || !scoreData) {
    return (
      <PageShell title="Stock Detail" subtitle={`${ticker} • Run ${runId}`}>
        <EmptyState
          title="Stock data not available"
          description={error || `No data found for ${ticker}`}
          secondaryAction={{ label: 'Back to Dashboard', href: `/run/${runId}` }}
        />
      </PageShell>
    );
  }
  
  const techMetrics = scoreData.technical_details?.raw_metrics || {};
  const volMetrics = scoreData.volume_details?.raw_metrics || {};
  const qualMetrics = scoreData.quality_details?.raw_metrics || {};
  
  return (
    <PageShell title={`${ticker} — RocketScore`} subtitle={`Sector: ${scoreData.sector}`}>
        {/* Breadcrumb */}
        <nav className={styles.breadcrumb}>
          <Link href={`/run/${runId}`}>Dashboard</Link>
          <span>/</span>
          <span>{ticker}</span>
        </nav>
        
        {/* Header */}
        <header className={styles.header}>
          <div className={styles.headerMain}>
            <h1 className={styles.ticker}>{scoreData.ticker}</h1>
            <span className={styles.sector}>{scoreData.sector || 'Unknown'}</span>
          </div>
          <div className={styles.headerScore}>
            <span className={styles.scoreLabel}>RocketScore</span>
            <span className={styles.scoreValue}>{scoreData.rocket_score.toFixed(1)}</span>
          </div>
        </header>
        
        {/* Debate Verdict (if available) */}
        {debateData?.judge && (
          <Card variant="elevated" className={styles.verdictCard}>
            <CardContent>
              <div className={styles.verdictHeader}>
                <Badge 
                  variant={debateData.judge.verdict === 'BUY' ? 'buy' : debateData.judge.verdict === 'HOLD' ? 'hold' : 'wait'}
                  size="md"
                >
                  {debateData.judge.verdict}
                </Badge>
                <span className={styles.confidence}>
                  {debateData.judge.confidence}% confidence
                </span>
              </div>
              <p className={styles.verdictSummary}>
                {debateData.judge.executive_summary}
              </p>
              <Link href={`/run/${runId}/debate/${ticker}`} className={styles.debateLink}>
                View Full Debate →
              </Link>
            </CardContent>
          </Card>
        )}
        
        <div className={styles.layout}>
          {/* Score Breakdown */}
          <div className={styles.column}>
            <Card>
              <CardHeader>
                <CardTitle>Score Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className={styles.scoreBreakdown}>
                  <ScoreRow 
                    label="Technical" 
                    score={scoreData.technical_score} 
                    weight={45}
                    tooltip="Price momentum, trend slope, drawdown"
                  />
                  <ScoreRow 
                    label="Volume" 
                    score={scoreData.volume_score} 
                    weight={25}
                    tooltip="Flow signals, accumulation patterns"
                  />
                  <ScoreRow 
                    label="Quality" 
                    score={scoreData.quality_score} 
                    weight={20}
                    tooltip="Operating margins, revenue growth"
                  />
                  <ScoreRow 
                    label="Macro" 
                    score={scoreData.macro_score} 
                    weight={10}
                    tooltip="Sector alignment with macro themes"
                  />
                  
                  <div className={styles.divider} />
                  
                  <div className={styles.totalRow}>
                    <span>Weighted Total</span>
                    <span className={styles.totalValue}>
                      {scoreData.weighted_score_before_tags?.toFixed(1) || (scoreData.rocket_score - (scoreData.tag_bonus || 0)).toFixed(1)}
                    </span>
                  </div>
                  
                  {(scoreData.tag_bonus || 0) > 0 && (
                    <div className={styles.bonusRow}>
                      <span>Tag Bonus</span>
                      <span>+{scoreData.tag_bonus}</span>
                    </div>
                  )}
                  
                  <div className={styles.finalRow}>
                    <span>Final Score</span>
                    <span className={styles.finalValue}>{scoreData.rocket_score.toFixed(1)}</span>
                  </div>
                </div>
                
                {scoreData.tags && scoreData.tags.length > 0 && (
                  <div className={styles.tags}>
                    <span className={styles.tagsLabel}>Tags:</span>
                    {scoreData.tags.map(tag => (
                      <Badge key={tag} variant="default" size="sm">{tag}</Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
            
            {/* Technical Details */}
            <Collapsible title="Technical Metrics" defaultOpen={true}>
              <div className={styles.metricsGrid}>
                <MetricItem label="1M Return" value={`${techMetrics.return_1m_pct ?? 'N/A'}%`} />
                <MetricItem label="3M Return" value={`${techMetrics.return_3m_pct ?? 'N/A'}%`} />
                <MetricItem label="6M Return" value={`${techMetrics.return_6m_pct ?? 'N/A'}%`} />
                <MetricItem label="1Y Return" value={`${techMetrics.return_1y_pct ?? 'N/A'}%`} />
                <MetricItem label="Trend Slope" value={`${techMetrics.trend_slope_annualized ?? 'N/A'}%`} />
                <MetricItem label="Drawdown" value={`${techMetrics.drawdown_from_52w_high_pct ?? 'N/A'}%`} />
                <MetricItem label="Above SMA50" value={techMetrics.above_sma50 ? 'Yes' : 'No'} />
                <MetricItem label="Golden Cross" value={techMetrics.golden_cross ? 'Yes' : 'No'} />
              </div>
              {scoreData.technical_details?.rationale && (
                <ul className={styles.rationale}>
                  {scoreData.technical_details.rationale.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </Collapsible>
            
            {/* Volume Details */}
            <Collapsible title="Volume Metrics">
              <div className={styles.metricsGrid}>
                <MetricItem label="Volume Surge" value={`${volMetrics.volume_surge_ratio ?? 'N/A'}x`} />
                <MetricItem label="Volume Z-Score" value={`${volMetrics.volume_zscore_10d ?? 'N/A'}`} />
                <MetricItem label="Up/Down Ratio" value={`${volMetrics.up_down_volume_ratio_20d ?? 'N/A'}`} />
                <MetricItem label="Avg Daily Vol" value={typeof volMetrics.avg_daily_volume_20d === 'number' ? volMetrics.avg_daily_volume_20d.toLocaleString() : 'N/A'} />
              </div>
              {scoreData.volume_details?.rationale && (
                <ul className={styles.rationale}>
                  {scoreData.volume_details.rationale.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </Collapsible>
          </div>
          
          {/* Right Column */}
          <div className={styles.column}>
            {/* Quality Details */}
            <Collapsible title="Quality / Fundamentals" defaultOpen={true}>
              <div className={styles.metricsGrid}>
                <MetricItem label="Operating Margin" value={qualMetrics.operating_margin !== undefined ? `${qualMetrics.operating_margin}%` : 'N/A'} />
                <MetricItem label="Gross Margin" value={qualMetrics.gross_margin !== undefined ? `${qualMetrics.gross_margin}%` : 'N/A'} />
                <MetricItem label="Revenue Growth" value={qualMetrics.revenue_growth !== undefined ? `${qualMetrics.revenue_growth}%` : 'N/A'} />
                <MetricItem label="Profit Margin" value={qualMetrics.profit_margin !== undefined ? `${qualMetrics.profit_margin}%` : 'N/A'} />
                <MetricItem label="FCF Yield" value={qualMetrics.fcf_yield !== undefined ? `${qualMetrics.fcf_yield}%` : 'N/A'} />
              </div>
              {scoreData.quality_details?.warnings && scoreData.quality_details.warnings.length > 0 && (
                <div className={styles.warnings}>
                  {scoreData.quality_details.warnings.map((w, i) => (
                    <p key={i} className={styles.warning}>{w}</p>
                  ))}
                </div>
              )}
              {scoreData.quality_details?.rationale && (
                <ul className={styles.rationale}>
                  {scoreData.quality_details.rationale.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </Collapsible>
            
            {/* Macro Details */}
            <Collapsible title="Macro / Sector Alignment">
              <div className={styles.metricsGrid}>
                <MetricItem label="Sector" value={scoreData.sector || 'Unknown'} />
                <MetricItem label="Macro Score" value={`${scoreData.macro_score}/100`} />
              </div>
              {scoreData.macro_details?.matched_trends && scoreData.macro_details.matched_trends.length > 0 && (
                <div className={styles.trends}>
                  <h5>Matched Themes</h5>
                  {scoreData.macro_details.matched_trends.map((trend, i) => (
                    <div key={i} className={styles.trend}>
                      <span className={styles.trendName}>{trend.name}</span>
                      <span className={styles.trendConf}>{trend.confidence}%</span>
                    </div>
                  ))}
                </div>
              )}
              {scoreData.macro_details?.rationale && (
                <ul className={styles.rationale}>
                  {scoreData.macro_details.rationale.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </Collapsible>
            
            {/* Raw JSON */}
            <Collapsible title="Raw JSON">
              <pre className={styles.json}>
                {JSON.stringify(scoreData, null, 2)}
              </pre>
            </Collapsible>
          </div>
        </div>
    </PageShell>
  );
}

function ScoreRow({ label, score, weight, tooltip }: { label: string; score: number; weight: number; tooltip?: string }) {
  const pct = Math.min(100, Math.max(0, score));
  return (
    <div className={styles.scoreRow} title={tooltip}>
      <div className={styles.scoreRowHeader}>
        <span className={styles.scoreRowLabel}>{label}</span>
        <span className={styles.scoreRowWeight}>{weight}%</span>
        <span className={styles.scoreRowValue}>{score.toFixed(1)}</span>
      </div>
      <div className={styles.scoreBar}>
        <div className={styles.scoreBarFill} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function MetricItem({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metricItem}>
      <span className={styles.metricLabel}>{label}</span>
      <span className={styles.metricValue}>{value}</span>
    </div>
  );
}
