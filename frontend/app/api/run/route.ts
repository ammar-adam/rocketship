import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp, RATE_LIMITS, rateLimitResponse } from '@/src/lib/rateLimit';
import { validateTickerArray } from '@/src/lib/validation';
import { useBackend, backendPost } from '@/src/lib/backend';

export async function POST(request: NextRequest) {
  // Rate limiting
  const clientIp = getClientIp(request.headers);
  const rateLimitResult = checkRateLimit(clientIp, RATE_LIMITS.medium);
  if (!rateLimitResult.success) {
    return rateLimitResponse(rateLimitResult);
  }

  try {
    const body = await request.json();
    const { mode, tickers } = body;

    if (!mode || !['sp500', 'import'].includes(mode)) {
      return NextResponse.json(
        { error: 'Invalid mode. Must be "sp500" or "import"' },
        { status: 400 }
      );
    }

    if (mode === 'import') {
      const validation = validateTickerArray(tickers, { minLength: 1, maxLength: 500 });
      if (!validation.success) {
        return NextResponse.json(
          { error: validation.error },
          { status: 400 }
        );
      }
    }

    // ========================================================================
    // PROXY TO PYTHON BACKEND
    // ========================================================================
    if (useBackend()) {
      const tickerList = mode === 'sp500' ? null : tickers.map((t: string) => t.trim().toUpperCase());

      const result = await backendPost<{ runId: string }>('/run', {
        mode,
        tickers: tickerList,
      });

      if (!result.ok) {
        return NextResponse.json(
          { error: result.error },
          { status: result.status }
        );
      }

      return NextResponse.json({ runId: result.data!.runId });
    }

    // ========================================================================
    // LEGACY: Local Python execution (for development without backend)
    // ========================================================================
    const { spawn } = await import('child_process');
    const path = await import('path');
    const { ensureRunDir, writeArtifact, appendText, readArtifact, exists } = await import('@/src/lib/storage');

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

    // Ensure run directory exists
    await ensureRunDir(runId);

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

    await writeArtifact(runId, 'status.json', JSON.stringify(initialStatus, null, 2));

    // Write universe.json
    const universeData = {
      mode,
      tickers: tickerList,
      createdAt: new Date().toISOString()
    };

    await writeArtifact(runId, 'universe.json', JSON.stringify(universeData, null, 2));

    // Initialize logs.txt
    const logLine = `[${new Date().toISOString()}] Run ${runId} started (mode: ${mode}, tickers: ${tickerCount})\n`;
    await writeArtifact(runId, 'logs.txt', logLine);

    // Get repo root for Python script
    const repoRoot = path.join(process.cwd(), '..');
    const pythonScript = path.join(repoRoot, 'run_discovery_with_artifacts.py');

    // Build args with -u for unbuffered output
    const scriptArgs = ['-u', pythonScript, runId, '--mode', mode];

    if (mode === 'import') {
      scriptArgs.push('--tickers', tickerList.join(','));
    }

    // Use 'py' launcher on Windows, else python3
    const pythonCmd = process.platform === 'win32' ? 'py' : 'python3';

    // Log spawn command
    const spawnLog = `[${new Date().toISOString()}] Spawning: ${pythonCmd} ${scriptArgs.join(' ')}\n`;
    await appendText(runId, 'logs.txt', spawnLog);

    const pythonProcess = spawn(pythonCmd, scriptArgs, {
      cwd: repoRoot,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8'
      },
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32'
    });

    // Stream stdout to logs
    pythonProcess.stdout?.on('data', async (data) => {
      const timestamp = new Date().toISOString();
      const lines = data.toString().split('\n').filter((l: string) => l.trim());
      for (const line of lines) {
        await appendText(runId, 'logs.txt', `[${timestamp}] ${line}\n`);
      }
    });

    // Stream stderr to logs
    pythonProcess.stderr?.on('data', async (data) => {
      const timestamp = new Date().toISOString();
      const lines = data.toString().split('\n').filter((l: string) => l.trim());
      for (const line of lines) {
        await appendText(runId, 'logs.txt', `[${timestamp}] ERROR: ${line}\n`);
      }
    });

    // Handle process completion
    pythonProcess.on('close', async (code) => {
      const timestamp = new Date().toISOString();
      await appendText(runId, 'logs.txt', `[${timestamp}] Process exited with code ${code}\n`);

      try {
        const statusContent = await readArtifact(runId, 'status.json');
        const currentStatus = JSON.parse(statusContent);

        if (code === 0) {
          if (await exists(runId, 'rocket_scores.json')) {
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
        await writeArtifact(runId, 'status.json', JSON.stringify(currentStatus, null, 2));
      } catch (e) {
        console.error('Error updating status on close:', e);
      }
    });

    pythonProcess.on('error', async (err) => {
      const timestamp = new Date().toISOString();
      await appendText(runId, 'logs.txt', `[${timestamp}] SPAWN ERROR: ${err.message}\n`);

      try {
        const statusContent = await readArtifact(runId, 'status.json');
        const currentStatus = JSON.parse(statusContent);
        currentStatus.stage = 'error';
        currentStatus.errors.push(err.message);
        currentStatus.updatedAt = new Date().toISOString();
        await writeArtifact(runId, 'status.json', JSON.stringify(currentStatus, null, 2));
      } catch (e) {
        console.error('Error updating status on spawn error:', e);
      }
    });

    // Detach process
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
