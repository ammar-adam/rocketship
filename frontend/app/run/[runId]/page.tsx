'use client';

import { useEffect, useState, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { FilterPills } from '@/components/ui/FilterPills';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Table } from '@/components/ui/Table';
import { Collapsible } from '@/components/ui/Collapsible';
import { SkeletonTable } from '@/components/ui/Skeleton';
import styles from './dashboard.module.css';

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
  signal_labels?: string[];  // Labels derived from real signals
  macro_tags?: string[];     // Tags from macro trend matching
  data_sources?: string[];
  weights: {
    technical: number;
    volume: number;
    quality: number;
    macro: number;
  };
  technical_details?: {
    raw_metrics: Record<string, unknown>;
    rationale: string[];
  };
  volume_details?: {
    raw_metrics: Record<string, unknown>;
    rationale: string[];
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
  methodology?: {
    description: string;
    weights_explanation: string;
    tag_policy: string;
    data_sources: string[];
  };
}

interface SectorGroup {
  sector: string;
  count: number;
  avgScore: number;
  stocks: RocketScore[];
}

type FilterValue = 'all' | 'top25' | 'top50' | 'near_cutoff';

export default function DashboardPage() {
  const params = useParams();
  const router = useRouter();
  const runId = params.runId as string;
  
  const [data, setData] = useState<RocketScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<FilterValue>('all');
  const [expandedSectors, setExpandedSectors] = useState<Set<string>>(new Set());
  
  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`/api/runs/${runId}/rocket_scores.json`);
        if (!res.ok) throw new Error('Failed to load rocket scores');
        const json = await res.json();
        setData(json);
        // Auto-expand top 3 sectors
        const sorted = groupBySector(json).slice(0, 3).map(g => g.sector);
        setExpandedSectors(new Set(sorted));
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [runId]);
  
  function groupBySector(stocks: RocketScore[]): SectorGroup[] {
    const groups: Record<string, RocketScore[]> = {};
    for (const stock of stocks) {
      const sector = stock.sector || 'Unknown';
      if (!groups[sector]) groups[sector] = [];
      groups[sector].push(stock);
    }
    
    return Object.entries(groups)
      .map(([sector, stocks]) => ({
        sector,
        count: stocks.length,
        avgScore: stocks.reduce((sum, s) => sum + s.rocket_score, 0) / stocks.length,
        stocks: stocks.sort((a, b) => b.rocket_score - a.rocket_score)
      }))
      .sort((a, b) => b.avgScore - a.avgScore);
  }
  
  const filteredData = useMemo(() => {
    const sorted = [...data].sort((a, b) => b.rocket_score - a.rocket_score);
    switch (filter) {
      case 'top25': return sorted.slice(0, 25);
      case 'top50': return sorted.slice(0, 50);
      case 'near_cutoff': return sorted.slice(25, 50);
      default: return sorted;
    }
  }, [data, filter]);
  
  const sectorGroups = useMemo(() => groupBySector(filteredData), [filteredData]);
  
  const toggleSector = (sector: string) => {
    const next = new Set(expandedSectors);
    if (next.has(sector)) next.delete(sector);
    else next.add(sector);
    setExpandedSectors(next);
  };
  
  const filterOptions = [
    { label: 'All', value: 'all', count: data.length },
    { label: 'Top 25', value: 'top25', count: Math.min(25, data.length) },
    { label: 'Top 50', value: 'top50', count: Math.min(50, data.length) },
    { label: 'Near Cutoff', value: 'near_cutoff', count: Math.max(0, Math.min(25, data.length - 25)) },
  ];
  
  const columns = [
    {
      key: 'ticker',
      label: 'Ticker',
      sortable: true,
      render: (val: unknown, row: RocketScore) => (
        <Link href={`/run/${runId}/stock/${row.ticker}`} className={styles.tickerLink}>
          {row.ticker}
        </Link>
      )
    },
    {
      key: 'rocket_score',
      label: 'Score',
      sortable: true,
      align: 'right' as const,
      render: (val: unknown) => (
        <span className={styles.scoreCell}>{(val as number).toFixed(1)}</span>
      )
    },
    {
      key: 'technical_score',
      label: 'Tech',
      sortable: true,
      align: 'right' as const,
      render: (val: unknown) => <span className={styles.subScore}>{(val as number).toFixed(0)}</span>
    },
    {
      key: 'volume_score',
      label: 'Vol',
      sortable: true,
      align: 'right' as const,
      render: (val: unknown) => <span className={styles.subScore}>{(val as number).toFixed(0)}</span>
    },
    {
      key: 'quality_score',
      label: 'Qual',
      sortable: true,
      align: 'right' as const,
      render: (val: unknown) => <span className={styles.subScore}>{(val as number).toFixed(0)}</span>
    },
    {
      key: 'current_price',
      label: 'Price',
      sortable: true,
      align: 'right' as const,
      render: (val: unknown) => val ? `$${(val as number).toFixed(2)}` : '—'
    },
    {
      key: 'tags',
      label: 'Labels',
      render: (val: unknown, row: RocketScore) => {
        // Prefer signal_labels (real measurable), then fall back to tags
        const labels = row.signal_labels || row.tags || [];
        if (labels.length === 0) return '—';
        return (
          <div className={styles.tags}>
            {labels.slice(0, 2).map(label => (
              <Badge key={label} variant="default" size="sm">{label}</Badge>
            ))}
          </div>
        );
      }
    },
    {
      key: 'action',
      label: '',
      width: '60px',
      render: (_: unknown, row: RocketScore) => (
        <Link href={`/run/${runId}/stock/${row.ticker}`} className={styles.viewBtn}>
          View
        </Link>
      )
    }
  ];
  
  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.container}>
          <header className={styles.header}>
            <h1>RocketShip Dashboard</h1>
            <p>Loading...</p>
          </header>
          <SkeletonTable rows={10} cols={6} />
        </div>
      </div>
    );
  }
  
  if (error) {
    return (
      <div className={styles.page}>
        <div className={styles.container}>
          <Card>
            <CardContent>
              <p className={styles.error}>{error}</p>
              <Link href="/setup" className={styles.retryLink}>← Start New Analysis</Link>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }
  
  return (
    <div className={styles.page}>
      <div className={styles.container}>
        {/* Header */}
        <header className={styles.header}>
          <div className={styles.headerTop}>
            <div>
              <h1 className={styles.title}>RocketScore Results</h1>
              <p className={styles.subtitle}>
                Run: {runId} • {data.length} stocks analyzed
              </p>
            </div>
            <div className={styles.headerActions}>
              <Link href={`/run/${runId}/debate`} className={styles.actionBtn}>
                View Debate →
              </Link>
            </div>
          </div>
        </header>
        
        <div className={styles.layout}>
          {/* Sidebar */}
          <aside className={styles.sidebar}>
            <Card padding="md">
              <CardHeader>
                <CardTitle>How RocketScore Works</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={styles.explanation}>
                  RocketScore combines multiple quantitative factors to identify stocks with strong momentum characteristics.
                </p>
                
                <div className={styles.weights}>
                  <h4>Weights</h4>
                  <div className={styles.weightRow}>
                    <span>Technical</span>
                    <span className={styles.weightValue}>45%</span>
                  </div>
                  <div className={styles.weightRow}>
                    <span>Volume</span>
                    <span className={styles.weightValue}>25%</span>
                  </div>
                  <div className={styles.weightRow}>
                    <span>Quality</span>
                    <span className={styles.weightValue}>20%</span>
                  </div>
                  <div className={styles.weightRow}>
                    <span>Macro</span>
                    <span className={styles.weightValue}>10%</span>
                  </div>
                </div>
                
                <div className={styles.formula}>
                  <h4>Formula</h4>
                  <code>
                    Score = 0.45×Tech + 0.25×Vol + 0.20×Qual + 0.10×Macro + TagBonus
                  </code>
                  <p className={styles.note}>Tags add max +2 points</p>
                </div>
              </CardContent>
            </Card>
            
            <Collapsible title="Data Sources" defaultOpen={false}>
              <ul className={styles.sourcesList}>
                <li>yfinance price/volume data</li>
                <li>yfinance fundamentals (when available)</li>
                <li>Internal computations</li>
              </ul>
            </Collapsible>
          </aside>
          
          {/* Main Content */}
          <main className={styles.main}>
            {/* Filters */}
            <div className={styles.filters}>
              <FilterPills
                options={filterOptions}
                value={filter}
                onChange={(v) => setFilter(v as FilterValue)}
              />
            </div>
            
            {/* Sector Groups */}
            <div className={styles.sectors}>
              {sectorGroups.map((group) => (
                <div key={group.sector} className={styles.sectorGroup}>
                  <button
                    className={styles.sectorHeader}
                    onClick={() => toggleSector(group.sector)}
                  >
                    <div className={styles.sectorInfo}>
                      <span className={styles.sectorName}>{group.sector}</span>
                      <Badge variant="default" size="sm">
                        {group.count} stock{group.count !== 1 ? 's' : ''}
                      </Badge>
                      <span className={styles.avgScore}>
                        Avg: {group.avgScore.toFixed(1)}
                      </span>
                    </div>
                    <span className={`${styles.chevron} ${expandedSectors.has(group.sector) ? styles.chevronOpen : ''}`}>
                      ▶
                    </span>
                  </button>
                  
                  {expandedSectors.has(group.sector) && (
                    <div className={styles.sectorContent}>
                      <Table
                        columns={columns}
                        data={group.stocks}
                        rowKey="ticker"
                        onRowClick={(row) => router.push(`/run/${runId}/stock/${row.ticker}`)}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
