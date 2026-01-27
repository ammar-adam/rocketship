import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp, RATE_LIMITS, rateLimitResponse } from '@/src/lib/rateLimit';
import { validateRunId, validateOptimizeParams } from '@/src/lib/validation';
import { useBackend, backendPost, backendGet } from '@/src/lib/backend';
import { readArtifact, exists, appendText } from '@/src/lib/storage';

// GET /api/run/[runId]/optimize - Check optimization status
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  // Rate limiting
  const clientIp = getClientIp(request.headers);
  const rateLimitResult = checkRateLimit(clientIp, RATE_LIMITS.light);
  if (!rateLimitResult.success) {
    return rateLimitResponse(rateLimitResult);
  }

  const { runId } = await params;

  // Validate runId
  const runIdValidation = validateRunId(runId);
  if (!runIdValidation.success) {
    return NextResponse.json(
      { error: runIdValidation.error },
      { status: 400 }
    );
  }

  try {
    // ========================================================================
    // PROXY TO PYTHON BACKEND
    // ========================================================================
    if (useBackend()) {
      // Check if portfolio.json exists by fetching the artifact
      const result = await backendGet<unknown>(`/run/${runId}/artifact/portfolio.json`);

      if (result.ok && result.data) {
        const portfolio = result.data as { allocations?: unknown[] };
        return NextResponse.json({
          exists: true,
          lastModified: new Date().toISOString(),
          positions: portfolio.allocations?.length || 0
        });
      }

      return NextResponse.json({
        exists: false,
        error: 'Optimization not run yet'
      });
    }

    // ========================================================================
    // LEGACY: Local filesystem
    // ========================================================================
    if (await exists(runId, 'portfolio.json')) {
      try {
        const data = await readArtifact(runId, 'portfolio.json');
        const portfolio = JSON.parse(data);

        return NextResponse.json({
          exists: true,
          lastModified: new Date().toISOString(),
          positions: portfolio.allocations?.length || 0
        });
      } catch {
        // Error reading portfolio
      }
    }

    // Check if error file exists
    if (await exists(runId, 'optimize_error.json')) {
      try {
        const errorData = await readArtifact(runId, 'optimize_error.json');
        const error = JSON.parse(errorData);
        return NextResponse.json({
          exists: false,
          error: error.message || 'Optimization failed',
          errorDetails: error
        });
      } catch {
        // Error reading error file
      }
    }

    return NextResponse.json({
      exists: false,
      error: 'Optimization not run yet'
    });

  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  // Rate limiting
  const clientIp = getClientIp(request.headers);
  const rateLimitResult = checkRateLimit(clientIp, RATE_LIMITS.heavy);
  if (!rateLimitResult.success) {
    return rateLimitResponse(rateLimitResult);
  }

  const { runId } = await params;

  // Validate runId
  const runIdValidation = validateRunId(runId);
  if (!runIdValidation.success) {
    return NextResponse.json(
      { error: runIdValidation.error },
      { status: 400 }
    );
  }

  try {
    const body = await request.json();

    // Validate optimization parameters
    const paramsValidation = validateOptimizeParams(body);
    if (!paramsValidation.success) {
      return NextResponse.json(
        { error: paramsValidation.error },
        { status: 400 }
      );
    }

    const {
      capital,
      max_weight,
      sector_cap,
      min_positions,
      max_positions
    } = paramsValidation.data!;

    // ========================================================================
    // PROXY TO PYTHON BACKEND
    // ========================================================================
    if (useBackend()) {
      const result = await backendPost<{ success: boolean; message?: string }>(`/run/${runId}/optimize`, {
        capital,
        max_weight,
        sector_cap,
        min_positions,
        max_positions
      });

      if (!result.ok) {
        return NextResponse.json(
          { error: result.error },
          { status: result.status }
        );
      }

      // Return success - client will poll for status/results
      return NextResponse.json(result.data);
    }

    // ========================================================================
    // LEGACY: Local Python execution
    // ========================================================================
    const { spawn } = await import('child_process');
    const path = await import('path');

    // Check if final_buys.json exists
    let finalBuysCount = 0;

    try {
      const finalBuysData = await readArtifact(runId, 'final_buys.json');
      const finalBuys = JSON.parse(finalBuysData);
      finalBuysCount = Array.isArray(finalBuys.items) ? finalBuys.items.length : 0;
    } catch {
      return NextResponse.json(
        { error: 'final_buys.json not found. Run the full debate first.' },
        { status: 400 }
      );
    }

    if (finalBuysCount === 0) {
      return NextResponse.json(
        { error: 'final_buys.json is empty. Run the full debate first.' },
        { status: 400 }
      );
    }

    // Run optimizer
    const repoRoot = path.join(process.cwd(), '..');
    const pythonScript = path.join(repoRoot, 'src', 'optimizer.py');

    const args = [
      '-u',
      pythonScript,
      runId,
      '--capital', String(capital),
      '--max-weight', String(max_weight),
      '--sector-cap', String(sector_cap),
      '--min-positions', String(finalBuysCount),
      '--max-positions', String(finalBuysCount)
    ];

    const pythonCmd = process.platform === 'win32' ? 'py' : 'python3';

    const logLine = `[${new Date().toISOString()}] Starting optimizer: ${pythonCmd} ${args.join(' ')}\n`;
    await appendText(runId, 'logs.txt', logLine).catch(() => {});

    return new Promise<NextResponse>((resolve) => {
      const proc = spawn(pythonCmd, args, {
        cwd: repoRoot,
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
        shell: process.platform === 'win32'
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      proc.on('close', async (code) => {
        if (code === 0) {
          try {
            const portfolioData = await readArtifact(runId, 'portfolio.json');
            const portfolio = JSON.parse(portfolioData);
            resolve(NextResponse.json({ success: true, portfolio }));
          } catch (e) {
            resolve(NextResponse.json(
              { error: 'Failed to read portfolio output', stdout, stderr },
              { status: 500 }
            ));
          }
        } else {
          resolve(NextResponse.json(
            { error: `Optimizer failed with code ${code}`, stdout, stderr },
            { status: 500 }
          ));
        }
      });

      proc.on('error', (err) => {
        resolve(NextResponse.json(
          { error: `Failed to start optimizer: ${err.message}` },
          { status: 500 }
        ));
      });
    });

  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
