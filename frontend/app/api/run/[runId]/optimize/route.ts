import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    const repoRoot = path.join(process.cwd(), '..');
    const runDir = path.join(repoRoot, 'runs', runId);
    const statusPath = path.join(runDir, 'status.json');
    const logsPath = path.join(runDir, 'logs.txt');
    const scoresPath = path.join(runDir, 'rocket_scores.json');
    
    // Validate run exists
    if (!fs.existsSync(runDir)) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }
    
    // Validate rocket_scores exists
    if (!fs.existsSync(scoresPath)) {
      return NextResponse.json({ error: 'rocket_scores.json not found' }, { status: 400 });
    }
    
    const appendLog = (msg: string) => {
      const timestamp = new Date().toISOString();
      fs.appendFileSync(logsPath, `[${timestamp}] ${msg}\n`);
    };
    
    const updateStatus = (stage: string, done: number, total: number, message: string, errors: string[] = []) => {
      const status = {
        runId,
        stage,
        progress: { done, total, current: null, message },
        updatedAt: new Date().toISOString(),
        errors
      };
      fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
    };
    
    // Update status to optimize
    updateStatus('optimize', 0, 1, 'Running portfolio optimization...');
    appendLog('Starting portfolio optimization');
    
    // Run Python optimizer
    const pythonScript = path.join(repoRoot, 'src', 'optimizer.py');
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    
    return new Promise<NextResponse>((resolve) => {
      const pythonProcess = spawn(pythonCmd, [pythonScript, runId], {
        cwd: repoRoot,
        env: { ...process.env }
      });
      
      let stdout = '';
      let stderr = '';
      
      pythonProcess.stdout?.on('data', (data) => {
        stdout += data.toString();
        appendLog(data.toString().trim());
      });
      
      pythonProcess.stderr?.on('data', (data) => {
        stderr += data.toString();
        appendLog(`ERROR: ${data.toString().trim()}`);
      });
      
      pythonProcess.on('close', (code) => {
        if (code === 0) {
          // Check if portfolio.json was written
          const portfolioPath = path.join(runDir, 'portfolio.json');
          if (fs.existsSync(portfolioPath)) {
            updateStatus('done', 1, 1, 'Optimization complete');
            appendLog('Optimization complete');
            resolve(NextResponse.json({ ok: true }));
          } else {
            updateStatus('error', 0, 1, 'portfolio.json not written', ['Optimizer did not write portfolio.json']);
            resolve(NextResponse.json({ error: 'portfolio.json not written' }, { status: 500 }));
          }
        } else {
          updateStatus('error', 0, 1, 'Optimization failed', [stderr || `Exit code ${code}`]);
          resolve(NextResponse.json({ error: stderr || `Exit code ${code}` }, { status: 500 }));
        }
      });
      
      pythonProcess.on('error', (err) => {
        updateStatus('error', 0, 1, 'Failed to spawn optimizer', [err.message]);
        resolve(NextResponse.json({ error: err.message }, { status: 500 }));
      });
    });
    
  } catch (error) {
    console.error('Error running optimizer:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
