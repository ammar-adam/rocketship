import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { generateDebate } from '@/src/lib/deepseek';

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
    const universePath = path.join(runDir, 'universe.json');
    const scoresPath = path.join(runDir, 'rocket_scores.json');
    const debateDir = path.join(runDir, 'debate');
    
    // Validate run exists
    if (!fs.existsSync(runDir)) {
      return NextResponse.json({ error: 'Run not found' }, { status: 404 });
    }
    
    // Read universe and scores
    if (!fs.existsSync(universePath)) {
      return NextResponse.json({ error: 'universe.json not found' }, { status: 400 });
    }
    
    if (!fs.existsSync(scoresPath)) {
      return NextResponse.json({ error: 'rocket_scores.json not found. Run RocketScore first.' }, { status: 400 });
    }
    
    const universe = JSON.parse(fs.readFileSync(universePath, 'utf-8'));
    const scores = JSON.parse(fs.readFileSync(scoresPath, 'utf-8'));
    
    // Create debate directory
    fs.mkdirSync(debateDir, { recursive: true });
    
    // Update status
    const tickers = scores.map((s: { ticker: string }) => s.ticker);
    const updateStatus = (done: number, current: string | null, message: string, stage = 'debate') => {
      const status = {
        runId,
        stage,
        progress: { done, total: tickers.length, current, message },
        updatedAt: new Date().toISOString(),
        errors: []
      };
      fs.writeFileSync(statusPath, JSON.stringify(status, null, 2));
    };
    
    const appendLog = (msg: string) => {
      const timestamp = new Date().toISOString();
      fs.appendFileSync(logsPath, `[${timestamp}] ${msg}\n`);
    };
    
    updateStatus(0, null, 'Starting debate analysis...');
    appendLog('Starting DeepSeek debate stage');
    
    // Track verdicts for summary
    const summary: { buy: string[]; hold: string[]; wait: string[] } = { buy: [], hold: [], wait: [] };
    
    // Process each ticker
    for (let i = 0; i < scores.length; i++) {
      const row = scores[i];
      const ticker = row.ticker;
      
      updateStatus(i, ticker, `Analyzing ${ticker} (${i + 1}/${tickers.length})...`);
      appendLog(`Debating ${ticker}...`);
      
      try {
        const debate = await generateDebate(ticker, row);
        
        // Write debate file
        const debatePath = path.join(debateDir, `${ticker}.json`);
        fs.writeFileSync(debatePath, JSON.stringify(debate, null, 2));
        
        // Track verdict
        const verdict = debate.judge.verdict.toUpperCase();
        if (verdict === 'BUY') summary.buy.push(ticker);
        else if (verdict === 'HOLD') summary.hold.push(ticker);
        else summary.wait.push(ticker);
        
        appendLog(`${ticker}: ${debate.judge.verdict} (confidence: ${(debate.judge.confidence * 100).toFixed(0)}%)`);
        
      } catch (error) {
        appendLog(`ERROR debating ${ticker}: ${error instanceof Error ? error.message : 'unknown'}`);
        summary.wait.push(ticker);
        
        // Write error debate file
        const errorDebate = {
          ticker,
          agents: {
            bull: { summary: '', points: [], risks: [], sources: [] },
            bear: { summary: '', points: [], risks: [], sources: [] },
            regime: { summary: '', regime: 'neutral', why: '', sources: [] },
            volume: { summary: '', signals: [], why: '', sources: [] }
          },
          judge: {
            verdict: 'WAIT',
            confidence: 0,
            rationale: `Error: ${error instanceof Error ? error.message : 'unknown'}`,
            key_disagreements: [],
            what_would_change_mind: []
          },
          createdAt: new Date().toISOString()
        };
        const debatePath = path.join(debateDir, `${ticker}.json`);
        fs.writeFileSync(debatePath, JSON.stringify(errorDebate, null, 2));
      }
    }
    
    // Write debate summary
    const summaryPath = path.join(runDir, 'debate_summary.json');
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2));
    
    updateStatus(tickers.length, null, 'Debate complete', 'optimize_ready');
    appendLog(`Debate complete: ${summary.buy.length} BUY, ${summary.hold.length} HOLD, ${summary.wait.length} WAIT`);
    
    return NextResponse.json({ ok: true, summary });
    
  } catch (error) {
    console.error('Error running debate:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
