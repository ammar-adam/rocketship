'use client';

import { useEffect, useState } from 'react';
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
}

export default function RocketLoadingPage({ params }: PageProps) {
  const router = useRouter();
  const [runId, setRunId] = useState<string>('');
  const [status, setStatus] = useState<Status | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  
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
    
    let eventSource: EventSource | null = null;
    let pollInterval: NodeJS.Timeout | null = null;
    
    // Try SSE first
    try {
      eventSource = new EventSource(`/api/run/${runId}/events`);
      
      eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.type === 'status') {
          setStatus(data.data);
          
          // Navigate when done
          if (data.data.stage !== 'rocket') {
            setTimeout(() => {
              router.push(`/run/${runId}`);
            }, 1000);
          }
        } else if (data.type === 'log') {
          setLogs(prev => [...prev, data.data]);
        }
      };
      
      eventSource.onerror = () => {
        eventSource?.close();
        // Fallback to polling
        startPolling();
      };
    } catch (error) {
      // SSE not supported, use polling
      startPolling();
    }
    
    function startPolling() {
      pollInterval = setInterval(async () => {
        try {
          const res = await fetch(`/api/run/${runId}/status`);
          if (res.ok) {
            const data = await res.json();
            setStatus(data);
            
            if (data.stage !== 'rocket') {
              setTimeout(() => {
                router.push(`/run/${runId}`);
              }, 1000);
            }
          }
        } catch (error) {
          console.error('Polling error:', error);
        }
      }, 1000);
    }
    
    return () => {
      eventSource?.close();
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [runId, router]);
  
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  return (
    <div className={styles.container}>
      <div className={styles.content}>
        {/* Rocket Animation */}
        <div className={styles.animationContainer}>
          <div 
            className={styles.rocket}
            style={{
              transform: status 
                ? `translateY(-${(status.progress.done / status.progress.total) * 200}px)`
                : 'translateY(0)'
            }}
          >
            🚀
          </div>
          <div className={styles.trajectory} />
        </div>
        
        <h1 className={styles.title}>Analyzing Stocks</h1>
        
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
          </>
        )}
        
        <button
          className={styles.logsToggle}
          onClick={() => setShowLogs(!showLogs)}
        >
          {showLogs ? 'Hide' : 'View'} Logs
        </button>
        
        {showLogs && (
          <div className={styles.logsContainer}>
            {logs.map((log, i) => (
              <div key={i} className={styles.logLine}>{log}</div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
