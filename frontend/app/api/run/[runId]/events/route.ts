import { NextRequest } from 'next/server';
import path from 'path';
import fs from 'fs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  const repoRoot = path.join(process.cwd(), '..');
  const runDir = path.join(repoRoot, 'runs', runId);
  const statusPath = path.join(runDir, 'status.json');
  const logsPath = path.join(runDir, 'logs.txt');
  
  // Check if run exists
  if (!fs.existsSync(statusPath)) {
    return new Response('Run not found', { status: 404 });
  }
  
  // Create SSE stream
  const encoder = new TextEncoder();
  let lastLogSize = 0;
  let intervalId: NodeJS.Timeout;
  
  const stream = new ReadableStream({
    start(controller) {
      // Send initial status
      try {
        const status = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'status', data: status })}\n\n`));
      } catch (error) {
        console.error('Error reading initial status:', error);
      }
      
      // Poll for updates every 500ms
      intervalId = setInterval(() => {
        try {
          // Send status update
          if (fs.existsSync(statusPath)) {
            const status = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'status', data: status })}\n\n`));
            
            // If done or error, close stream
            if (status.stage === 'done' || status.stage === 'error') {
              clearInterval(intervalId);
              controller.close();
              return;
            }
          }
          
          // Send new log lines
          if (fs.existsSync(logsPath)) {
            const stats = fs.statSync(logsPath);
            if (stats.size > lastLogSize) {
              const content = fs.readFileSync(logsPath, 'utf-8');
              const newContent = content.slice(lastLogSize);
              const lines = newContent.split('\n').filter(l => l.trim());
              
              for (const line of lines) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'log', data: line })}\n\n`));
              }
              
              lastLogSize = stats.size;
            }
          }
        } catch (error) {
          console.error('Error in SSE stream:', error);
          clearInterval(intervalId);
          controller.close();
        }
      }, 500);
    },
    
    cancel() {
      if (intervalId) {
        clearInterval(intervalId);
      }
    }
  });
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
