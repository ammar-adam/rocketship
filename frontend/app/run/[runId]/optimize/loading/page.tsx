'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './loading.module.css';

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

export default function OptimizeLoadingPage({ params }: PageProps) {
  const router = useRouter();
  const [runId, setRunId] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [error, setError] = useState('');
  
  useEffect(() => {
    params.then(p => setRunId(p.runId));
  }, [params]);
  
  useEffect(() => {
    if (!runId) return;
    
    // Check current status
    const checkStatus = async () => {
      try {
        const res = await fetch(`/api/run/${runId}/status`);
        const data = await res.json();
        setStatus(data);
        
        // If already done and portfolio exists, navigate
        if (data.stage === 'done') {
          const portfolioRes = await fetch(`/api/runs/${runId}/portfolio.json`);
          if (portfolioRes.ok) {
            router.push(`/run/${runId}/optimize`);
            return;
          }
        }
        
        // Optimization already running (e.g. refresh mid-run): just poll
        if (data.stage === 'optimize') {
          startPolling();
          return;
        }
        
        // Not started yet (e.g. debate_ready): start optimization
        if (data.stage !== 'done') {
          startOptimization();
        }
      } catch (e) {
        console.error('Error checking status:', e);
      }
    };
    
    checkStatus();
  }, [runId, router]);
  
  const startOptimization = async () => {
    if (optimizing) return;
    setOptimizing(true);
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
          max_positions: 12
        })
      });
      if (res.ok) {
        // Start polling for status
        startPolling();
      } else {
        const err = await res.json();
        setError(err.error || 'Optimization failed');
        setOptimizing(false);
      }
    } catch (e) {
      setError(`Error: ${e}`);
      setOptimizing(false);
    }
  };
  
  const startPolling = () => {
    const poll = async () => {
      try {
        const res = await fetch(`/api/run/${runId}/status`);
        const data = await res.json();
        setStatus(data);
        
        if (data.stage === 'done') {
          router.push(`/run/${runId}/optimize`);
          return;
        }
        
        if (data.stage === 'error') {
          setError(data.errors?.join(', ') || 'Unknown error');
          setOptimizing(false);
          return;
        }
        
        // Fetch logs for "View Logs" panel
        try {
          const logsRes = await fetch(`/api/runs/${runId}/logs.txt`, { cache: 'no-store' });
          if (logsRes.ok) {
            const text = await logsRes.text();
            setLogs(text.trim().split('\n').filter(Boolean).slice(-50));
          }
        } catch {
          // Ignore log fetch errors
        }
        
        setTimeout(poll, 1000);
      } catch (e) {
        setTimeout(poll, 1000);
      }
    };
    
    poll();
  };
  
  return (
    <div className={styles.container}>
      <div className={styles.content}>
        {/* Trajectory Animation */}
        <div className={styles.animationContainer}>
          <svg className={styles.trajectory} viewBox="0 0 200 200">
            <path
              className={styles.trajectoryPath}
              d="M 20 180 Q 100 100 180 20"
              fill="none"
              strokeWidth="2"
            />
            <circle 
              className={styles.dot}
              r="6"
              style={{
                offsetPath: 'path("M 20 180 Q 100 100 180 20")',
                offsetDistance: status?.stage === 'done' ? '100%' : '50%'
              }}
            />
          </svg>
        </div>
        
        <h1 className={styles.title}>Optimizing Portfolio</h1>
        
        {status && (
          <p className={styles.message}>{status.progress.message}</p>
        )}
        
        {error && (
          <div className={styles.error}>
            <p>{error}</p>
            <button onClick={() => router.push(`/run/${runId}`)}>
              Back to Dashboard
            </button>
          </div>
        )}
        
        <button
          className={styles.logsToggle}
          onClick={() => setShowLogs(!showLogs)}
        >
          {showLogs ? 'Hide' : 'View'} Logs
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
