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
    
    // Generate runId
    const now = new Date();
    const runId = now.toISOString()
      .replace(/[-:]/g, '')
      .replace('T', '_')
      .split('.')[0];
    
    // Create run directory
    const repoRoot = path.join(process.cwd(), '..');
    const runDir = path.join(repoRoot, 'runs', runId);
    fs.mkdirSync(runDir, { recursive: true });
    
    // Write initial status.json
    const initialStatus = {
      runId,
      stage: 'rocket',
      progress: {
        done: 0,
        total: mode === 'sp500' ? 493 : tickers.length,
        current: null,
        message: 'Initializing...'
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
      tickers: mode === 'sp500' ? [] : tickers,
      count: mode === 'sp500' ? 493 : tickers.length,
      createdAt: new Date().toISOString()
    };
    
    fs.writeFileSync(
      path.join(runDir, 'universe.json'),
      JSON.stringify(universeData, null, 2)
    );
    
    // Initialize logs.txt
    const timestamp = new Date().toISOString();
    fs.writeFileSync(
      path.join(runDir, 'logs.txt'),
      `[${timestamp}] Run ${runId} started (mode: ${mode})\n`
    );
    
    // Spawn Python process (non-blocking)
    const pythonScript = path.join(repoRoot, 'run_discovery_with_artifacts.py');
    const args = [pythonScript, runId, '--mode', mode];
    
    if (mode === 'import') {
      args.push('--tickers', tickers.join(','));
    }
    
    const pythonProcess = spawn('python', args, {
      cwd: repoRoot,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    
    // Stream stdout to logs
    pythonProcess.stdout?.on('data', (data) => {
      const logPath = path.join(runDir, 'logs.txt');
      const timestamp = new Date().toISOString();
      fs.appendFileSync(logPath, `[${timestamp}] ${data.toString()}`);
    });
    
    // Stream stderr to logs
    pythonProcess.stderr?.on('data', (data) => {
      const logPath = path.join(runDir, 'logs.txt');
      const timestamp = new Date().toISOString();
      fs.appendFileSync(logPath, `[${timestamp}] ERROR: ${data.toString()}`);
    });
    
    // Handle process completion
    pythonProcess.on('close', (code) => {
      const statusPath = path.join(runDir, 'status.json');
      const currentStatus = JSON.parse(fs.readFileSync(statusPath, 'utf-8'));
      
      if (code === 0) {
        currentStatus.stage = 'done';
        currentStatus.progress.message = 'Analysis complete';
      } else {
        currentStatus.stage = 'error';
        currentStatus.errors.push(`Process exited with code ${code}`);
      }
      
      currentStatus.updatedAt = new Date().toISOString();
      fs.writeFileSync(statusPath, JSON.stringify(currentStatus, null, 2));
      
      const logPath = path.join(runDir, 'logs.txt');
      const timestamp = new Date().toISOString();
      fs.appendFileSync(logPath, `[${timestamp}] Process completed with code ${code}\n`);
    });
    
    // Detach process so it continues after response
    pythonProcess.unref();
    
    return NextResponse.json({ runId });
    
  } catch (error) {
    console.error('Error creating run:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
