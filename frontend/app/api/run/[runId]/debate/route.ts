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
  rocket_rank: number | null;
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

async function updateStatus(
  runDir: string,
  progress: { done: number; total: number; current: string | null; message: string },
  stage: 'debate' | 'debate_ready' = 'debate'
) {
  const statusPath = path.join(runDir, 'status.json');
  try {
    const existing = JSON.parse(await fs.readFile(statusPath, 'utf-8'));
    existing.stage = stage;
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

If you cannot support a claim with evidence, say "insufficient data" - DO NOT invent facts.

Additional reasoning requirements (do not invent data):
- Use provided news headlines to identify a macro or regional trend.
- Explain how that trend flows into revenue, cost, or risk.
- Explicitly label impact as FIRST-order or SECOND-order.
- Bull must rebut Bear's strongest claim; Bear must rebut Bull's strongest claim.
- Regime must define the regime using measurable signals already in context.
- Volume must reference actual price/volume behavior from context.`;

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
  "verdict": "BUY|HOLD|SELL",
  "confidence": 0-100,
  "reasoning": "multi-paragraph explanation of your decision",
  "where_agents_disagreed_most": ["short bullets summarizing key disagreements"],
  "rocket_score_rank_review": "why the RocketScore ranking did or did not hold up for this name",
  "agreed_with": {"bull": ["points agreed"], "bear": ["points agreed"], "regime": ["points agreed"], "volume": ["points agreed"]},
  "rejected": {"bull": ["points rejected"], "bear": ["points rejected"], "regime": ["points rejected"], "volume": ["points rejected"]},
  "key_disagreements": [{"topic": "string", "bull": "bull view", "bear": "bear view", "judge_resolution": "your take"}],
  "decision_triggers": [{"trigger": "what would change verdict", "metric": "string", "threshold": "value", "would_change_to": "BUY|HOLD|SELL"}],
  "tags": ["short labels like 'Margin pressure', 'Capex tailwind'"],
  "sources_used": [{"type": "newsapi|yfinance|artifact", "refs": ["specific references"]}]
}

Rules:
- You MUST reference specific claims from each agent
- You MUST cite which news articles or data points drove your decision
- You MUST explain any reclassification vs RocketScore rank
- Be decisive but acknowledge uncertainty
- Confidence <50 = SELL, 50-70 = HOLD, >70 = BUY (unless bearish evidence overwhelming)`;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  
  try {
    await request.json().catch(() => ({}));
    
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
    
    // Sort by rocket_score and select top 25 ONLY
    const sorted = [...scores].sort((a, b) => b.rocket_score - a.rocket_score);
    const candidates = sorted.slice(0, Math.min(25, sorted.length));
    const rankMap = new Map<string, number>();
    sorted.forEach((s, index) => {
      rankMap.set(s.ticker, index + 1);
    });
    
    // Create directories
    const debateDir = path.join(runsDir, 'debate');
    const newsDir = path.join(runsDir, 'news');
    await fs.mkdir(debateDir, { recursive: true });
    await fs.mkdir(newsDir, { recursive: true });
    
    await appendLog(runsDir, `Starting full debate for top ${candidates.length} RocketScore candidates`);
    await updateStatus(runsDir, {
      done: 0,
      total: candidates.length,
      current: null,
      message: 'Starting debate analysis...'
    });
    
    const summary = {
      buy: [] as string[],
      hold: [] as string[],
      sell: [] as string[],
      candidateCount: candidates.length,
      byTicker: {} as Record<string, {
        verdict: string;
        confidence: number;
        rocket_score: number;
        rocket_rank: number | null;
        sector: string;
        tags: string[];
        final_classification: string;
        consensus_score: number;
      }>
    };
    
    const errors: Array<{ ticker: string; error: string }> = [];
    
    // Check if DeepSeek is available
    const apiKey = process.env.DEEPSEEK_API_KEY;
    const useRealDebate = apiKey && apiKey.length >= 20;
    
    if (!useRealDebate) {
      await appendLog(runsDir, 'WARNING: DeepSeek API key not configured. Using mock debate.');
    }
    
    const computeConsensusScore = (judge: { agreed_with?: Record<string, string[]>; rejected?: Record<string, string[]> }) => {
      const agents = ['bull', 'bear', 'regime', 'volume'] as const;
      let score = 0;
      for (const agent of agents) {
        const agreed = judge.agreed_with?.[agent]?.length || 0;
        const rejected = judge.rejected?.[agent]?.length || 0;
        if (agreed > 0) score += 1;
        if (rejected > 0) score -= 0.5;
      }
      return score;
    };

    for (let i = 0; i < candidates.length; i++) {
      const score = candidates[i];
      const ticker = score.ticker;
      
      await updateStatus(runsDir, {
        done: i,
        total: candidates.length,
        current: ticker,
        message: `Analyzing ${ticker} (${i + 1}/${candidates.length})`
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
          rocket_rank: rankMap.get(ticker) ?? null,
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
          // Note: User prompt must include the word "json" for response_format to work
          
          // Run all 4 agents IN PARALLEL (4x faster!)
          await appendLog(runsDir, `[${ticker}] Running all agents in parallel...`);
          const [bull, bear, regime, volume] = await Promise.all([
            callDeepSeekForDebate(
              buildAgentPrompt('bull'),
              `Analyze ${ticker} and respond with json:\n${contextJson}`,
              runsDir,
              ticker
            ),
            callDeepSeekForDebate(
              buildAgentPrompt('bear'),
              `Analyze ${ticker} and respond with json:\n${contextJson}`,
              runsDir,
              ticker
            ),
            callDeepSeekForDebate(
              buildAgentPrompt('regime'),
              `Analyze ${ticker} and respond with json:\n${contextJson}`,
              runsDir,
              ticker
            ),
            callDeepSeekForDebate(
              buildAgentPrompt('volume'),
              `Analyze ${ticker} and respond with json:\n${contextJson}`,
              runsDir,
              ticker
            )
          ]);
          await appendLog(runsDir, `[${ticker}] All agents completed`);
          
          // Run Judge (needs all agent outputs)
          await appendLog(runsDir, `[${ticker}] Running Judge...`);
          const judgeInput = JSON.stringify({ bull, bear, regime, volume, context }, null, 2);
          const judge = await callDeepSeekForDebate(
            buildJudgePrompt(),
            `Review these agent memos and respond with json verdict:\n${judgeInput}`,
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
                          score.rocket_score >= 50 ? 'HOLD' : 'SELL';
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
        const judgeData = debate.judge as { verdict: string; confidence: number; tags?: string[]; agreed_with?: Record<string, string[]>; rejected?: Record<string, string[]> };
        const verdictRaw = (judgeData.verdict || 'HOLD').toUpperCase();
        const verdict = verdictRaw === 'WAIT' ? 'SELL' : verdictRaw;
        const confidence = judgeData.confidence || 50;
        const tags = (judgeData.tags || score.tags || []).slice(0, 4);
        const consensusScore = computeConsensusScore(judgeData);
        
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
          rocket_rank: rankMap.get(ticker) ?? null,
          sector: score.sector,
          tags,
          final_classification: verdict,
          consensus_score: consensusScore
        };
        
        if (verdict === 'BUY') summary.buy.push(ticker);
        else if (verdict === 'HOLD') summary.hold.push(ticker);
        else summary.sell.push(ticker);
        
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
      path.join(debateDir, 'debate_summary.json'),
      JSON.stringify(summary, null, 2)
    );

    const finalBuyCandidates = summary.buy
      .map((ticker) => ({ ticker, ...(summary.byTicker[ticker] || {}) }))
      .filter((entry) => entry.ticker);

    finalBuyCandidates.sort((a, b) => {
      if ((b.confidence || 0) !== (a.confidence || 0)) {
        return (b.confidence || 0) - (a.confidence || 0);
      }
      if ((b.consensus_score || 0) !== (a.consensus_score || 0)) {
        return (b.consensus_score || 0) - (a.consensus_score || 0);
      }
      return (a.rocket_rank || 999) - (b.rocket_rank || 999);
    });

    const finalBuyCap = Math.min(12, finalBuyCandidates.length);
    const finalBuys = finalBuyCandidates.slice(0, finalBuyCap);
    if (finalBuys.length < 8) {
      await appendLog(runsDir, `Warning: Only ${finalBuys.length} BUYs available for final selection (target 8-12).`);
    }

    await fs.writeFile(
      path.join(runsDir, 'final_buys.json'),
      JSON.stringify({
        runId,
        createdAt: new Date().toISOString(),
        selection: {
          total_buy: summary.buy.length,
          selected: finalBuys.length
        },
        items: finalBuys
      }, null, 2)
    );
    
    // Write errors if any
    if (errors.length > 0) {
      await fs.writeFile(
        path.join(debateDir, 'debate_error.json'),
        JSON.stringify({ errors, timestamp: new Date().toISOString() }, null, 2)
      );
    }
    
    // Update final status
    await updateStatus(
      runsDir,
      {
        done: candidates.length,
        total: candidates.length,
        current: null,
        message: `Debate complete: ${summary.buy.length} BUY, ${summary.hold.length} HOLD, ${summary.sell.length} SELL`
      },
      'debate_ready'
    );
    
    await appendLog(runsDir, `Debate complete. BUY: ${summary.buy.length}, HOLD: ${summary.hold.length}, SELL: ${summary.sell.length}`);
    
    return NextResponse.json({
      success: true,
      summary: {
        buy: summary.buy.length,
        hold: summary.hold.length,
        sell: summary.sell.length,
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
