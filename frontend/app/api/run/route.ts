import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { mode, tickers } = body;
    
    if (!mode || !['sp500', 'import'].includes(mode)) {
      return NextResponse.json(
        { error: 'Invalid mode. Must be "sp500" or "import"' },
        { status: 400 }
      );
    }
    
    if (mode === 'import' && (!tickers || !Array.isArray(tickers) || tickers.length === 0)) {
      return NextResponse.json(
        { error: 'Tickers array required for import mode' },
        { status: 400 }
      );
    }
    
    // Generate runId (YYYYMMDD_HHMMSS)
    const now = new Date();
    const runId = [
      now.getFullYear().toString(),
      (now.getMonth() + 1).toString().padStart(2, '0'),
      now.getDate().toString().padStart(2, '0'),
      '_',
      now.getHours().toString().padStart(2, '0'),
      now.getMinutes().toString().padStart(2, '0'),
      now.getSeconds().toString().padStart(2, '0')
    ].join('');
    
    const repoRoot = path.join(process.cwd(), '..');
    const runDir = path.join(repoRoot, 'runs', runId);
    
    // Create run directory
    fs.mkdirSync(runDir, { recursive: true });
    
    const tickerList = mode === 'sp500' ? [] : tickers.map((t: string) => t.trim().toUpperCase());
    const tickerCount = mode === 'sp500' ? 493 : tickerList.length;
    
    // Write initial status.json
    const initialStatus = {
      runId,
      stage: 'rocket',
      progress: {
        done: 0,
        total: tickerCount,
        current: null,
        message: 'Initializing RocketScore analysis...'
      },
      updatedAt: new Date().toISOString(),
      errors: []
    };
    
    fs.writeFileSync(
      path.join(runDir, 'status.json'),
      JSON.stringify(initialStatus, null, 2)
    );
    
    // Write universe.json
    const universeData = {
      mode,
      tickers: tickerList,
      createdAt: new Date().toISOString()
    };
    
    fs.writeFileSync(
      path.join(runDir, 'universe.json'),
      JSON.stringify(universeData, null, 2)
    );
    
    // Initialize logs.txt
    const logLine = `[${new Date().toISOString()}] Run ${runId} started (mode: ${mode}, tickers: ${tickerCount})\n`;
    fs.writeFileSync(path.join(runDir, 'logs.txt'), logLine);
    
    // Spawn Python process
    const pythonScript = path.join(repoRoot, 'run_discovery_with_artifacts.py');
    const args = [pythonScript, runId, '--mode', mode];
    
    if (mode === 'import') {
      args.push('--tickers', tickerList.join(','));
    }
    
    // Try python3 first, fall back to python
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    
    const pythonProcess = spawn(pythonCmd, args, {
      cwd: repoRoot,
      env: { ...process.env },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    const logsPath = path.join(runDir, 'logs.txt');
    const statusPath = path.join(runDir, 'status.json');
    
    // Stream stdout to logs
    pythonProcess.stdout?.on('data', (data) => {
      const timestamp = new Date().toISOString();
      const lines = data.toString().split('\n').filter((l: string) => l.trim());
      for (const line of lines) {
        fs.appendFileSync(logsPath, `[${timestamp}] ${line}\n`);
      }
    });
    
    // Stream stderr to logs
    pythonProcess.stderr?.on('data', (data) => {
      const timestamp = new Date().toISOString();
      const lines = data.toString().split('\n').filter((l: string) => l.trim());
      for (const line of lines) {
        fs.appendFileSync(logsPath, `[${timestamp}] ERROR: ${line}\n`);
      }
    });
    
    // Handle process completion
    pythonProcess.on('close', (code) => {
      const timestamp = new Date().toISOString();
      fs.appendFileSync(logsPath, `[${timestamp}] Process exited with code ${code}\n`);
      
      try {
        const currentStatus = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
        
        if (code === 0) {
          // Check if rocket_scores.json was written
          const scoresPath = path.join(runDir, 'rocket_scores.json');
          if (fs.existsSync(scoresPath)) {
            currentStatus.stage = 'debate_ready';
            currentStatus.progress.message = 'RocketScore analysis complete';
          } else {
            currentStatus.stage = 'error';
            currentStatus.errors.push('rocket_scores.json not written');
          }
        } else {
          currentStatus.stage = 'error';
          currentStatus.errors.push(`Process exited with code ${code}`);
        }
        
        currentStatus.updatedAt = new Date().toISOString();
        fs.writeFileSync(statusPath, JSON.stringify(currentStatus, null, 2));
      } catch (e) {
        console.error('Error updating status on close:', e);
      }
    });
    
    pythonProcess.on('error', (err) => {
      const timestamp = new Date().toISOString();
      fs.appendFileSync(logsPath, `[${timestamp}] SPAWN ERROR: ${err.message}\n`);
      
      try {
        const currentStatus = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
        currentStatus.stage = 'error';
        currentStatus.errors.push(err.message);
        currentStatus.updatedAt = new Date().toISOString();
        fs.writeFileSync(statusPath, JSON.stringify(currentStatus, null, 2));
      } catch (e) {
        console.error('Error updating status on spawn error:', e);
      }
    });
    
    // Detach process so it continues after response
    if (process.platform !== 'win32') {
      pythonProcess.unref();
    }
    
    return NextResponse.json({ runId });
    
  } catch (error) {
    console.error('Error creating run:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
