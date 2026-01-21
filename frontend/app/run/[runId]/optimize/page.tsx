'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { Table } from '@/components/ui/Table';
import { Collapsible } from '@/components/ui/Collapsible';
import { SkeletonCard, SkeletonTable } from '@/components/ui/Skeleton';
import styles from './optimize.module.css';

interface Allocation {
  ticker: string;
  weight: number;
  dollars: number;
  sector: string;
  rocket_score: number;
  expected_return_proxy: number;
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

export default function OptimizationPage() {
  const params = useParams();
  const runId = params.runId as string;
  
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  
  useEffect(() => {
    fetchPortfolio();
  }, [runId]);
  
  async function fetchPortfolio() {
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
  }
  
  async function runOptimization() {
    setRunning(true);
    setError('');
    try {
      const res = await fetch(`/api/run/${runId}/optimize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capital: 10000,
          max_weight: 0.12,
          sector_cap: 0.35,
          min_positions: 8,
          max_positions: 25
        })
      });
      
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Optimization failed');
      }
      
      // Refresh portfolio data
      await fetchPortfolio();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Optimization failed');
    } finally {
      setRunning(false);
    }
  }
  
  const columns = [
    {
      key: 'ticker',
      label: 'Ticker',
      sortable: true,
      render: (val: unknown) => (
        <Link href={`/run/${runId}/stock/${val}`} className={styles.tickerLink}>
          {val as string}
        </Link>
      )
    },
    {
      key: 'weight',
      label: 'Weight',
      sortable: true,
      align: 'right' as const,
      render: (val: unknown) => `${((val as number) * 100).toFixed(1)}%`
    },
    {
      key: 'dollars',
      label: 'Dollars',
      sortable: true,
      align: 'right' as const,
      render: (val: unknown) => `$${(val as number).toFixed(0)}`
    },
    {
      key: 'sector',
      label: 'Sector',
      sortable: true,
    },
    {
      key: 'rocket_score',
      label: 'Score',
      sortable: true,
      align: 'right' as const,
      render: (val: unknown) => (val as number).toFixed(1)
    }
  ];
  
  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.container}>
          <header className={styles.header}>
            <h1>Portfolio Optimization</h1>
          </header>
          <SkeletonCard />
          <SkeletonTable rows={8} cols={5} />
        </div>
      </div>
    );
  }
  
  // No portfolio yet - show run button
  if (!portfolio) {
    return (
      <div className={styles.page}>
        <div className={styles.container}>
          <header className={styles.header}>
            <h1 className={styles.title}>Portfolio Optimization</h1>
            <p className={styles.subtitle}>Run: {runId}</p>
          </header>
          
          <Card variant="elevated" padding="lg" className={styles.runCard}>
            <CardContent>
              <h2>Generate Optimized Portfolio</h2>
              <p className={styles.runDesc}>
                The optimizer will construct a portfolio of 8-25 positions using convex optimization
                with risk management constraints.
              </p>
              
              <div className={styles.constraints}>
                <h3>Constraints</h3>
                <ul>
                  <li>Capital: $10,000</li>
                  <li>Max Weight per Stock: 12%</li>
                  <li>Max Sector Weight: 35%</li>
                  <li>Positions: 8-25</li>
                </ul>
              </div>
              
              {error && <p className={styles.error}>{error}</p>}
              
              <button 
                className={styles.runBtn}
                onClick={runOptimization}
                disabled={running}
              >
                {running ? 'Running Optimization...' : 'Run Optimizer'}
              </button>
            </CardContent>
          </Card>
          
          <Link href={`/run/${runId}/debate`} className={styles.backLink}>
            ← Back to Debate
          </Link>
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
              <h1 className={styles.title}>Optimized Portfolio</h1>
              <p className={styles.subtitle}>Run: {runId}</p>
            </div>
            <div className={styles.headerActions}>
              <Link href={`/run/${runId}/debate`} className={styles.actionBtn}>
                ← Debate
              </Link>
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
            </div>
          </div>
        </header>
        
        {/* KPIs */}
        <div className={styles.kpis}>
          <div className={styles.kpi}>
            <span className={styles.kpiValue}>${portfolio.capital.toLocaleString()}</span>
            <span className={styles.kpiLabel}>Capital</span>
          </div>
          <div className={styles.kpi}>
            <span className={styles.kpiValue}>{portfolio.summary.positions}</span>
            <span className={styles.kpiLabel}>Positions</span>
          </div>
          <div className={styles.kpi}>
            <span className={styles.kpiValue}>{(portfolio.summary.cash_weight * 100).toFixed(1)}%</span>
            <span className={styles.kpiLabel}>Cash</span>
          </div>
          <div className={styles.kpi}>
            <span className={styles.kpiValue}>{portfolio.summary.avg_rocket_score.toFixed(1)}</span>
            <span className={styles.kpiLabel}>Avg Score</span>
          </div>
        </div>
        
        {/* Charts Row */}
        <div className={styles.chartsRow}>
          {/* Sector Pie */}
          <Card>
            <CardHeader>
              <CardTitle>Sector Allocation</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={styles.sectorBars}>
                {portfolio.sector_breakdown.map((s) => (
                  <div key={s.sector} className={styles.sectorBar}>
                    <div className={styles.sectorBarHeader}>
                      <span>{s.sector}</span>
                      <span>{(s.weight * 100).toFixed(1)}%</span>
                    </div>
                    <div className={styles.sectorBarTrack}>
                      <div 
                        className={styles.sectorBarFill} 
                        style={{ width: `${s.weight * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
          
          {/* Top Weights Bar */}
          <Card>
            <CardHeader>
              <CardTitle>Top Holdings</CardTitle>
            </CardHeader>
            <CardContent>
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
            </CardContent>
          </Card>
        </div>
        
        {/* Backtest Metrics */}
        {portfolio.backtest && (
          <Card className={styles.backtestCard}>
            <CardHeader>
              <CardTitle>Backtest Metrics</CardTitle>
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
              
              {portfolio.backtest.series && (
                <div className={styles.chartPlaceholder}>
                  <p>Performance Chart</p>
                  <p className={styles.chartNote}>
                    Optimized vs Equal-Weight vs SPY
                    <br />
                    (Install recharts for interactive chart)
                  </p>
                  <div className={styles.legendRow}>
                    <span className={styles.legendOptimized}>■ Optimized</span>
                    <span className={styles.legendEqual}>■ Equal Weight</span>
                    {portfolio.backtest.series.spy && <span className={styles.legendSpy}>■ SPY</span>}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
        
        {/* Allocations Table */}
        <SectionHeader 
          title="All Allocations" 
          description={`${portfolio.allocations.length} positions`}
        />
        <Card padding="none">
          <Table
            columns={columns}
            data={portfolio.allocations}
            rowKey="ticker"
          />
        </Card>
        
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
      </div>
    </div>
  );
}
