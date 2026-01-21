'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Progress from '@/components/Progress';
import styles from './rocket.module.css';

interface PageProps {
  params: Promise<{ runId: string }>;
}

interface Status {
  stage: string;
  progress: {
    done: number;
    total: number;
    current: string | null;
    message: string;
  };
  errors: string[];
}

export default function RocketLoadingPage({ params }: PageProps) {
  const router = useRouter();
  const [runId, setRunId] = useState<string>('');
  const [status, setStatus] = useState<Status | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  useEffect(() => {
    params.then(p => setRunId(p.runId));
  }, [params]);
  
  // Elapsed timer
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsed(e => e + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);
  
  // SSE connection with fallback to polling
  useEffect(() => {
    if (!runId) return;
    
    const cleanup = () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
    
    const handleStatusUpdate = (newStatus: Status) => {
      setStatus(newStatus);
      
      // Navigate when stage is no longer rocket
      if (newStatus.stage !== 'rocket' && newStatus.stage !== 'setup') {
        setTimeout(() => {
          cleanup();
          if (newStatus.stage === 'error') {
            // Stay on page to show error
          } else {
            router.push(`/run/${runId}`);
          }
        }, 1000);
      }
    };
    
    const startPolling = () => {
      pollIntervalRef.current = setInterval(async () => {
        try {
          const res = await fetch(`/api/run/${runId}/status`);
          if (res.ok) {
            const data = await res.json();
            handleStatusUpdate(data);
          }
        } catch (error) {
          console.error('Polling error:', error);
        }
      }, 1000);
    };
    
    // Try SSE first
    try {
      eventSourceRef.current = new EventSource(`/api/run/${runId}/events`);
      
      eventSourceRef.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          if (data.type === 'status') {
            handleStatusUpdate(data.data);
          } else if (data.type === 'log') {
            setLogs(prev => [...prev.slice(-99), data.data]);
          }
        } catch (e) {
          console.error('SSE parse error:', e);
        }
      };
      
      eventSourceRef.current.onerror = () => {
        console.warn('SSE error, falling back to polling');
        cleanup();
        startPolling();
      };
    } catch (error) {
      console.warn('SSE not supported, using polling');
      startPolling();
    }
    
    return cleanup;
  }, [runId, router]);
  
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  const progressPercent = status && status.progress.total > 0
    ? (status.progress.done / status.progress.total) * 100
    : 0;
  
  return (
    <div className={styles.container}>
      <div className={styles.content}>
        {/* Rocket Animation */}
        <div className={styles.animationContainer}>
          <div className={styles.trajectory} />
          <div 
            className={styles.rocket}
            style={{
              transform: `translateY(-${progressPercent * 2}px)`
            }}
          >
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <path d="M24 4L28 20H20L24 4Z" fill="var(--color-accent-base)"/>
              <rect x="20" y="20" width="8" height="16" fill="var(--color-fg-primary)"/>
              <path d="M16 36L20 28V36H16Z" fill="var(--color-error)"/>
              <path d="M32 36L28 28V36H32Z" fill="var(--color-error)"/>
              <ellipse cx="24" cy="40" rx="6" ry="4" fill="var(--color-warning)" opacity="0.8"/>
            </svg>
          </div>
        </div>
        
        <h1 className={styles.title}>
          {status?.stage === 'error' ? 'Analysis Failed' : 'Analyzing Stocks'}
        </h1>
        
        {status && (
          <>
            <Progress
              done={status.progress.done}
              total={status.progress.total}
              message={status.progress.current || status.progress.message}
            />
            
            <div className={styles.meta}>
              <span>Elapsed: {formatTime(elapsed)}</span>
            </div>
            
            {status.stage === 'error' && status.errors?.length > 0 && (
              <div className={styles.error}>
                {status.errors.map((err, i) => (
                  <p key={i}>{err}</p>
                ))}
                <button onClick={() => router.push(`/run/${runId}`)}>
                  View Dashboard
                </button>
              </div>
            )}
          </>
        )}
        
        <button
          className={styles.logsToggle}
          onClick={() => setShowLogs(!showLogs)}
        >
          {showLogs ? 'Hide' : 'View'} Logs ({logs.length})
        </button>
        
        {showLogs && (
          <div className={styles.logsContainer}>
            {logs.length === 0 ? (
              <div className={styles.logLine}>Waiting for logs...</div>
            ) : (
              logs.map((log, i) => (
                <div key={i} className={styles.logLine}>{log}</div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
