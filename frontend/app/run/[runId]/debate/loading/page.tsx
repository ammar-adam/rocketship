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

  useEffect(() => {
    let isMounted = true;
    async function startDebate() {
      try {
        const statusRes = await fetch(`/api/run/${runId}/status`, { cache: 'no-store' });
        if (statusRes.ok) {
          const currentStatus: StatusData = await statusRes.json();
          setStatus(currentStatus);
          if (currentStatus.stage === 'debate' || currentStatus.stage === 'debate_ready') {
            startedRef.current = true;
            return;
          }
        }
      } catch {
        // Ignore status check errors
      }

      if (startedRef.current) return;
      startedRef.current = true;

      try {
        const res = await fetch(`/api/run/${runId}/debate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        });
        if (!res.ok && isMounted) {
          const data = await res.json().catch(() => ({}));
          setError(data.error || 'Failed to start debate');
        }
      } catch (e) {
        if (isMounted) {
          setError(e instanceof Error ? e.message : 'Failed to start debate');
        }
      }
    }

    startDebate();
    return () => {
      isMounted = false;
    };
  }, [runId]);

  useEffect(() => {
    const eventSource = new EventSource(`/api/run/${runId}/events`);

    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        if (parsed.type === 'status' && parsed.data) {
          setStatus(parsed.data);
          const stage = parsed.data.stage;
          if (stage === 'debate_ready') {
            eventSource.close();
            router.push(`/run/${runId}/debate`);
          } else if (stage === 'error') {
            setError(parsed.data.errors?.[0] || 'Debate failed');
          }
        } else if (parsed.type === 'log' && parsed.data) {
          setLogs(prev => [...prev, parsed.data].slice(-200));
        }
      } catch {
        // Ignore parse errors
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
                  {progress?.message || 'Starting debate...'}
                </span>
                {progress?.total ? (
                  <span className={styles.progressCount}>
                    {progress.done}/{progress.total}
                  </span>
                ) : null}
              </div>
              <div className={styles.progressBar}>
                <div className={styles.progressFill} style={{ width: `${progressPct}%` }} />
              </div>
              <p className={styles.progressHint}>
                {progress?.current ? `Currently debating: ${progress.current}` : 'Preparing agents and context.'}
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
