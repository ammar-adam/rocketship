'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { PageShell } from '@/components/ui/PageShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Collapsible } from '@/components/ui/Collapsible';
import styles from './debate-loading.module.css';

const TIMEOUT_MS = 45000; // Stall: no progress for this long => show banner
const WARNING_MS = 30000; // Show warning after 30s

interface StatusData {
  runId: string;
  stage: string;
  progress: {
    done: number;
    total: number;
    current: string | null;
    message: string;
    substep?: string;
    substep_done?: number;
    substep_total?: number;
  };
  updatedAt: string;
  errors: string[];
  skipped?: string[];
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
  const [isStalled, setIsStalled] = useState(false);
  const [showWarning, setShowWarning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [skipPending, setSkipPending] = useState(false);
  const [currentTickerStartTime, setCurrentTickerStartTime] = useState<number | null>(null);
  const startedRef = useRef(false);
  const startTimeRef = useRef(Date.now());
  const lastSignatureRef = useRef<string>('');
  const lastChangeTsRef = useRef<number>(Date.now());
  const keepWaitingUsedRef = useRef(false);

  // Elapsed time ticker
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Stall detection: no change in progress signature for TIMEOUT_MS
  useEffect(() => {
    if (!status) return;

    const progress = status.progress;
    const signature = JSON.stringify({
      stage: status.stage,
      done: progress?.done ?? 0,
      total: progress?.total ?? 0,
      current: progress?.current ?? null,
      apiCallsCompleted: progress?.substep_done ?? null,
      updatedAt: status.updatedAt
    });

    if (signature !== lastSignatureRef.current) {
      lastSignatureRef.current = signature;
      lastChangeTsRef.current = Date.now();
      setIsStalled(false);
      setRunError(null);
      // Track when current ticker started
      if (progress?.current) {
        setCurrentTickerStartTime(Date.now());
      } else {
        setCurrentTickerStartTime(null);
      }
    } else {
      const timeSinceLastChange = Date.now() - lastChangeTsRef.current;
      const isDebateStage = status.stage === 'debate' || progress?.substep_done != null;
      if (isDebateStage && progress?.current) {
        if (timeSinceLastChange >= TIMEOUT_MS) {
          setIsStalled(true);
        } else if (timeSinceLastChange >= WARNING_MS) {
          setShowWarning(true);
        } else {
          setShowWarning(false);
        }
      }
    }
  }, [status]);

  // Error from status (network, 500, parse)
  useEffect(() => {
    if (!status) return;
    if (status.stage === 'error' && status.errors?.length) {
      setRunError(status.errors[0] ?? 'Run error');
    }
  }, [status]);

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
                    {currentTickerStartTime && (
                      <span className={`${styles.tickerElapsed} ${showWarning ? styles.tickerElapsedWarning : ''} ${isStalled ? styles.tickerElapsedStalled : ''}`}>
                        {Math.floor((Date.now() - currentTickerStartTime) / 1000)}s
                      </span>
                    )}
                  </>
                ) : (
                  <span>Initializing AI agents and gathering market data...</span>
                )}
              </div>
              {/* Always show skip button when there's a current ticker - separate row for visibility */}
              {progress?.current && (
                <div className={styles.skipButtonRow}>
                  <button
                    disabled={skipPending}
                    onClick={async () => {
                      const tickerToSkip = progress?.current;
                      if (!tickerToSkip) {
                        console.error('No current ticker to skip');
                        return;
                      }
                      console.log(`[Skip] Attempting to skip ticker: ${tickerToSkip}`);
                      setSkipPending(true);
                      try {
                        const res = await fetch(`/api/run/${runId}/skip`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ ticker: tickerToSkip, reason: 'user_timeout' })
                        });
                        const data = await res.json();
                        if (res.ok) {
                          console.log(`[Skip] Success: ${JSON.stringify(data)}`);
                          setIsStalled(false);
                          lastChangeTsRef.current = Date.now();
                        } else {
                          console.error(`[Skip] Failed: ${res.status} - ${data.error || 'Unknown error'}`);
                          alert(`Failed to skip: ${data.error || 'Unknown error'}`);
                        }
                      } catch (e) {
                        console.error('[Skip] Exception:', e);
                        alert(`Error skipping: ${e instanceof Error ? e.message : 'Unknown error'}`);
                      } finally {
                        setSkipPending(false);
                      }
                    }}
                    className={styles.skipButton}
                    title="Skip this stock and move to the next one"
                  >
                    {skipPending ? '⏳ Skipping…' : '⏭️ Skip Stock'}
                  </button>
                  <span className={styles.skipButtonHint}>
                    Stock taking too long? Click to skip and continue to the next one.
                  </span>
                </div>
              )}
              {error && (
                <div className={styles.errorBanner}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="M12 8v4M12 16h.01"/>
                  </svg>
                  <span>{error}</span>
                </div>
              )}
              {runError && progress?.current && (
                <div className={styles.stallBanner}>
                  <div className={styles.stallHeader}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/>
                      <path d="M12 8v4M12 16h.01"/>
                    </svg>
                    <strong>We hit an error running this stock.</strong>
                  </div>
                  <p className={styles.stallBody}>
                    Skip to the next stock?
                    {progress.current && ` (Current: ${progress.current})`}
                  </p>
                  <div className={styles.stallActions}>
                    <button
                      disabled={skipPending}
                      onClick={async () => {
                        const tickerToSkip = progress?.current;
                        if (!tickerToSkip) {
                          console.error('No current ticker to skip');
                          return;
                        }
                        console.log(`[Skip] Attempting to skip ticker (error): ${tickerToSkip}`);
                        setSkipPending(true);
                        try {
                          const res = await fetch(`/api/run/${runId}/skip`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ticker: tickerToSkip, reason: 'user_skip' })
                          });
                          const data = await res.json();
                          if (res.ok) {
                            console.log(`[Skip] Success: ${JSON.stringify(data)}`);
                            setRunError(null);
                            lastChangeTsRef.current = Date.now();
                          } else {
                            console.error(`[Skip] Failed: ${res.status} - ${data.error || 'Unknown error'}`);
                          }
                        } catch (e) {
                          console.error('[Skip] Exception:', e);
                        } finally {
                          setSkipPending(false);
                        }
                      }}
                      className={styles.stallButton}
                    >
                      {skipPending ? 'Skipping…' : 'Skip stock'}
                    </button>
                  </div>
                </div>
              )}
              {isStalled && !runError && (
                <div className={styles.stallBanner}>
                  <div className={styles.stallHeader}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10"/>
                      <path d="M12 8v4M12 16h.01"/>
                    </svg>
                    <strong>This stock is taking longer than expected.</strong>
                  </div>
                  <p className={styles.stallBody}>
                    Skip to the next stock?
                    {progress?.current && ` (Current: ${progress.current})`}
                  </p>
                  <div className={styles.stallActions}>
                    <button
                      disabled={skipPending}
                      onClick={async () => {
                        const tickerToSkip = progress?.current;
                        if (!tickerToSkip) {
                          console.error('No current ticker to skip');
                          return;
                        }
                        console.log(`[Skip] Attempting to skip ticker: ${tickerToSkip}`);
                        setSkipPending(true);
                        try {
                          const res = await fetch(`/api/run/${runId}/skip`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ ticker: tickerToSkip, reason: 'user_timeout' })
                          });
                          const data = await res.json();
                          if (res.ok) {
                            console.log(`[Skip] Success: ${JSON.stringify(data)}`);
                            setIsStalled(false);
                            lastChangeTsRef.current = Date.now();
                          } else {
                            console.error(`[Skip] Failed: ${res.status} - ${data.error || 'Unknown error'}`);
                          }
                        } catch (e) {
                          console.error('[Skip] Exception:', e);
                        } finally {
                          setSkipPending(false);
                        }
                      }}
                      className={styles.stallButton}
                    >
                      {skipPending ? 'Skipping…' : 'Skip stock'}
                    </button>
                    <button
                      onClick={() => {
                        lastChangeTsRef.current = Date.now();
                        keepWaitingUsedRef.current = true;
                        setIsStalled(false);
                      }}
                      className={styles.stallButton}
                    >
                      Keep waiting
                    </button>
                  </div>
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
                      {items.map(s => {
                        const isSkipped = (status?.skipped ?? []).includes(s.ticker);
                        return (
                          <div
                            key={s.ticker}
                            className={`${styles.tickerChip} ${progress?.current === s.ticker ? styles.tickerActive : ''} ${isSkipped ? styles.tickerSkipped : ''}`}
                          >
                            <span className={styles.tickerName}>{s.ticker}</span>
                            {isSkipped ? (
                              <span className={styles.tickerSkippedLabel}>Skipped by user</span>
                            ) : (
                              <span className={styles.tickerScore}>{s.rocket_score.toFixed(0)}</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        <Collapsible title="Live Logs" defaultOpen={false}>
          <div className={styles.logs} data-logs-panel>
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
