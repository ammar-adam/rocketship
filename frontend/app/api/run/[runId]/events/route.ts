import { NextRequest } from 'next/server';
import path from 'path';
import fs from 'fs';

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

function getDefaultStatus(runId: string): StatusData {
  return {
    runId,
    stage: 'setup',
    progress: { done: 0, total: 0, current: null, message: 'Initializing...' },
    updatedAt: new Date().toISOString(),
    errors: []
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  const repoRoot = path.join(process.cwd(), '..');
  const runDir = path.join(repoRoot, 'runs', runId);
  const statusPath = path.join(runDir, 'status.json');
  const logsPath = path.join(runDir, 'logs.txt');
  
  const encoder = new TextEncoder();
  let lastLogSize = 0;
  let lastStatusMtime = 0;
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let heartbeatId: ReturnType<typeof setInterval> | null = null;
  let closingTimeout: ReturnType<typeof setTimeout> | null = null;
  let isClosed = false;
  
  const stream = new ReadableStream({
    start(controller) {
      const sendEvent = (type: string, data: unknown) => {
        if (isClosed) return;
        try {
          const payload = JSON.stringify({ type, data });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        } catch (e) {
          // Stream might be closed
        }
      };
      
      const cleanup = () => {
        isClosed = true;
        if (intervalId) clearInterval(intervalId);
        if (heartbeatId) clearInterval(heartbeatId);
        if (closingTimeout) clearTimeout(closingTimeout);
      };
      
      const readStatus = (): StatusData => {
        try {
          if (fs.existsSync(statusPath)) {
            return JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
          }
        } catch (e) {
          console.error('Error reading status:', e);
        }
        return getDefaultStatus(runId);
      };
      
      const readNewLogs = (): string[] => {
        try {
          if (fs.existsSync(logsPath)) {
            const stats = fs.statSync(logsPath);
            if (stats.size > lastLogSize) {
              const fd = fs.openSync(logsPath, 'r');
              const buffer = Buffer.alloc(stats.size - lastLogSize);
              fs.readSync(fd, buffer, 0, buffer.length, lastLogSize);
              fs.closeSync(fd);
              lastLogSize = stats.size;
              return buffer.toString('utf-8').split('\n').filter(l => l.trim());
            }
          }
        } catch (e) {
          console.error('Error reading logs:', e);
        }
        return [];
      };
      
      // Send initial status
      const initialStatus = readStatus();
      sendEvent('status', initialStatus);
      
      // Send initial logs if any
      if (fs.existsSync(logsPath)) {
        const initialLogs = fs.readFileSync(logsPath, 'utf-8');
        lastLogSize = Buffer.byteLength(initialLogs, 'utf-8');
        const lines = initialLogs.split('\n').filter(l => l.trim()).slice(-20);
        for (const line of lines) {
          sendEvent('log', line);
        }
      }
      
      // Poll for updates every 500ms
      intervalId = setInterval(() => {
        if (isClosed) return;
        
        try {
          // Check for status updates
          if (fs.existsSync(statusPath)) {
            const stats = fs.statSync(statusPath);
            if (stats.mtimeMs > lastStatusMtime) {
              lastStatusMtime = stats.mtimeMs;
              const status = readStatus();
              sendEvent('status', status);
              
              // If done, debate_ready, or error, schedule close
              const completedStages = ['done', 'debate_ready', 'error', 'optimize_ready'];
              if (completedStages.includes(status.stage) && !closingTimeout) {
                closingTimeout = setTimeout(() => {
                  cleanup();
                  try {
                    controller.close();
                  } catch (e) {
                    // Already closed
                  }
                }, 3000);
              }
            }
          }
          
          // Check for new log lines
          const newLogs = readNewLogs();
          for (const line of newLogs) {
            sendEvent('log', line);
          }
        } catch (e) {
          console.error('Error in SSE poll:', e);
        }
      }, 500);
      
      // Heartbeat every 2 seconds so UI knows connection is alive
      heartbeatId = setInterval(() => {
        if (isClosed) return;
        try {
          const pingPayload = JSON.stringify({ type: 'ping', data: { ts: Date.now() } });
          controller.enqueue(encoder.encode(`data: ${pingPayload}\n\n`));
        } catch (e) {
          // Stream closed
        }
      }, 2000);
    },
    
    cancel() {
      isClosed = true;
      if (intervalId) clearInterval(intervalId);
      if (heartbeatId) clearInterval(heartbeatId);
      if (closingTimeout) clearTimeout(closingTimeout);
    }
  });
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
