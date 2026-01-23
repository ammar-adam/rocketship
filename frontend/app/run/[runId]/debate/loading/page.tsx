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

export default function DebateLoadingPage() {
  const params = useParams();
  const router = useRouter();
  const runId = params.runId as string;
  const [status, setStatus] = useState<StatusData | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState('');
  const startedRef = useRef(false);
  const startTimeRef = useRef(Date.now());

  // Estimated time calculation (rough estimate: 30s per stock for API calls)
  const estimatedTotalTime = status?.progress?.total ? status.progress.total * 30 : 0;
  const elapsedTime = Math.floor((Date.now() - startTimeRef.current) / 1000);
  const remainingTime = Math.max(0, estimatedTotalTime - elapsedTime);
  const estimatedTimeDisplay = remainingTime > 0 ? `${Math.ceil(remainingTime / 60)}m remaining` : 'Completing...';

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

  return (
    <PageShell
      title="Running Full Debate"
      subtitle="Analyzing all 25 RocketScore candidates"
    >
      <div className={styles.layout}>
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
                      {progress.done} of {progress.total} stocks completed
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
              <p className={styles.progressHint}>
                {progress?.current ? `🔍 Analyzing ${progress.current}` : '🤖 Initializing AI agents and gathering market data...'}
              </p>
              {error && <p className={styles.error}>{error}</p>}
            </div>
          </CardContent>
        </Card>

        <Collapsible title="Logs" defaultOpen={false}>
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
