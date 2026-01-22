'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
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
  startedAt?: string;
  updatedAt?: string;
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
  const [isStuck, setIsStuck] = useState(false);
  const [sseConnected, setSseConnected] = useState(false);
  const [usingPolling, setUsingPolling] = useState(false);
  const [connectionWarning, setConnectionWarning] = useState(false);
  
  const eventSourceRef = useRef<EventSource | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  const lastLogTimeRef = useRef<number>(Date.now());
  const lastPingRef = useRef<number>(Date.now());
  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  // Fallback polling - fetches both status and logs
  const pollStatus = useCallback(async () => {
    try {
      // Fetch status
      const statusRes = await fetch(`/api/run/${runId}/status`);
      if (statusRes.ok) {
        const data = await statusRes.json();
        setStatus(data);
        
        const stage = data.stage;
        if (stage === 'done' || stage === 'debate_ready') {
          setTimeout(() => {
            router.push(`/run/${runId}`);
          }, 1500);
          return;
        } else if (stage === 'error') {
          return;
        }
      }
      
      // Fetch logs
      try {
        const logsRes = await fetch(`/api/runs/${runId}/logs.txt`);
        if (logsRes.ok) {
          const logsText = await logsRes.text();
          const logLines = logsText.split('\n').filter(l => l.trim()).slice(-100);
          if (logLines.length > 0) {
            lastLogTimeRef.current = Date.now();
            setLogs(logLines);
          }
        }
      } catch {
        // Logs not available yet
      }
      
      // Continue polling
      pollingRef.current = setTimeout(pollStatus, 1500);
    } catch {
      setError('Failed to connect to server');
      // Retry after delay
      pollingRef.current = setTimeout(pollStatus, 3000);
    }
  }, [runId, router]);
  
  // Elapsed time ticker with stuck detection and connection monitoring
  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setElapsedTime(elapsed);
      
      // Connection warning: no ping in >5 seconds
      const timeSinceLastPing = (Date.now() - lastPingRef.current) / 1000;
      if (sseConnected && !usingPolling && timeSinceLastPing > 5) {
        setConnectionWarning(true);
        // Start polling as fallback
        if (!pollingRef.current) {
          setUsingPolling(true);
          pollStatus();
        }
      }
      
      // Stuck detection: 90s elapsed, 0 done, no logs in 60s
      const timeSinceLastLog = (Date.now() - lastLogTimeRef.current) / 1000;
      if (elapsed > 90 && status?.progress?.done === 0 && timeSinceLastLog > 60) {
        setIsStuck(true);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [status?.progress?.done, sseConnected, usingPolling, pollStatus]);
  
  // SSE connection with fallback
  useEffect(() => {
    let sseTimeout: ReturnType<typeof setTimeout> | null = null;
    
    const eventSource = new EventSource(`/api/run/${runId}/events`);
    eventSourceRef.current = eventSource;
    
    // Set timeout for SSE connection - fallback to polling after 3s
    sseTimeout = setTimeout(() => {
      if (!sseConnected) {
        console.log('SSE timeout, falling back to polling');
        eventSource.close();
        setUsingPolling(true);
        pollStatus();
      }
    }, 3000);
    
    eventSource.onopen = () => {
      setSseConnected(true);
      if (sseTimeout) clearTimeout(sseTimeout);
    };
    
    eventSource.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data);
        
        // Handle ping events - update last ping time
        if (parsed.type === 'ping') {
          lastPingRef.current = Date.now();
          setConnectionWarning(false);
          return;
        }
        
        if (parsed.type === 'status' && parsed.data) {
          setStatus(parsed.data);
          setSseConnected(true);
          setConnectionWarning(false);
          lastPingRef.current = Date.now();
          
          // Check for completion - include debate_ready as completion
          const stage = parsed.data.stage;
          if (stage === 'done' || stage === 'debate_ready' || stage === 'error') {
            eventSource.close();
            if (stage === 'done' || stage === 'debate_ready') {
              // Navigate to dashboard after short delay
              setTimeout(() => {
                router.push(`/run/${runId}`);
              }, 1500);
            }
          }
        }
        
        if (parsed.type === 'log' && parsed.data) {
          lastLogTimeRef.current = Date.now();
          lastPingRef.current = Date.now();
          setLogs(prev => [...prev, parsed.data].slice(-200));
        }
      } catch {
        // Ignore parse errors
      }
    };
    
    eventSource.onerror = () => {
      // Fallback to polling
      console.log('SSE error, falling back to polling');
      eventSource.close();
      if (!usingPolling) {
        setUsingPolling(true);
        pollStatus();
      }
    };
    
    return () => {
      if (sseTimeout) clearTimeout(sseTimeout);
      eventSource.close();
      if (pollingRef.current) clearTimeout(pollingRef.current);
    };
  }, [runId, router, sseConnected, usingPolling]);
  
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
            
            {/* Connection Warning */}
            {connectionWarning && (
              <div className={styles.connectionWarning}>
                <strong>Live updates paused</strong>
                <p>Falling back to polling for updates...</p>
              </div>
            )}
            
            {/* Stuck Warning */}
            {isStuck && (
              <div className={styles.stuckWarning}>
                <strong>Run appears stalled.</strong>
                <p>Check Python spawn / yfinance connectivity.</p>
                <p>Last status: {status?.progress?.message || 'Unknown'}</p>
              </div>
            )}
            
            {/* Status indicator */}
            {(status?.stage === 'done' || status?.stage === 'debate_ready') && (
              <div className={styles.complete}>
                <span className={styles.completeIcon}>✓</span>
                Analysis complete! Redirecting to dashboard...
              </div>
            )}
            
            {status?.stage === 'error' && (
              <div className={styles.errorState}>
                <strong>Analysis failed</strong>
                {status.errors?.map((e, i) => <p key={i}>{e}</p>)}
                <button 
                  className={styles.exitButton}
                  onClick={() => router.push('/setup')}
                >
                  Back to Setup
                </button>
              </div>
            )}
            
            {error && (
              <div className={styles.errorState}>{error}</div>
            )}
            
            {/* Exit Run button */}
            <button 
              className={styles.exitButton}
              onClick={() => router.push('/setup')}
            >
              Exit Run
            </button>
            <p className={styles.exitNote}>
              Run artifacts will remain in runs/{runId}/
            </p>
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
