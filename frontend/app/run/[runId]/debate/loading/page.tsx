'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PageShell } from '@/components/ui/PageShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Collapsible } from '@/components/ui/Collapsible';
import styles from './debate-loading.module.css';

interface StatusData {
  runId: string;
  stage: string;
  progress: {
    done: number;
    total: number;
    current: string | null;
    message: string;
    // Substep tracking for API calls (5 per stock: 4 agents + 1 judge)
    substep?: string;
    substep_done?: number;
    substep_total?: number;
  };
  updatedAt: string;
  errors: string[];
}

interface DebateSelection {
  rank: number;
  ticker: string;
  rocket_score: number;
  sector: string;
  selection_group: 'top23' | 'edge' | 'best_of_worst' | 'extra';
}

export default function DebateLoadingPage() {
  const params = useParams();
  const router = useRouter();
  const runId = params.runId as string;
  const [status, setStatus] = useState<StatusData | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [debateSelection, setDebateSelection] = useState<DebateSelection[]>([]);
  const [elapsedTime, setElapsedTime] = useState(0);
  const startedRef = useRef(false);
  const startTimeRef = useRef(Date.now());

  // Elapsed time ticker
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Smart time estimate based on actual progress
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const getTimeEstimate = () => {
    const progress = status?.progress;
    if (!progress || progress.done === 0) {
      // Initial estimate: ~15s per stock with optimized API calls
      const total = progress?.total || 30;
      return `~${formatTime(total * 15)} estimated`;
    }
    // Calculate based on actual average time per completed stock
    const avgTimePerStock = elapsedTime / progress.done;
    const remaining = (progress.total - progress.done) * avgTimePerStock;
    return `~${formatTime(Math.ceil(remaining))} remaining`;
  };

  // Substep progress (5 API calls per stock)
  const substepProgress = status?.progress?.substep_done || 0;
  const substepTotal = status?.progress?.substep_total || 5;
  const substepPct = Math.round((substepProgress / substepTotal) * 100);

  // Fetch debate selection - use correct endpoint
  useEffect(() => {
    // Try backend artifact endpoint first
    fetch(`/api/runs/${runId}/debate_selection.json`, { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.selections) {
          // Ensure we have all required fields
          const selections = data.selections.map((s: any) => ({
            ticker: s.ticker,
            rank: s.rank || 0,
            rocket_score: s.rocket_score || 0,
            sector: s.sector || 'Unknown',
            selection_group: s.selection_group || 'extra'
          }));
          setDebateSelection(selections);
        }
      })
      .catch(() => {
        // Fallback: try debug endpoint
        fetch(`/api/run/${runId}/debate/debug`, { cache: 'no-store' })
          .then(res => res.ok ? res.json() : null)
          .then(debug => {
            if (debug?.selection?.tickers) {
              // Convert tickers list to selection format
              const selections = debug.selection.tickers.map((t: string, idx: number) => ({
                ticker: t,
                rank: idx + 1,
                rocket_score: 0,
                sector: 'Unknown',
                selection_group: idx < 23 ? 'top23' : idx < 28 ? 'edge' : 'best_of_worst'
              }));
              setDebateSelection(selections);
            }
          })
          .catch(() => {});
      });
  }, [runId]);

  useEffect(() => {
    // Just fetch initial status to show current progress
    fetch(`/api/run/${runId}/status`, { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data) {
          console.log('Debate loading: Initial status:', data);
          setStatus(data);
        }
      })
      .catch(e => console.log('Debate loading: Initial status fetch failed:', e));
  }, [runId]);

  useEffect(() => {
    const eventSource = new EventSource(`/api/run/${runId}/events`);

    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        console.log('Debate loading: SSE message:', parsed);
        if (parsed.type === 'status' && parsed.data) {
          console.log('Debate loading: Status update:', parsed.data);
          setStatus(parsed.data);
          const stage = parsed.data.stage;
          if (stage === 'debate_ready') {
            console.log('Debate loading: Debate complete, navigating to results');
            eventSource.close();
            router.push(`/run/${runId}/debate`);
          } else if (stage === 'error') {
            setError(parsed.data.errors?.[0] || 'Debate failed');
          }
        } else if (parsed.type === 'log' && parsed.data) {
          console.log('Debate loading: Log:', parsed.data);
          setLogs(prev => [...prev, parsed.data].slice(-200));
        } else if (parsed.type === 'ping') {
          console.log('Debate loading: Ping received');
        }
      } catch (e) {
        console.log('Debate loading: SSE parse error:', e);
      }
    };

    eventSource.onerror = () => {
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, [runId, router]);

  const progress = status?.progress;
  const progressPct = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.done / progress.total) * 100))
    : 0;

  // Group selections for display
  const top23 = debateSelection.filter(s => s.selection_group === 'top23');
  const edge = debateSelection.filter(s => s.selection_group === 'edge');
  const bestOfWorst = debateSelection.filter(s => s.selection_group === 'best_of_worst');
  const extras = debateSelection.filter(s => s.selection_group === 'extra');

  const getGroupLabel = (group: string) => {
    switch (group) {
      case 'top23': return 'Top 23';
      case 'edge': return 'Edge Cases (24-28)';
      case 'best_of_worst': return 'Best of Bottom';
      case 'extra': return 'User Added';
      default: return group;
    }
  };

  const getGroupColor = (group: string) => {
    switch (group) {
      case 'top23': return styles.groupTop;
      case 'edge': return styles.groupNear;
      case 'best_of_worst': return styles.groupBest;
      case 'extra': return styles.groupExtra;
      default: return '';
    }
  };

  return (
    <PageShell
      title="Multi-Agent Debate in Progress"
      subtitle={`Analyzing ${progress?.total || debateSelection.length || 30} stocks with 5 AI agents each`}
    >
      <div className={styles.layout}>
        {/* What's happening */}
        <Card variant="elevated" className={styles.explainerCard}>
          <CardContent>
            <div className={styles.explainer}>
              <div className={styles.explainerIcon}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"/>
                  <path d="M12 16v-4M12 8h.01"/>
                </svg>
              </div>
              <div>
                <h3 className={styles.explainerTitle}>What&apos;s happening right now</h3>
                <p className={styles.explainerText}>
                  For each stock, we run 4 specialist AI agents in parallel (Bull, Bear, Regime, Value),
                  then a Judge agent synthesizes their arguments into a final BUY/HOLD/SELL verdict.
                  News from the last 14 days is injected for real-world context.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Progress Card */}
        <Card variant="elevated">
          <CardHeader>
            <CardTitle>Debate Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <div className={styles.progressRow}>
              <div className={styles.progressMeta}>
                <span className={styles.progressLabel}>
                  {progress?.message || 'Starting debate analysis...'}
                </span>
                <div className={styles.progressStats}>
                  {progress?.total ? (
                    <span className={styles.progressCount}>
                      {progress.done} of {progress.total} stocks
                    </span>
                  ) : (
                    <span className={styles.progressCount}>Loading candidates...</span>
                  )}
                  <span className={styles.estimatedTime}>
                    {getTimeEstimate()}
                  </span>
                  <span className={styles.elapsedTime}>
                    Elapsed: {formatTime(elapsedTime)}
                  </span>
                </div>
              </div>
              <div className={styles.progressBar}>
                <div className={styles.progressFill} style={{ width: `${progressPct}%` }} />
              </div>
              <div className={styles.currentStock}>
                {progress?.current ? (
                  <>
                    <span className={styles.pulse} />
                    <span>Analyzing <strong>{progress.current}</strong></span>
                    {/* Substep progress bar for API calls */}
                    <div className={styles.substepContainer}>
                      <div className={styles.substepBar}>
                        <div
                          className={styles.substepFill}
                          style={{ width: `${substepPct}%` }}
                        />
                      </div>
                      <span className={styles.substepLabel}>
                        {substepProgress}/{substepTotal} API calls
                      </span>
                    </div>
                  </>
                ) : (
                  <span>Initializing AI agents and gathering market data...</span>
                )}
              </div>
              {error && (
                <div className={styles.errorBanner}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 8v4M12 16h.01"/>
                  </svg>
                  <span>{error}</span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Debate Set Table */}
        {debateSelection.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Debate Set ({debateSelection.length} stocks)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={styles.selectionGroups}>
                {[
                  { items: top23, label: 'Top 23 by RocketScore', group: 'top23' },
                  { items: edge, label: 'Edge Cases (Ranks 24-28)', group: 'edge' },
                  { items: bestOfWorst, label: 'Best of Bottom Quartile', group: 'best_of_worst' },
                  { items: extras, label: 'User Added', group: 'extra' },
                ].filter(g => g.items.length > 0).map(({ items, label, group }) => (
                  <div key={group} className={styles.selectionGroup}>
                    <h4 className={`${styles.groupHeader} ${getGroupColor(group)}`}>
                      {label} ({items.length})
                    </h4>
                    <div className={styles.tickerGrid}>
                      {items.map(s => (
                        <div
                          key={s.ticker}
                          className={`${styles.tickerChip} ${progress?.current === s.ticker ? styles.tickerActive : ''}`}
                        >
                          <span className={styles.tickerName}>{s.ticker}</span>
                          <span className={styles.tickerScore}>{s.rocket_score.toFixed(0)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Collapsible title="Live Logs" defaultOpen={false}>
          <div className={styles.logs}>
            {logs.length === 0 ? (
              <p className={styles.logEmpty}>Logs will appear as the debate progresses.</p>
            ) : (
              logs.map((line, idx) => (
                <div key={`${line}-${idx}`} className={styles.logLine}>{line}</div>
              ))
            )}
          </div>
        </Collapsible>
      </div>
    </PageShell>
  );
}
