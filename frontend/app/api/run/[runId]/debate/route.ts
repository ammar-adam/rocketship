import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import { fetchNewsForTicker, NewsArticle } from '@/lib/newsapi';

interface RocketScoreData {
  ticker: string;
  rocket_score: number;
  sector: string;
  tags: string[];
  technical_score: number;
  volume_score: number;
  quality_score: number;
  macro_score: number;
  current_price: number;
  signal_labels?: string[];
  technical_details?: {
    raw_metrics: Record<string, unknown>;
    rationale: string[];
  };
  volume_details?: {
    raw_metrics: Record<string, unknown>;
    rationale: string[];
  };
  quality_details?: {
    raw_metrics: Record<string, unknown>;
    rationale: string[];
    warnings?: string[];
  };
  macro_details?: {
    raw_metrics: Record<string, unknown>;
    rationale: string[];
    matched_trends?: Array<{ name: string; confidence: number; thesis: string }>;
  };
}

interface DebateContext {
  ticker: string;
  sector: string;
  current_price: number;
  rocket_score: number;
  technical_score: number;
  volume_score: number;
  quality_score: number;
  macro_score: number;
  tags: string[];
  technical_metrics: Record<string, unknown>;
  volume_metrics: Record<string, unknown>;
  quality_metrics: Record<string, unknown>;
  macro_info: Record<string, unknown>;
  news: NewsArticle[];
}

const DEEPSEEK_API_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';

async function callDeepSeekForDebate(
  systemPrompt: string,
  userPrompt: string,
  runDir: string,
  ticker: string
): Promise<unknown> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  
  if (!apiKey || apiKey.length < 20) {
    const error = 'DEEPSEEK_API_KEY not configured. Add to frontend/.env.local and restart.';
    await appendLog(runDir, `[${ticker}] ERROR: ${error}`);
    throw new Error(error);
  }
  
  try {
    const response = await fetch(`${DEEPSEEK_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.4,
        max_tokens: 3000,
        response_format: { type: 'json_object' }
      })
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      const error = `DeepSeek API error ${response.status}: ${errorText.substring(0, 200)}`;
      await appendLog(runDir, `[${ticker}] ERROR: ${error}`);
      throw new Error(error);
    }
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      const error = 'Empty response from DeepSeek';
      await appendLog(runDir, `[${ticker}] ERROR: ${error}`);
      throw new Error(error);
    }
    
    return JSON.parse(content);
    
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    await appendLog(runDir, `[${ticker}] DeepSeek call failed: ${errorMsg}`);
    throw error;
  }
}

async function appendLog(runDir: string, message: string) {
  const logsPath = path.join(runDir, 'logs.txt');
  const timestamp = new Date().toISOString();
  try {
    await fs.appendFile(logsPath, `[${timestamp}] ${message}\n`);
  } catch {
    // Ignore log write errors
  }
}

async function updateStatus(runDir: string, progress: { done: number; total: number; current: string | null; message: string }) {
  const statusPath = path.join(runDir, 'status.json');
  try {
    const existing = JSON.parse(await fs.readFile(statusPath, 'utf-8'));
    existing.stage = 'debate';
    existing.progress = progress;
    existing.updatedAt = new Date().toISOString();
    await fs.writeFile(statusPath, JSON.stringify(existing, null, 2));
  } catch {
    // Ignore status write errors
  }
}

function buildAgentPrompt(agent: 'bull' | 'bear' | 'regime' | 'volume'): string {
  const basePrompt = `You are a senior Wall Street analyst writing an investment memo for your portfolio manager.
Your output MUST be valid JSON matching the exact schema below. Be specific, cite evidence, and connect news to company impact.

Every claim MUST have evidence from:
- "newsapi" (cite article URL)
- "yfinance" (cite as market data)
- "artifact" (cite RocketScore fields)

If you cannot support a claim with evidence, say "insufficient data" - DO NOT invent facts.`;

  const schemas: Record<string, string> = {
    bull: `{
  "agent": "bull",
  "thesis": "3-6 paragraphs explaining the bull case with specific evidence",
  "key_points": [{"claim": "string", "evidence": "string", "numbers": "string or null", "source": "newsapi|yfinance|artifact"}],
  "trend_map": [{"trend": "macro trend name", "why_it_matters": "string", "company_link": "how it affects this company", "evidence": "string"}],
  "risks": [{"risk": "string", "why": "string", "monitoring_metric": "what to watch"}],
  "catalysts": [{"catalyst": "string", "timeframe": "string", "measurable_signal": "string"}],
  "what_changes_my_mind": [{"condition": "string", "metric_to_watch": "string"}],
  "rebuttals_to_bear": ["address bear's strongest 2 points"]
}`,
    bear: `{
  "agent": "bear",
  "thesis": "3-6 paragraphs explaining the bear case with specific evidence",
  "key_points": [{"claim": "string", "evidence": "string", "numbers": "string or null", "source": "newsapi|yfinance|artifact"}],
  "trend_map": [{"trend": "macro trend name", "why_it_matters": "string", "company_link": "how it hurts this company", "evidence": "string"}],
  "risks": [{"risk": "to bull thesis", "why": "string", "monitoring_metric": "what to watch"}],
  "catalysts": [{"catalyst": "negative catalyst", "timeframe": "string", "measurable_signal": "string"}],
  "what_changes_my_mind": [{"condition": "string", "metric_to_watch": "string"}],
  "rebuttals_to_bull": ["address bull's strongest 2 points"]
}`,
    regime: `{
  "agent": "regime",
  "thesis": "2-4 paragraphs on market regime and sector positioning",
  "regime_classification": "risk-on|risk-off|neutral",
  "supporting_signals": [{"signal": "string", "reading": "value", "interpretation": "string", "source": "yfinance|artifact"}],
  "sector_positioning": "string describing sector dynamics",
  "correlation_regime": "how correlations are behaving",
  "trend_map": [{"trend": "macro trend", "regime_impact": "how it affects risk appetite", "evidence": "string"}],
  "recommendation": "string"
}`,
    volume: `{
  "agent": "volume",
  "thesis": "2-4 paragraphs on volume/flow analysis",
  "flow_assessment": "accumulation|distribution|neutral",
  "volume_signals": [{"signal": "string", "value": "string", "interpretation": "string", "source": "yfinance|artifact"}],
  "institutional_activity": "string",
  "liquidity_assessment": "string",
  "trend_map": [{"trend": "flow trend", "implication": "what it means for price", "evidence": "string"}],
  "recommendation": "string"
}`
  };

  return `${basePrompt}\n\nYou are the ${agent.toUpperCase()} analyst. Output EXACTLY this JSON schema:\n${schemas[agent]}`;
}

function buildJudgePrompt(): string {
  return `You are the JUDGE - a senior portfolio manager making the final investment decision.
Review all agent memos and news, then output your verdict as JSON.

Your output MUST follow this exact schema:
{
  "verdict": "BUY|HOLD|WAIT",
  "confidence": 0-100,
  "reasoning": "multi-paragraph explanation of your decision",
  "agreed_with": {"bull": ["points agreed"], "bear": ["points agreed"], "regime": ["points agreed"], "volume": ["points agreed"]},
  "rejected": {"bull": ["points rejected"], "bear": ["points rejected"], "regime": ["points rejected"], "volume": ["points rejected"]},
  "key_disagreements": [{"topic": "string", "bull": "bull view", "bear": "bear view", "judge_resolution": "your take"}],
  "decision_triggers": [{"trigger": "what would change verdict", "metric": "string", "threshold": "value", "would_change_to": "BUY|HOLD|WAIT"}],
  "tags": ["short labels like 'Margin pressure', 'Capex tailwind'"],
  "sources_used": [{"type": "newsapi|yfinance|artifact", "refs": ["specific references"]}]
}

Rules:
- You MUST reference specific claims from each agent
- You MUST cite which news articles or data points drove your decision
- Be decisive but acknowledge uncertainty
- Confidence <50 = WAIT, 50-70 = HOLD, >70 = BUY (unless bearish evidence overwhelming)`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  
  try {
    const body = await request.json().catch(() => ({}));
    const { selection = 'top25', limit = 25 } = body;
    
    const runsDir = path.join(process.cwd(), '..', 'runs', runId);
    
    // Check if rocket_scores.json exists
    const scoresPath = path.join(runsDir, 'rocket_scores.json');
    let scores: RocketScoreData[];
    
    try {
      const scoresData = await fs.readFile(scoresPath, 'utf-8');
      scores = JSON.parse(scoresData);
    } catch {
      return NextResponse.json(
        { error: 'rocket_scores.json not found. Run RocketScore first.' },
        { status: 400 }
      );
    }
    
    // Sort by rocket_score and select candidates
    const sorted = [...scores].sort((a, b) => b.rocket_score - a.rocket_score);
    let candidates: RocketScoreData[];
    
    switch (selection) {
      case 'top50':
        candidates = sorted.slice(0, Math.min(50, sorted.length));
        break;
      case 'near_cutoff':
        candidates = sorted.slice(25, 50);
        break;
      case 'all':
        candidates = sorted.slice(0, Math.min(limit, 50)); // Max 50 for safety
        break;
      default: // top25
        candidates = sorted.slice(0, Math.min(25, sorted.length));
    }
    
    // Create directories
    const debateDir = path.join(runsDir, 'debate');
    const newsDir = path.join(runsDir, 'news');
    await fs.mkdir(debateDir, { recursive: true });
    await fs.mkdir(newsDir, { recursive: true });
    
    await appendLog(runsDir, `Starting debate for ${candidates.length} candidates (selection: ${selection})`);
    await updateStatus(runsDir, {
      done: 0,
      total: candidates.length,
      current: null,
      message: 'Starting debate analysis...'
    });
    
    const summary = {
      buy: [] as string[],
      hold: [] as string[],
      wait: [] as string[],
      selection,
      candidateCount: candidates.length,
      byTicker: {} as Record<string, {
        verdict: string;
        confidence: number;
        rocket_score: number;
        sector: string;
        tags: string[];
      }>
    };
    
    const errors: Array<{ ticker: string; error: string }> = [];
    
    // Check if DeepSeek is available
    const apiKey = process.env.DEEPSEEK_API_KEY;
    const useRealDebate = apiKey && apiKey.length >= 20;
    
    if (!useRealDebate) {
      await appendLog(runsDir, 'WARNING: DeepSeek API key not configured. Using mock debate.');
    }
    
    for (let i = 0; i < candidates.length; i++) {
      const score = candidates[i];
      const ticker = score.ticker;
      
      await updateStatus(runsDir, {
        done: i,
        total: candidates.length,
        current: ticker,
        message: `Analyzing ${ticker}...`
      });
      
      try {
        // Fetch news for this ticker
        await appendLog(runsDir, `[${ticker}] Fetching news...`);
        const newsResult = await fetchNewsForTicker(ticker, { days: 14, limit: 8 });
        
        // Save news artifact
        await fs.writeFile(
          path.join(newsDir, `news_${ticker}.json`),
          JSON.stringify(newsResult, null, 2)
        );
        
        if (newsResult.error) {
          await appendLog(runsDir, `[${ticker}] News fetch warning: ${newsResult.error}`);
        } else {
          await appendLog(runsDir, `[${ticker}] Got ${newsResult.articles.length} news articles`);
        }
        
        // Build debate context
        const context: DebateContext = {
          ticker,
          sector: score.sector,
          current_price: score.current_price,
          rocket_score: score.rocket_score,
          technical_score: score.technical_score,
          volume_score: score.volume_score,
          quality_score: score.quality_score,
          macro_score: score.macro_score,
          tags: score.tags || [],
          technical_metrics: score.technical_details?.raw_metrics || {},
          volume_metrics: score.volume_details?.raw_metrics || {},
          quality_metrics: score.quality_details?.raw_metrics || {},
          macro_info: score.macro_details?.raw_metrics || {},
          news: newsResult.articles
        };
        
        const contextJson = JSON.stringify(context, null, 2);
        
        let debate;
        
        if (useRealDebate) {
          // Run real DeepSeek debate
          await appendLog(runsDir, `[${ticker}] Running Bull agent...`);
          const bull = await callDeepSeekForDebate(
            buildAgentPrompt('bull'),
            `Analyze ${ticker}:\n${contextJson}`,
            runsDir,
            ticker
          );
          
          await appendLog(runsDir, `[${ticker}] Running Bear agent...`);
          const bear = await callDeepSeekForDebate(
            buildAgentPrompt('bear'),
            `Analyze ${ticker}:\n${contextJson}`,
            runsDir,
            ticker
          );
          
          await appendLog(runsDir, `[${ticker}] Running Regime agent...`);
          const regime = await callDeepSeekForDebate(
            buildAgentPrompt('regime'),
            `Analyze ${ticker}:\n${contextJson}`,
            runsDir,
            ticker
          );
          
          await appendLog(runsDir, `[${ticker}] Running Volume agent...`);
          const volume = await callDeepSeekForDebate(
            buildAgentPrompt('volume'),
            `Analyze ${ticker}:\n${contextJson}`,
            runsDir,
            ticker
          );
          
          await appendLog(runsDir, `[${ticker}] Running Judge...`);
          const judgeInput = JSON.stringify({ bull, bear, regime, volume, context }, null, 2);
          const judge = await callDeepSeekForDebate(
            buildJudgePrompt(),
            `Review these agent memos and make your decision:\n${judgeInput}`,
            runsDir,
            ticker
          ) as { verdict: string; confidence: number; tags?: string[] };
          
          debate = {
            ticker,
            agents: { bull, bear, regime, volume },
            judge,
            cross_exam: [],
            createdAt: new Date().toISOString(),
            context,
            data_sources: ['yfinance', 'newsapi', 'RocketScore'],
            warnings: []
          };
          
        } else {
          // Mock debate (fallback)
          const verdict = score.rocket_score >= 70 ? 'BUY' : 
                          score.rocket_score >= 50 ? 'HOLD' : 'WAIT';
          const confidence = Math.min(85, Math.max(20, Math.round(score.rocket_score)));
          
          debate = {
            ticker,
            agents: {
              bull: { agent: 'bull', thesis: `Bull case for ${ticker}`, key_points: [], trend_map: [], risks: [], catalysts: [], what_changes_my_mind: [] },
              bear: { agent: 'bear', thesis: `Bear case for ${ticker}`, key_points: [], trend_map: [], risks: [], catalysts: [], what_changes_my_mind: [] },
              regime: { agent: 'regime', thesis: `Regime analysis for ${ticker}`, regime_classification: 'neutral', supporting_signals: [], trend_map: [] },
              volume: { agent: 'volume', thesis: `Volume analysis for ${ticker}`, flow_assessment: 'neutral', volume_signals: [], trend_map: [] }
            },
            judge: { verdict, confidence, reasoning: 'Mock verdict based on RocketScore', agreed_with: {}, rejected: {}, key_disagreements: [], decision_triggers: [], tags: score.tags || [], sources_used: [] },
            cross_exam: [],
            createdAt: new Date().toISOString(),
            context,
            data_sources: ['yfinance', 'RocketScore'],
            warnings: ['Mock debate - configure DEEPSEEK_API_KEY for real analysis']
          };
        }
        
        // Extract verdict
        const judgeData = debate.judge as { verdict: string; confidence: number; tags?: string[] };
        const verdict = (judgeData.verdict || 'WAIT').toUpperCase();
        const confidence = judgeData.confidence || 50;
        
        // Write debate file
        await fs.writeFile(
          path.join(debateDir, `${ticker}.json`),
          JSON.stringify(debate, null, 2)
        );
        
        // Update summary
        summary.byTicker[ticker] = {
          verdict,
          confidence,
          rocket_score: score.rocket_score,
          sector: score.sector,
          tags: judgeData.tags || score.tags || []
        };
        
        if (verdict === 'BUY') summary.buy.push(ticker);
        else if (verdict === 'HOLD') summary.hold.push(ticker);
        else summary.wait.push(ticker);
        
        await appendLog(runsDir, `[${ticker}] Completed: ${verdict} (${confidence}%)`);
        
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        errors.push({ ticker, error: errorMsg });
        await appendLog(runsDir, `[${ticker}] FAILED: ${errorMsg}`);
        
        // Write error marker
        await fs.writeFile(
          path.join(debateDir, `${ticker}_error.json`),
          JSON.stringify({ ticker, error: errorMsg, timestamp: new Date().toISOString() }, null, 2)
        );
      }
    }
    
    // Write summary
    await fs.writeFile(
      path.join(runsDir, 'debate_summary.json'),
      JSON.stringify(summary, null, 2)
    );
    
    // Write errors if any
    if (errors.length > 0) {
      await fs.writeFile(
        path.join(debateDir, 'debate_error.json'),
        JSON.stringify({ errors, timestamp: new Date().toISOString() }, null, 2)
      );
    }
    
    // Update final status
    await updateStatus(runsDir, {
      done: candidates.length,
      total: candidates.length,
      current: null,
      message: `Debate complete: ${summary.buy.length} BUY, ${summary.hold.length} HOLD, ${summary.wait.length} WAIT`
    });
    
    await appendLog(runsDir, `Debate complete. BUY: ${summary.buy.length}, HOLD: ${summary.hold.length}, WAIT: ${summary.wait.length}`);
    
    return NextResponse.json({
      success: true,
      summary: {
        buy: summary.buy.length,
        hold: summary.hold.length,
        wait: summary.wait.length,
        total: Object.keys(summary.byTicker).length,
        errors: errors.length
      }
    });
    
  } catch (error) {
    console.error('Debate error:', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
