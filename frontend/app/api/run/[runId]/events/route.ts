import { NextRequest } from 'next/server';
import { readArtifact, exists } from '@/src/lib/storage';
import { useBackend, backendGet } from '@/src/lib/backend';

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
  const isBackendMode = useBackend();

  const encoder = new TextEncoder();
  let lastLogContent = '';
  let lastStatusContent = '';
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let heartbeatId: ReturnType<typeof setInterval> | null = null;
  let closingTimeout: ReturnType<typeof setTimeout> | null = null;
  let isClosed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const sendEvent = (type: string, data: unknown) => {
        if (isClosed) return;
        try {
          const payload = JSON.stringify({ type, data });
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        } catch {
          // Stream might be closed
        }
      };

      const cleanup = () => {
        isClosed = true;
        if (intervalId) clearInterval(intervalId);
        if (heartbeatId) clearInterval(heartbeatId);
        if (closingTimeout) clearTimeout(closingTimeout);
      };

      // ========================================================================
      // Status reader - proxies to backend when PY_BACKEND_URL is set
      // ========================================================================
      const readStatus = async (): Promise<StatusData> => {
        try {
          if (isBackendMode) {
            // Proxy to Python backend
            const result = await backendGet<StatusData>(`/run/${runId}/status`);
            if (result.ok && result.data) {
              return result.data;
            }
          } else {
            // Legacy: local filesystem
            if (await exists(runId, 'status.json')) {
              const content = await readArtifact(runId, 'status.json');
              return JSON.parse(content);
            }
          }
        } catch (e) {
          console.error('Error reading status:', e);
        }
        return getDefaultStatus(runId);
      };

      // ========================================================================
      // Logs reader - proxies to backend when PY_BACKEND_URL is set
      // ========================================================================
      const readNewLogs = async (): Promise<string[]> => {
        try {
          if (isBackendMode) {
            // Proxy to Python backend
            const result = await backendGet<string>(`/run/${runId}/artifact/logs.txt`);
            if (result.ok && result.data) {
              const content = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
              if (content !== lastLogContent) {
                const newLines = content.slice(lastLogContent.length).split('\n').filter(l => l.trim());
                lastLogContent = content;
                return newLines;
              }
            }
          } else {
            // Legacy: local filesystem
            if (await exists(runId, 'logs.txt')) {
              const content = await readArtifact(runId, 'logs.txt');
              if (content !== lastLogContent) {
                const newLines = content.slice(lastLogContent.length).split('\n').filter(l => l.trim());
                lastLogContent = content;
                return newLines;
              }
            }
          }
        } catch (e) {
          console.error('Error reading logs:', e);
        }
        return [];
      };

      // Send initial status
      const initialStatus = await readStatus();
      lastStatusContent = JSON.stringify(initialStatus);
      sendEvent('status', initialStatus);

      // Send initial logs if any
      try {
        if (isBackendMode) {
          const result = await backendGet<string>(`/run/${runId}/artifact/logs.txt`);
          if (result.ok && result.data) {
            const initialLogs = typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
            lastLogContent = initialLogs;
            const lines = initialLogs.split('\n').filter(l => l.trim()).slice(-20);
            for (const line of lines) {
              sendEvent('log', line);
            }
          }
        } else {
          if (await exists(runId, 'logs.txt')) {
            const initialLogs = await readArtifact(runId, 'logs.txt');
            lastLogContent = initialLogs;
            const lines = initialLogs.split('\n').filter(l => l.trim()).slice(-20);
            for (const line of lines) {
              sendEvent('log', line);
            }
          }
        }
      } catch {
        // Logs not available yet
      }

      // Poll for updates every 500ms
      intervalId = setInterval(async () => {
        if (isClosed) return;

        try {
          // Check for status updates
          const status = await readStatus();
          const statusContent = JSON.stringify(status);
          if (statusContent !== lastStatusContent) {
            lastStatusContent = statusContent;
            sendEvent('status', status);

            // If done, debate_ready, or error, schedule close
            const completedStages = ['done', 'debate_ready', 'error', 'optimize_ready'];
            if (completedStages.includes(status.stage) && !closingTimeout) {
              closingTimeout = setTimeout(() => {
                cleanup();
                try {
                  controller.close();
                } catch {
                  // Already closed
                }
              }, 3000);
            }
          }

          // Check for new log lines
          const newLogs = await readNewLogs();
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
        } catch {
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
