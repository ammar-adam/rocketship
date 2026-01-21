import { NextResponse } from 'next/server';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

export async function POST(
  request: Request,
  { params }: { params: { runId: string } }
) {
  const { runId } = params;
  
  try {
    const body = await request.json();
    const {
      capital = 10000,
      max_weight = 0.12,
      sector_cap = 0.35,
      min_positions = 8,
      max_positions = 25
    } = body;
    
    // Check if rocket_scores.json exists
    const runsDir = path.join(process.cwd(), '..', 'runs', runId);
    const scoresPath = path.join(runsDir, 'rocket_scores.json');
    
    try {
      await fs.access(scoresPath);
    } catch {
      return NextResponse.json(
        { error: 'rocket_scores.json not found. Run RocketScore first.' },
        { status: 400 }
      );
    }
    
    // Run optimizer
    const pythonScript = path.join(process.cwd(), '..', 'src', 'optimizer.py');
    
    const args = [
      pythonScript,
      runId,
      '--capital', String(capital),
      '--max-weight', String(max_weight),
      '--sector-cap', String(sector_cap),
      '--min-positions', String(min_positions),
      '--max-positions', String(max_positions)
    ];
    
    return new Promise((resolve) => {
      const proc = spawn('python', args, {
        cwd: path.join(process.cwd(), '..'),
        env: { ...process.env },
        shell: true
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
