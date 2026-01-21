import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';

export async function POST(
  request: Request,
  { params }: { params: { runId: string } }
) {
  const { runId } = params;
  
  try {
    const runsDir = path.join(process.cwd(), '..', 'runs', runId);
    
    // Check if rocket_scores.json exists
    const scoresPath = path.join(runsDir, 'rocket_scores.json');
    let scores: Array<{
      ticker: string;
      rocket_score: number;
      sector: string;
      tags: string[];
      technical_score: number;
      volume_score: number;
      quality_score: number;
      macro_score: number;
      current_price: number;
      technical_details?: unknown;
      volume_details?: unknown;
      quality_details?: unknown;
      macro_details?: unknown;
    }>;
    
    try {
      const scoresData = await fs.readFile(scoresPath, 'utf-8');
      scores = JSON.parse(scoresData);
    } catch {
      return NextResponse.json(
        { error: 'rocket_scores.json not found. Run RocketScore first.' },
        { status: 400 }
      );
    }
    
    // Create debate directory
    const debateDir = path.join(runsDir, 'debate');
    await fs.mkdir(debateDir, { recursive: true });
    
    // Generate mock debates for each stock (in production, call DeepSeek)
    const summary = {
      buy: [] as string[],
      hold: [] as string[],
      wait: [] as string[],
      byTicker: {} as Record<string, {
        verdict: string;
        confidence: number;
        rocket_score: number;
        sector: string;
        tags: string[];
      }>
    };
    
    for (const score of scores.slice(0, 25)) { // Top 25 only for debate
      const verdict = score.rocket_score >= 70 ? 'BUY' : 
                      score.rocket_score >= 50 ? 'HOLD' : 'WAIT';
      const confidence = Math.min(85, Math.max(20, Math.round(score.rocket_score)));
      
      // Generate mock debate
      const debate = {
        ticker: score.ticker,
        agents: {
          bull: {
            executive_summary: `${score.ticker} presents a compelling opportunity with RocketScore of ${score.rocket_score.toFixed(1)}/100.`,
            core_thesis: `Technical momentum shows ${score.technical_score}/100 with favorable volume patterns at ${score.volume_score}/100.`,
            metrics_table: [
              { metric: 'RocketScore', value: `${score.rocket_score.toFixed(1)}`, interpretation: 'Strong momentum signal' },
              { metric: 'Technical', value: `${score.technical_score}/100`, interpretation: 'Price trend analysis' },
              { metric: 'Volume', value: `${score.volume_score}/100`, interpretation: 'Flow signals' }
            ],
            catalysts: [{ event: 'Continued momentum', timeframe: '30 days', impact: 'Price appreciation' }],
            risks: [{ risk: 'Reversal', probability: 'Medium', mitigation: 'Stop loss' }],
            what_would_change_my_mind: [{ trigger: 'Score below 50', threshold: '<50' }],
            time_horizon: '3-6 months',
            sources: ['yfinance', 'RocketScore']
          },
          bear: {
            executive_summary: `Caution warranted on ${score.ticker} given quality score of ${score.quality_score}/100.`,
            core_thesis: `Quality concerns with fundamentals showing ${score.quality_score}/100.`,
            metrics_table: [
              { metric: 'Quality', value: `${score.quality_score}/100`, interpretation: 'Fundamental assessment' }
            ],
            catalysts: [{ event: 'Sector rotation', timeframe: 'Near-term', impact: 'Potential outflows' }],
            risks: [{ risk: 'Continued momentum', probability: 'Medium', mitigation: 'Small size' }],
            what_would_change_my_mind: [{ trigger: 'Quality improves above 70', threshold: '>70' }],
            time_horizon: '1-3 months',
            sources: ['yfinance', 'RocketScore']
          },
          regime: {
            executive_summary: `Market regime is ${verdict === 'BUY' ? 'supportive' : 'neutral'} for ${score.ticker}.`,
            regime_classification: verdict === 'BUY' ? 'risk-on' : 'neutral',
            supporting_signals: [{ signal: 'Macro Score', reading: `${score.macro_score}/100`, interpretation: 'Sector positioning' }],
            sector_positioning: `${score.sector} showing ${score.macro_score >= 60 ? 'strength' : 'mixed signals'}`,
            recommendation: verdict === 'BUY' ? 'Supports long' : 'Exercise caution',
            sources: ['Sector analysis']
          },
          volume: {
            executive_summary: `Volume analysis indicates ${score.volume_score >= 60 ? 'accumulation' : 'neutral'} patterns.`,
            flow_assessment: score.volume_score >= 60 ? 'accumulation' : 'neutral',
            volume_signals: [{ signal: 'Volume Score', value: `${score.volume_score}/100`, interpretation: 'Flow assessment' }],
            institutional_activity: score.volume_score >= 70 ? 'Elevated institutional interest' : 'Normal activity',
            recommendation: score.volume_score >= 60 ? 'Volume supports thesis' : 'Volume neutral',
            sources: ['yfinance volume']
          }
        },
        judge: {
          verdict,
          confidence,
          executive_summary: `Based on RocketScore of ${score.rocket_score.toFixed(1)}/100, verdict is ${verdict}.`,
          agreements: {
            bull: ['Technical metrics accurate'],
            bear: ['Quality concerns noted'],
            regime: ['Sector assessment reasonable'],
            volume: ['Flow analysis sound']
          },
          rejections: {
            bull: verdict !== 'BUY' ? ['Overly optimistic'] : [],
            bear: verdict === 'BUY' ? ['Underweighting momentum'] : [],
            regime: [],
            volume: []
          },
          key_metrics_driving_decision: [
            { metric: 'RocketScore', value: `${score.rocket_score.toFixed(1)}`, weight: 'Primary' },
            { metric: 'Technical', value: `${score.technical_score}`, weight: 'High' }
          ],
          decision_triggers: [
            { condition: 'Score < 40', new_verdict: 'WAIT' },
            { condition: 'Score > 75', new_verdict: 'BUY' }
          ],
          position_sizing: verdict === 'BUY' ? '3-5%' : '0-1%',
          time_horizon: '3-6 months'
        },
        cross_exam: [],
        createdAt: new Date().toISOString(),
        data_sources: ['yfinance', 'RocketScore'],
        warnings: ['Mock debate - configure DeepSeek API for full analysis']
      };
      
      // Write individual debate file
      await fs.writeFile(
        path.join(debateDir, `${score.ticker}.json`),
        JSON.stringify(debate, null, 2)
      );
      
      // Update summary
      summary.byTicker[score.ticker] = {
        verdict,
        confidence,
        rocket_score: score.rocket_score,
        sector: score.sector,
        tags: score.tags || []
      };
      
      if (verdict === 'BUY') summary.buy.push(score.ticker);
      else if (verdict === 'HOLD') summary.hold.push(score.ticker);
      else summary.wait.push(score.ticker);
    }
    
    // Write summary
    await fs.writeFile(
      path.join(runsDir, 'debate_summary.json'),
      JSON.stringify(summary, null, 2)
    );
    
    return NextResponse.json({
      success: true,
      summary: {
        buy: summary.buy.length,
        hold: summary.hold.length,
        wait: summary.wait.length,
        total: Object.keys(summary.byTicker).length
      }
    });
    
  } catch (error) {
    console.error('Debate error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
