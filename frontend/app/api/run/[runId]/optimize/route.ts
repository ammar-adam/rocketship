import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { checkRateLimit, getClientIp, RATE_LIMITS, rateLimitResponse } from '@/src/lib/rateLimit';
import { validateRunId, validateOptimizeParams } from '@/src/lib/validation';

// GET /api/run/[runId]/optimize/status - Check optimization status
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  // Rate limiting (light for status checks)
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
    const runsDir = path.join(process.cwd(), '..', 'runs', runId);
    const portfolioPath = path.join(runsDir, 'portfolio.json');
    const errorPath = path.join(runsDir, 'optimize_error.json');
    
    // Check if portfolio exists
    try {
      const stats = await fs.stat(portfolioPath);
      const data = await fs.readFile(portfolioPath, 'utf-8');
      const portfolio = JSON.parse(data);
      
      return NextResponse.json({
        exists: true,
        lastModified: stats.mtime.toISOString(),
        positions: portfolio.allocations?.length || 0
      });
    } catch {
      // Portfolio doesn't exist
    }
    
    // Check if error file exists
    try {
      const errorData = await fs.readFile(errorPath, 'utf-8');
      const error = JSON.parse(errorData);
      return NextResponse.json({
        exists: false,
        error: error.message || 'Optimization failed',
        errorDetails: error
      });
    } catch {
      // No error file either
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
  // Rate limiting (heavy for optimization)
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
    
    // Check if final_buys.json exists
    const runsDir = path.join(process.cwd(), '..', 'runs', runId);
    const finalBuysPath = path.join(runsDir, 'final_buys.json');
    let finalBuysCount = 0;
    
    try {
      const finalBuysData = await fs.readFile(finalBuysPath, 'utf-8');
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
      '-u', // Unbuffered
      pythonScript,
      runId,
      '--capital', String(capital),
      '--max-weight', String(max_weight),
      '--sector-cap', String(sector_cap),
      '--min-positions', String(finalBuysCount),
      '--max-positions', String(finalBuysCount)
    ];
    
    // Use 'py' on Windows, 'python3' elsewhere
    const pythonCmd = process.platform === 'win32' ? 'py' : 'python3';
    
    // Log optimizer start
    const logsPath = path.join(runsDir, 'logs.txt');
    const logLine = `[${new Date().toISOString()}] Starting optimizer: ${pythonCmd} ${args.join(' ')}\n`;
    await fs.appendFile(logsPath, logLine).catch(() => {});
    
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
          // Read and return the portfolio
          try {
            const portfolioPath = path.join(runsDir, 'portfolio.json');
            const portfolioData = await fs.readFile(portfolioPath, 'utf-8');
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
