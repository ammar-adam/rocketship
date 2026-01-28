'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { PageShell } from '@/components/ui/PageShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { KpiTiles } from '@/components/ui/KpiTiles';
import { EmptyState } from '@/components/ui/EmptyState';
import styles from './final-buys.module.css';

interface FinalBuyItem extends Record<string, unknown> {
  ticker: string;
  confidence?: number;
  rocket_score?: number;
  rocket_rank?: number | null;
  sector?: string;
  tags?: string[];
  selection_group?: string;
}

interface FinalBuysData {
  runId: string;
  createdAt: string;
  selection: {
    total_buy: number;
    selected: number;
  };
  meta?: {
    generatedAt: string;
    count: number;
    selection_groups_breakdown?: {
      top23: number;
      edge: number;
      best_of_worst: number;
      extra: number;
    };
  };
  items: FinalBuyItem[];
}

export default function FinalBuysPage() {
  const params = useParams();
  const runId = params.runId as string;
  const [data, setData] = useState<FinalBuysData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/runs/${runId}/final_buys.json`);
        if (!res.ok) throw new Error('Final buys not available');
        const json = await res.json();
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load final buys');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [runId]);

  if (loading) {
    return (
      <PageShell title="Final Buy Candidates" subtitle={`Run: ${runId}`}>
        <Card>
          <CardContent className={styles.loading}>Loading final selections...</CardContent>
        </Card>
      </PageShell>
    );
  }

  if (error || !data) {
    return (
      <PageShell title="Final Buy Candidates" subtitle={`Run: ${runId}`}>
        <EmptyState
          title="Final buys not ready"
          description={error || 'Run the full debate to select final buys.'}
          primaryAction={{ label: 'Run Full Debate', href: `/run/${runId}/debate/loading` }}
          secondaryAction={{ label: 'Back to Dashboard', href: `/run/${runId}` }}
        />
      </PageShell>
    );
  }

  const getGroupBadgeClass = (group?: string) => {
    switch (group) {
      case 'top23': return styles.groupTop;
      case 'edge': return styles.groupNear;
      case 'best_of_worst': return styles.groupBest;
      case 'extra': return styles.groupExtra;
      default: return '';
    }
  };

  const getGroupLabel = (group?: string) => {
    switch (group) {
      case 'top23': return 'Top 23';
      case 'edge': return 'Edge Cases';
      case 'best_of_worst': return 'Best of Worst';
      case 'extra': return 'User Added';
      default: return '';
    }
  };

  const columns = [
    {
      key: 'ticker',
      label: 'Ticker',
      render: (_value: unknown, row: FinalBuyItem) => (
        <Link href={`/run/${runId}/debate/${row.ticker}`} className={styles.tickerLink}>
          {row.ticker}
        </Link>
      )
    },
    {
      key: 'rocket_score',
      label: 'RocketScore',
      align: 'right' as const,
      render: (_value: unknown, row: FinalBuyItem) => (
        <span className={styles.score}>{row.rocket_score?.toFixed(1) || '—'}</span>
      )
    },
    {
      key: 'confidence',
      label: 'Judge Confidence',
      align: 'right' as const,
      render: (_value: unknown, row: FinalBuyItem) => (
        <div className={styles.confidenceCell}>
          <div className={styles.confidenceBar}>
            <div
              className={styles.confidenceFill}
              style={{ width: `${row.confidence || 0}%` }}
            />
          </div>
          <span>{row.confidence || 0}%</span>
        </div>
      )
    },
    {
      key: 'rocket_rank',
      label: 'Rank',
      align: 'right' as const,
      render: (_value: unknown, row: FinalBuyItem) => (
        <span className={styles.rank}>#{row.rocket_rank || '—'}</span>
      )
    },
    { key: 'sector', label: 'Sector' },
    {
      key: 'selection_group',
      label: 'Source',
      render: (_value: unknown, row: FinalBuyItem) => (
        <span className={`${styles.groupBadge} ${getGroupBadgeClass(row.selection_group)}`}>
          {getGroupLabel(row.selection_group)}
        </span>
      )
    },
    {
      key: 'tags',
      label: 'Tags',
      render: (_value: unknown, row: FinalBuyItem) => (
        <div className={styles.tags}>
          {(row.tags || []).slice(0, 3).map((tag) => (
            <span key={tag} className={styles.tag}>{tag}</span>
          ))}
        </div>
      )
    }
  ];

  // Group by sector for summary
  const sectorCounts = data.items.reduce<Record<string, number>>((acc, item) => {
    const sector = item.sector || 'Unknown';
    acc[sector] = (acc[sector] || 0) + 1;
    return acc;
  }, {});

  const topSectors = Object.entries(sectorCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([sector, count]) => `${sector} (${count})`)
    .join(', ');

  const avgConfidence = data.items.length > 0
    ? (data.items.reduce((sum, item) => sum + (item.confidence || 0), 0) / data.items.length).toFixed(0)
    : '0';

  const avgRocketScore = data.items.length > 0
    ? (data.items.reduce((sum, item) => sum + (item.rocket_score || 0), 0) / data.items.length).toFixed(1)
    : '0';

  return (
    <PageShell
      title="Final Buy Candidates"
      subtitle={`${data.items.length} stocks selected for portfolio optimization`}
      actions={(
        <>
          <Link href={`/run/${runId}/debate`} className={styles.actionBtn}>Back to Debate</Link>
          <Link href={`/run/${runId}/optimize`} className={styles.actionBtnPrimary}>
            Optimize Portfolio
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M6 12L10 8L6 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </Link>
        </>
      )}
    >
      {/* Explainer */}
      <Card className={styles.explainerCard}>
        <CardContent>
          <div className={styles.explainer}>
            <div className={styles.explainerIcon}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="9 11 12 14 22 4"/>
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
              </svg>
            </div>
            <div>
              <h3 className={styles.explainerTitle}>These BUY-rated stocks will be optimized</h3>
              <p className={styles.explainerText}>
                The convex optimizer will allocate your ${(10000).toLocaleString()} capital across these {data.items.length} stocks,
                respecting max 12% per position and 35% per sector constraints. The optimizer maximizes
                expected return while penalizing portfolio risk.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI Summary */}
      <KpiTiles items={[
        { label: 'Total BUYs', value: data.selection.total_buy },
        { label: 'Selected', value: data.items.length },
        { label: 'Avg Confidence', value: `${avgConfidence}%` },
        { label: 'Avg RocketScore', value: avgRocketScore },
        { label: 'Top Sectors', value: topSectors || 'N/A' }
      ]} />

      {/* Selection Breakdown */}
      {data.meta?.selection_groups_breakdown && (
        <Card>
          <CardHeader>
            <CardTitle>Selection Sources</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={styles.sourceBreakdown}>
              {data.meta.selection_groups_breakdown.top23 > 0 && (
                <div className={styles.sourceItem}>
                  <span className={`${styles.sourceDot} ${styles.sourceTop}`} />
                  <span className={styles.sourceLabel}>Top 23</span>
                  <span className={styles.sourceCount}>{data.meta.selection_groups_breakdown.top23}</span>
                </div>
              )}
              {data.meta.selection_groups_breakdown.edge > 0 && (
                <div className={styles.sourceItem}>
                  <span className={`${styles.sourceDot} ${styles.sourceNear}`} />
                  <span className={styles.sourceLabel}>Edge Cases</span>
                  <span className={styles.sourceCount}>{data.meta.selection_groups_breakdown.edge}</span>
                </div>
              )}
              {data.meta.selection_groups_breakdown.best_of_worst > 0 && (
                <div className={styles.sourceItem}>
                  <span className={`${styles.sourceDot} ${styles.sourceBest}`} />
                  <span className={styles.sourceLabel}>Best of Worst</span>
                  <span className={styles.sourceCount}>{data.meta.selection_groups_breakdown.best_of_worst}</span>
                </div>
              )}
              {data.meta.selection_groups_breakdown.extra > 0 && (
                <div className={styles.sourceItem}>
                  <span className={`${styles.sourceDot} ${styles.sourceExtra}`} />
                  <span className={styles.sourceLabel}>User Added</span>
                  <span className={styles.sourceCount}>{data.meta.selection_groups_breakdown.extra}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Data Table */}
      <Card>
        <CardHeader>
          <CardTitle>Buy Candidates</CardTitle>
        </CardHeader>
        <CardContent className={styles.tableWrap}>
          <DataTable
            columns={columns}
            data={data.items}
            rowKey="ticker"
            onRowClick={(row) => {
              if (row.ticker) {
                window.location.href = `/run/${runId}/debate/${encodeURIComponent(row.ticker)}`;
              }
            }}
          />
        </CardContent>
      </Card>
    </PageShell>
  );
}
