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
  };
  updatedAt: string;
  errors: string[];
}

interface DebateSelection {
  rank: number;
  ticker: string;
  rocket_score: number;
  sector: string;
  selection_group: 'top25' | 'near_cutoff' | 'best_of_worst' | 'extra';
}

export default function DebateLoadingPage() {
  const params = useParams();
  const router = useRouter();
  const runId = params.runId as string;
  const [status, setStatus] = useState<StatusData | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [debateSelection, setDebateSelection] = useState<DebateSelection[]>([]);
  const startedRef = useRef(false);
  const startTimeRef = useRef(Date.now());

  // Estimated time calculation (rough estimate: 25s per stock for API calls)
  const estimatedTotalTime = status?.progress?.total ? status.progress.total * 25 : 0;
  const elapsedTime = Math.floor((Date.now() - startTimeRef.current) / 1000);
  const remainingTime = Math.max(0, estimatedTotalTime - elapsedTime);
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };
  const estimatedTimeDisplay = remainingTime > 0 ? `~${formatTime(remainingTime)} remaining` : 'Completing...';

  // Fetch debate selection
  useEffect(() => {
    fetch(`/api/runs/${runId}/debate_selection.json`, { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.selections) {
          setDebateSelection(data.selections);
        }
      })
      .catch(() => {});
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
  const top25 = debateSelection.filter(s => s.selection_group === 'top25');
  const nearCutoff = debateSelection.filter(s => s.selection_group === 'near_cutoff');
  const bestOfWorst = debateSelection.filter(s => s.selection_group === 'best_of_worst');
  const extras = debateSelection.filter(s => s.selection_group === 'extra');

  const getGroupLabel = (group: string) => {
    switch (group) {
      case 'top25': return 'Top 25';
      case 'near_cutoff': return 'Near Cutoff (26-35)';
      case 'best_of_worst': return 'Best of Bottom';
      case 'extra': return 'User Added';
      default: return group;
    }
  };

  const getGroupColor = (group: string) => {
    switch (group) {
      case 'top25': return styles.groupTop;
      case 'near_cutoff': return styles.groupNear;
      case 'best_of_worst': return styles.groupBest;
      case 'extra': return styles.groupExtra;
      default: return '';
    }
  };

  return (
    <PageShell
      title="Multi-Agent Debate in Progress"
      subtitle={`Analyzing ${progress?.total || 40} stocks with 5 AI agents each`}
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
                  For each stock, we run 4 specialist AI agents in parallel (Bull, Bear, Regime, Volume),
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
                  {progress?.total && progress.done > 0 && (
                    <span className={styles.estimatedTime}>
                      {estimatedTimeDisplay}
                    </span>
                  )}
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
                  { items: top25, label: 'Top 25 by RocketScore', group: 'top25' },
                  { items: nearCutoff, label: 'Near Cutoff (Ranks 26-35)', group: 'near_cutoff' },
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
