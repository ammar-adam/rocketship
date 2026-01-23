'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { PageShell } from '@/components/ui/PageShell';
import { Card, CardContent } from '@/components/ui/Card';
import { DataTable } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import styles from './final-buys.module.css';

interface FinalBuyItem extends Record<string, unknown> {
  ticker: string;
  confidence?: number;
  rocket_score?: number;
  rocket_rank?: number | null;
  sector?: string;
  tags?: string[];
}

interface FinalBuysData {
  runId: string;
  createdAt: string;
  selection: {
    total_buy: number;
    selected: number;
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
      <PageShell title="Final Buys" subtitle={`Run: ${runId}`}>
        <Card>
          <CardContent className={styles.loading}>Loading final selections...</CardContent>
        </Card>
      </PageShell>
    );
  }

  if (error || !data) {
    return (
      <PageShell title="Final Buys" subtitle={`Run: ${runId}`}>
        <EmptyState
          title="Final buys not ready"
          description={error || 'Run the full debate to select final buys.'}
          primaryAction={{ label: 'Run Full Debate', href: `/run/${runId}/debate/loading` }}
          secondaryAction={{ label: 'Back to Dashboard', href: `/run/${runId}` }}
        />
      </PageShell>
    );
  }

  const columns = [
    { key: 'ticker', label: 'Ticker' },
    { key: 'rocket_score', label: 'RocketScore', align: 'right' },
    { key: 'confidence', label: 'Judge Confidence', align: 'right' },
    { key: 'rocket_rank', label: 'RocketScore Rank', align: 'right' },
    { key: 'sector', label: 'Sector' },
    {
      key: 'tags',
      label: 'Tags',
      render: (row: FinalBuyItem) => (
        <div className={styles.tags}>
          {(row.tags || []).slice(0, 4).map((tag) => (
            <span key={tag} className={styles.tag}>{tag}</span>
          ))}
        </div>
      )
    }
  ];

  return (
    <PageShell
      title="Our 8–12 Highest Conviction RocketShips"
      subtitle="Selected from 25 debated stocks using agent consensus and conviction."
      actions={(
        <>
          <Link href={`/run/${runId}/debate`} className={styles.actionBtn}>Back to Debate</Link>
          <Link href={`/run/${runId}/optimize`} className={styles.actionBtnPrimary}>Optimize Portfolio</Link>
        </>
      )}
    >
      <Card>
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
