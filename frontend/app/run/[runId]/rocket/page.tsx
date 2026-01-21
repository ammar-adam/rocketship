'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/Card';
import { Collapsible } from '@/components/ui/Collapsible';
import styles from './rocket.module.css';

interface Status {
  stage: string;
  progress: {
    done: number;
    total: number;
    current: string | null;
    message: string;
  };
  startedAt: string;
  completedAt?: string;
  errors?: string[];
}

export default function RocketLoadingPage() {
  const params = useParams();
  const router = useRouter();
  const runId = params.runId as string;
  
  const [status, setStatus] = useState<Status | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [elapsedTime, setElapsedTime] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  
  // Elapsed time ticker
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);
  
  // SSE connection
  useEffect(() => {
    const eventSource = new EventSource(`/api/run/${runId}/events`);
    eventSourceRef.current = eventSource;
    
    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'status') {
          setStatus(data.status);
          
          // Check for completion
          if (data.status.stage === 'done' || data.status.stage === 'error') {
            eventSource.close();
            if (data.status.stage === 'done') {
              // Navigate to dashboard after short delay
              setTimeout(() => {
                router.push(`/run/${runId}`);
              }, 1500);
            }
          }
        }
        
        if (data.type === 'log') {
          setLogs(prev => [...prev, data.line].slice(-100));
        }
      } catch {
        // Ignore parse errors
      }
    };
    
    eventSource.onerror = () => {
      // Fallback to polling
      eventSource.close();
      pollStatus();
    };
    
    return () => {
      eventSource.close();
    };
  }, [runId, router]);
  
  // Fallback polling
  async function pollStatus() {
    try {
      const res = await fetch(`/api/run/${runId}/status`);
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        
        if (data.stage !== 'done' && data.stage !== 'error') {
          setTimeout(pollStatus, 2000);
        } else if (data.stage === 'done') {
          setTimeout(() => {
            router.push(`/run/${runId}`);
          }, 1500);
        }
      }
    } catch (e) {
      setError('Failed to connect to server');
    }
  }
  
  const progress = status?.progress;
  const progressPct = progress && progress.total > 0 
    ? Math.round((progress.done / progress.total) * 100) 
    : 0;
  
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };
  
  const estimateRemaining = () => {
    if (!progress || progress.done === 0) return null;
    const avgPerItem = elapsedTime / progress.done;
    const remaining = (progress.total - progress.done) * avgPerItem;
    return Math.ceil(remaining);
  };
  
  const remaining = estimateRemaining();
  
  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <Card variant="elevated" padding="lg" className={styles.card}>
          <CardContent>
            {/* Header */}
            <div className={styles.header}>
              <h1 className={styles.title}>Computing RocketScores</h1>
              <p className={styles.subtitle}>
                Analyzing {progress?.total || '...'} stocks
              </p>
            </div>
            
            {/* Progress */}
            <div className={styles.progressSection}>
              <div className={styles.progressHeader}>
                <span className={styles.progressLabel}>
                  {progress?.done || 0} of {progress?.total || '...'} complete
                </span>
                <span className={styles.progressPct}>{progressPct}%</span>
              </div>
              <div className={styles.progressBar}>
                <div 
                  className={styles.progressFill} 
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>
            
            {/* Current Stock */}
            {progress?.current && (
              <div className={styles.current}>
                <span className={styles.currentLabel}>Analyzing:</span>
                <span className={styles.currentTicker}>{progress.current}</span>
              </div>
            )}
            
            {/* Time */}
            <div className={styles.time}>
              <div className={styles.timeItem}>
                <span className={styles.timeLabel}>Elapsed</span>
                <span className={styles.timeValue}>{formatTime(elapsedTime)}</span>
              </div>
              {remaining !== null && (
                <div className={styles.timeItem}>
                  <span className={styles.timeLabel}>Est. Remaining</span>
                  <span className={styles.timeValue}>~{formatTime(remaining)}</span>
                </div>
              )}
            </div>
            
            {/* Message */}
            {progress?.message && (
              <p className={styles.message}>{progress.message}</p>
            )}
            
            {/* Estimate Copy */}
            <p className={styles.estimate}>
              RocketScore typically takes 1–3 minutes. Large universes may take longer.
            </p>
            
            {/* Status indicator */}
            {status?.stage === 'done' && (
              <div className={styles.complete}>
                <span className={styles.completeIcon}>✓</span>
                Analysis complete! Redirecting to dashboard...
              </div>
            )}
            
            {status?.stage === 'error' && (
              <div className={styles.errorState}>
                <span>Analysis failed</span>
                {status.errors?.map((e, i) => <p key={i}>{e}</p>)}
              </div>
            )}
            
            {error && (
              <div className={styles.errorState}>{error}</div>
            )}
          </CardContent>
        </Card>
        
        {/* Logs */}
        <Collapsible title={`Logs (${logs.length})`} defaultOpen={false} className={styles.logs}>
          <pre className={styles.logsContent}>
            {logs.length === 0 ? 'Waiting for logs...' : logs.join('\n')}
          </pre>
        </Collapsible>
      </div>
    </div>
  );
}
