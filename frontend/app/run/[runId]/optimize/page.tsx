'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Collapsible } from '@/components/ui/Collapsible';
import { SkeletonCard, SkeletonTable } from '@/components/ui/Skeleton';
import { PageShell } from '@/components/ui/PageShell';
import { KpiTiles } from '@/components/ui/KpiTiles';
import { DataTable } from '@/components/ui/DataTable';
import { ChartCard } from '@/components/ui/ChartCard';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell
} from 'recharts';
import styles from './optimize.module.css';

// Sector colors for pie chart
const SECTOR_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#84cc16', // lime
  '#f97316', // orange
  '#6366f1', // indigo
];

interface Allocation extends Record<string, unknown> {
  ticker: string;
  weight: number;
  dollars: number;
  sector: string;
  rocket_score: number;
  expected_return_proxy: number;
  price?: number;
}

interface SectorBreakdown {
  sector: string;
  weight: number;
}

interface Backtest {
  total_return_pct: number;
  annualized_vol_pct: number;
  sharpe_ratio: number;
  max_drawdown_pct: number;
  series?: {
    dates: string[];
    optimized: number[];
    equal_weight: number[];
    spy: number[] | null;
  };
}

interface Portfolio {
  capital: number;
  constraints: {
    max_weight: number;
    sector_cap: number;
    min_positions: number;
    max_positions: number;
  };
  optimization_params: Record<string, unknown>;
  allocations: Allocation[];
  sector_breakdown: SectorBreakdown[];
  summary: {
    positions: number;
    cash_weight: number;
    avg_rocket_score: number;
  };
  backtest: Backtest | null;
  methodology: {
    optimizer: string;
    constraints: string[];
  };
}

interface FinalBuyItem {
  ticker: string;
  confidence?: number;
  rocket_score?: number;
  sector?: string;
  tags?: string[];
}

interface FinalBuysData {
  items: FinalBuyItem[];
}

export default function OptimizationPage() {
  const params = useParams();
  const runId = params.runId as string;
  
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [finalBuys, setFinalBuys] = useState<FinalBuyItem[]>([]);
  const [finalBuysError, setFinalBuysError] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [chartTimeframe, setChartTimeframe] = useState<'6m' | '1y' | '5y'>('6m');
  
  const fetchPortfolio = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${runId}/portfolio.json`);
      if (!res.ok) {
        throw new Error('Portfolio not yet generated. Run optimization first.');
      }
      const data = await res.json();
      setPortfolio(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load portfolio');
    } finally {
      setLoading(false);
    }
  }, [runId]);

  const fetchFinalBuys = useCallback(async () => {
    try {
      const res = await fetch(`/api/runs/${runId}/final_buys.json`);
      if (!res.ok) throw new Error('Final buys not available');
      const data: FinalBuysData = await res.json();
      setFinalBuys(data.items || []);
      setFinalBuysError('');
    } catch (e) {
      setFinalBuysError(e instanceof Error ? e.message : 'Failed to load final buys');
    }
  }, [runId]);
  
  useEffect(() => {
    fetchPortfolio();
    fetchFinalBuys();
  }, [fetchPortfolio, fetchFinalBuys]);
  
  async function runOptimization() {
    if (finalBuys.length === 0) {
      setError('Final buys not available. Run the full debate first.');
      return;
    }
    setRunning(true);
    setError('');
    
    const params = {
      capital: 10000,
      max_weight: 0.12,
      sector_cap: 0.35,
      min_positions: 8,
      max_positions: 12
    };
    
    try {
      const res = await fetch(`/api/run/${runId}/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
      
      let data: { error?: string };
      try {
        data = await res.json();
      } catch {
        throw new Error('Invalid response from optimizer');
      }
      
      if (!res.ok) {
        throw new Error(data?.error || `Optimization failed (${res.status})`);
      }
      
      // Poll status until done or error (optimizer runs in background)
      let finished = false;
      while (!finished) {
        try {
          const s = await fetch(`/api/run/${runId}/status`);
          const st = await s.json();
          if (st.stage === 'done') {
            await fetchPortfolio();
            finished = true;
          } else if (st.stage === 'error') {
            setError(st.errors?.join(', ') || 'Optimization failed');
            finished = true;
          } else {
            await new Promise((r) => setTimeout(r, 1000));
          }
        } catch {
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : 'Optimization failed';
      setError(errMsg);
    } finally {
      setRunning(false);
    }
  }
  
  const columns = [
    {
      key: 'ticker',
      label: 'Ticker',
      render: (val: unknown) => (
        <Link href={`/run/${runId}/stock/${val}`} className={styles.tickerLink}>
          {val as string}
        </Link>
      )
    },
    {
      key: 'weight',
      label: 'Weight',
      align: 'right' as const,
      render: (val: unknown) => `${((val as number) * 100).toFixed(1)}%`
    },
    {
      key: 'dollars',
      label: 'Dollars',
      align: 'right' as const,
      render: (val: unknown) => `$${(val as number).toFixed(0)}`
    },
    {
      key: 'price',
      label: 'Price',
      align: 'right' as const,
      render: (val: unknown) => (typeof val === 'number' ? `$${val.toFixed(2)}` : '—')
    },
    {
      key: 'sector',
      label: 'Sector',
    },
    {
      key: 'rocket_score',
      label: 'Score',
      align: 'right' as const,
      render: (val: unknown) => (val as number).toFixed(1)
    }
  ];
  
  if (loading) {
    return (
      <PageShell title="Portfolio Optimization" subtitle={`Run: ${runId}`}>
        <SkeletonCard />
        <SkeletonTable rows={8} cols={5} />
      </PageShell>
    );
  }
  
  if (!portfolio && finalBuysError) {
    return (
      <PageShell title="Portfolio Optimization" subtitle={`Run: ${runId}`}>
        <EmptyState
          title="Final buys not ready"
          description={finalBuysError}
          primaryAction={{ label: 'Run Full Debate', href: `/run/${runId}/debate/loading` }}
          secondaryAction={{ label: 'Back to Dashboard', href: `/run/${runId}` }}
        />
      </PageShell>
    );
  }

  // No portfolio yet - show run button
  if (!portfolio) {
    return (
      <PageShell title="Portfolio Optimization" subtitle={`Run: ${runId}`}>
        <EmptyState
          title="Optimization not run yet"
          description={`Run optimization on the ${finalBuys.length} final buys to generate a constrained portfolio.`}
          secondaryAction={{ label: 'Back to Final Buys', href: `/run/${runId}/final-buys` }}
        />
        {error && <p className={styles.error}>{error}</p>}
        <div className={styles.actionRow}>
          <button 
            className={styles.runBtn}
            onClick={runOptimization}
            disabled={running || finalBuys.length === 0}
          >
            {running ? 'Running Optimization...' : 'Run Optimizer'}
          </button>
        </div>
      </PageShell>
    );
  }
  
  return (
    <PageShell
      title="Optimized Portfolio"
      subtitle={`Run: ${runId}`}
      actions={
        <>
          <Link href={`/run/${runId}/debate`} className={styles.actionBtn}>Debate</Link>
          <button className={styles.exportBtn} onClick={() => {
            const blob = new Blob([JSON.stringify(portfolio, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `portfolio_${runId}.json`;
            a.click();
          }}>
            Export JSON
          </button>
        </>
      }
    >
        
        <KpiTiles items={[
          { label: 'Capital', value: `$${portfolio.capital.toLocaleString()}` },
          { label: 'Positions', value: portfolio.summary.positions },
          { label: 'Cash', value: `${(portfolio.summary.cash_weight * 100).toFixed(1)}%` },
          { label: 'Avg Score', value: portfolio.summary.avg_rocket_score.toFixed(1) }
        ]} />
        
        <div className={styles.chartsRow}>
          <ChartCard title="Sector Allocation">
            <div className={styles.chartContainer}>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={portfolio.sector_breakdown.map(s => ({
                      name: s.sector,
                      value: s.weight * 100
                    }))}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, value }) => `${(name || '').slice(0, 8)}: ${value.toFixed(0)}%`}
                    labelLine={false}
                  >
                    {portfolio.sector_breakdown.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={SECTOR_COLORS[index % SECTOR_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value: number | undefined) => value !== undefined ? `${value.toFixed(1)}%` : ''}
                    contentStyle={{ 
                      backgroundColor: 'var(--color-bg-elevated)', 
                      border: '1px solid var(--color-border-subtle)',
                      borderRadius: '8px'
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </ChartCard>

          <ChartCard title="Top Holdings">
            <div className={styles.weightBars}>
              {portfolio.allocations.slice(0, 10).map((a) => (
                <div key={a.ticker} className={styles.weightBar}>
                  <div className={styles.weightBarHeader}>
                    <span className={styles.weightTicker}>{a.ticker}</span>
                    <span>{(a.weight * 100).toFixed(1)}%</span>
                  </div>
                  <div className={styles.weightBarTrack}>
                    <div 
                      className={styles.weightBarFill} 
                      style={{ width: `${(a.weight / portfolio.allocations[0].weight) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </ChartCard>
        </div>
        
        {/* Backtest Metrics */}
        {portfolio.backtest && (
          <Card className={styles.backtestCard}>
            <CardHeader>
              <div className={styles.backtestHeader}>
                <CardTitle>Backtest Metrics</CardTitle>
                <div className={styles.timeframeSelector}>
                  {(['6m', '1y', '5y'] as const).map((tf) => (
                    <button
                      key={tf}
                      className={`${styles.timeframeBtn} ${chartTimeframe === tf ? styles.timeframeBtnActive : ''}`}
                      onClick={() => setChartTimeframe(tf)}
                    >
                      {tf.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className={styles.backtestMetrics}>
                <div className={styles.backtestMetric}>
                  <span className={styles.backtestValue}>{portfolio.backtest.total_return_pct.toFixed(1)}%</span>
                  <span className={styles.backtestLabel}>Total Return</span>
                </div>
                <div className={styles.backtestMetric}>
                  <span className={styles.backtestValue}>{portfolio.backtest.annualized_vol_pct.toFixed(1)}%</span>
                  <span className={styles.backtestLabel}>Volatility</span>
                </div>
                <div className={styles.backtestMetric}>
                  <span className={styles.backtestValue}>{portfolio.backtest.sharpe_ratio.toFixed(2)}</span>
                  <span className={styles.backtestLabel}>Sharpe Ratio</span>
                </div>
                <div className={styles.backtestMetric}>
                  <span className={styles.backtestValue}>{portfolio.backtest.max_drawdown_pct.toFixed(1)}%</span>
                  <span className={styles.backtestLabel}>Max Drawdown</span>
                </div>
              </div>
              
              {portfolio.backtest.series && (() => {
                // Filter data based on selected timeframe
                const totalDays = portfolio.backtest!.series!.dates.length;
                const daysToShow = chartTimeframe === '6m' ? Math.min(126, totalDays) :
                                   chartTimeframe === '1y' ? Math.min(252, totalDays) :
                                   totalDays; // 5y shows all
                const startIdx = Math.max(0, totalDays - daysToShow);
                
                const chartData = portfolio.backtest!.series!.dates.slice(startIdx).map((date, i) => ({
                  date: date.slice(5), // MM-DD format
                  optimized: (portfolio.backtest!.series!.optimized[startIdx + i] - 1) * 100,
                  equalWeight: (portfolio.backtest!.series!.equal_weight[startIdx + i] - 1) * 100,
                  spy: portfolio.backtest!.series!.spy ? (portfolio.backtest!.series!.spy[startIdx + i] - 1) * 100 : null
                }));
                
                return (
                <div className={styles.chartContainer}>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart
                      data={chartData}
                      margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-subtle)" />
                      <XAxis 
                        dataKey="date" 
                        stroke="var(--color-fg-tertiary)"
                        tick={{ fontSize: 11 }}
                        interval="preserveStartEnd"
                      />
                      <YAxis 
                        stroke="var(--color-fg-tertiary)"
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => `${v.toFixed(0)}%`}
                      />
                      <Tooltip 
                        formatter={(value: number | undefined) => value !== undefined ? `${value.toFixed(2)}%` : ''}
                        contentStyle={{ 
                          backgroundColor: 'var(--color-bg-elevated)', 
                          border: '1px solid var(--color-border-subtle)',
                          borderRadius: '8px'
                        }}
                        labelStyle={{ color: 'var(--color-fg-primary)' }}
                      />
                      <Legend />
                      <Line 
                        type="monotone" 
                        dataKey="optimized" 
                        stroke="#10b981" 
                        name="Optimized"
                        strokeWidth={2}
                        dot={false}
                      />
                      <Line 
                        type="monotone" 
                        dataKey="equalWeight" 
                        stroke="#6366f1" 
                        name="Equal Weight"
                        strokeWidth={2}
                        dot={false}
                      />
                      {portfolio.backtest.series.spy && (
                        <Line 
                          type="monotone" 
                          dataKey="spy" 
                          stroke="#f59e0b" 
                          name="SPY"
                          strokeWidth={2}
                          dot={false}
                        />
                      )}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                );
              })()}
            </CardContent>
          </Card>
        )}
        
        <div className={styles.sectionHeader}>
          <h2>Allocations by Sector</h2>
          <span>{portfolio.allocations.length} positions</span>
        </div>
        {Object.entries(
          portfolio.allocations.reduce<Record<string, Allocation[]>>((acc, alloc) => {
            acc[alloc.sector] = acc[alloc.sector] || [];
            acc[alloc.sector].push(alloc);
            return acc;
          }, {})
        ).map(([sector, rows]) => (
          <div key={sector} className={styles.sectorGroup}>
            <h3 className={styles.sectorTitle}>{sector}</h3>
            <DataTable columns={columns} data={rows} rowKey="ticker" />
          </div>
        ))}
        
        {/* Methodology */}
        <Collapsible title="Methodology">
          <div className={styles.methodology}>
            <p><strong>Optimizer:</strong> {portfolio.methodology.optimizer}</p>
            <p><strong>Constraints:</strong></p>
            <ul>
              {portfolio.methodology.constraints.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        </Collapsible>
        
        {/* Raw JSON */}
        <Collapsible title="Raw JSON">
          <pre className={styles.json}>
            {JSON.stringify(portfolio, null, 2)}
          </pre>
        </Collapsible>
    </PageShell>
  );
}
