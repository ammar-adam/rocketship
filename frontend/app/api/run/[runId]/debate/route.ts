import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, getClientIp, RATE_LIMITS, rateLimitResponse } from '@/src/lib/rateLimit';
import { validateRunId, validateDebateRequest } from '@/src/lib/validation';
import { useBackend, backendPost } from '@/src/lib/backend';
import { fetchNewsForTicker, NewsArticle } from '@/lib/newsapi';
import { appendText, writeArtifact, readArtifact, exists, ensureRunDir } from '@/src/lib/storage';

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

interface DebateSelectionItem {
  rank: number;
  ticker: string;
  rocket_score: number;
  sector: string;
  selection_group: 'top25' | 'near_cutoff' | 'best_of_worst' | 'extra';
}

const DEEPSEEK_API_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';

function isValidTicker(ticker: string): boolean {
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(ticker);
}

async function callDeepSeekForDebate(
  systemPrompt: string,
  userPrompt: string,
  runId: string,
  ticker: string
): Promise<unknown> {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey || apiKey.length < 20) {
    const error = 'Missing DEEPSEEK_API_KEY';
    await appendLog(runId, `[${ticker}] ERROR: ${error}`);
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
      await appendLog(runId, `[${ticker}] ERROR: ${error}`);
      throw new Error(error);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      const error = 'Empty response from DeepSeek';
      await appendLog(runId, `[${ticker}] ERROR: ${error}`);
      throw new Error(error);
    }

    return JSON.parse(content);

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    await appendLog(runId, `[${ticker}] DeepSeek call failed: ${errorMsg}`);
    throw error;
  }
}

async function appendLog(runId: string, message: string) {
  const timestamp = new Date().toISOString();
  try {
    await appendText(runId, 'logs.txt', `[${timestamp}] ${message}\n`);
  } catch {
    // Ignore log write errors
  }
}

async function updateStatus(
  runId: string,
  progress: { done: number; total: number; current: string | null; message: string },
  stage: 'debate' | 'debate_ready' | 'error' = 'debate'
) {
  try {
    const statusContent = await readArtifact(runId, 'status.json');
    const existing = JSON.parse(statusContent);
    existing.stage = stage;
    existing.progress = progress;
    existing.updatedAt = new Date().toISOString();
    await writeArtifact(runId, 'status.json', JSON.stringify(existing, null, 2));
  } catch {
    // Ignore status write errors
  }
}

function buildAgentPrompt(agent: 'bull' | 'bear' | 'regime' | 'volume'): string {
  const basePrompt = `You are a senior Wall Street analyst writing an investment memo.
Your output MUST be valid JSON. Be specific and cite evidence.`;

  const schemas: Record<string, string> = {
    bull: `{"agent":"bull","thesis":"string","key_points":[],"risks":[],"catalysts":[],"confidence":0}`,
    bear: `{"agent":"bear","thesis":"string","key_points":[],"risks":[],"catalysts":[],"confidence":0}`,
    regime: `{"agent":"regime","thesis":"string","regime_classification":"risk-on|risk-off|neutral","confidence":0}`,
    volume: `{"agent":"volume","thesis":"string","flow_assessment":"accumulation|distribution|neutral","confidence":0}`
  };

  return `${basePrompt}\n\nYou are the ${agent.toUpperCase()} analyst. Output JSON:\n${schemas[agent]}`;
}

function buildJudgePrompt(): string {
  return `You are the JUDGE making final investment decisions.
Output JSON: {"verdict":"BUY|HOLD|SELL","confidence":0-100,"reasoning":"string","tags":[]}`;
}

function selectDebateCandidates(
  scores: RocketScoreData[],
  extras: string[] = []
): { candidates: DebateSelectionItem[]; rankMap: Map<string, number> } {
  const sorted = [...scores].sort((a, b) => b.rocket_score - a.rocket_score);
  const rankMap = new Map<string, number>();
  sorted.forEach((s, index) => {
    rankMap.set(s.ticker, index + 1);
  });

  const candidates: DebateSelectionItem[] = [];
  const total = sorted.length;

  // Top 25
  for (const stock of sorted.slice(0, Math.min(25, total))) {
    candidates.push({
      rank: rankMap.get(stock.ticker) || 0,
      ticker: stock.ticker,
      rocket_score: stock.rocket_score,
      sector: stock.sector || 'Unknown',
      selection_group: 'top25'
    });
  }

  // Near cutoff (26-35)
  for (const stock of sorted.slice(25, Math.min(35, total))) {
    candidates.push({
      rank: rankMap.get(stock.ticker) || 0,
      ticker: stock.ticker,
      rocket_score: stock.rocket_score,
      sector: stock.sector || 'Unknown',
      selection_group: 'near_cutoff'
    });
  }

  // Best of worst
  const bottomStart = Math.max(0, total - Math.min(50, Math.floor(total * 0.2)));
  const bottomBucket = sorted.slice(bottomStart);
  for (const stock of bottomBucket.slice(0, 5)) {
    if (!candidates.some(c => c.ticker === stock.ticker)) {
      candidates.push({
        rank: rankMap.get(stock.ticker) || 0,
        ticker: stock.ticker,
        rocket_score: stock.rocket_score,
        sector: stock.sector || 'Unknown',
        selection_group: 'best_of_worst'
      });
    }
  }

  // Extras
  const existingTickers = new Set(candidates.map(c => c.ticker));
  for (const ticker of extras) {
    if (!existingTickers.has(ticker)) {
      const stock = scores.find(s => s.ticker === ticker);
      if (stock) {
        candidates.push({
          rank: rankMap.get(ticker) || 0,
          ticker: ticker,
          rocket_score: stock.rocket_score,
          sector: stock.sector || 'Unknown',
          selection_group: 'extra'
        });
      }
    }
  }

  return { candidates, rankMap };
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
    // Parse request body
    let rawBody: unknown = {};
    try {
      rawBody = await request.json();
    } catch {
      rawBody = {};
    }

    const bodyValidation = validateDebateRequest(rawBody);
    if (!bodyValidation.success) {
      return NextResponse.json(
        { error: bodyValidation.error },
        { status: 400 }
      );
    }

    const extras = bodyValidation.data?.extras || [];

    // ========================================================================
    // PROXY TO PYTHON BACKEND
    // ========================================================================
    if (useBackend()) {
      const result = await backendPost<{ success: boolean; message?: string }>(`/run/${runId}/debate`, {
        extras,
      });

      if (!result.ok) {
        return NextResponse.json(
          { error: result.error },
          { status: result.status }
        );
      }

      return NextResponse.json(result.data);
    }

    // ========================================================================
    // LEGACY: Local execution with DeepSeek
    // ========================================================================
    let scores: RocketScoreData[];

    try {
      const scoresData = await readArtifact(runId, 'rocket_scores.json');
      scores = JSON.parse(scoresData);
    } catch {
      return NextResponse.json(
        { error: 'rocket_scores.json not found. Run RocketScore first.' },
        { status: 400 }
      );
    }

    const { candidates, rankMap } = selectDebateCandidates(scores, extras);
    await ensureRunDir(runId);

    // Write selection
    await writeArtifact(runId, 'debate_selection.json',
      JSON.stringify({
        runId,
        createdAt: new Date().toISOString(),
        total: candidates.length,
        breakdown: {
          top25: candidates.filter(c => c.selection_group === 'top25').length,
          near_cutoff: candidates.filter(c => c.selection_group === 'near_cutoff').length,
          best_of_worst: candidates.filter(c => c.selection_group === 'best_of_worst').length,
          extra: candidates.filter(c => c.selection_group === 'extra').length
        },
        selections: candidates
      }, null, 2)
    );

    await appendLog(runId, `Starting debate for ${candidates.length} candidates`);
    await updateStatus(runId, {
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
      byTicker: {} as Record<string, unknown>
    };

    const errors: Array<{ ticker: string; error: string }> = [];
    const apiKey = process.env.DEEPSEEK_API_KEY;
    const useRealDebate = apiKey && apiKey.length >= 20;

    if (!useRealDebate) {
      await appendLog(runId, 'WARNING: DEEPSEEK_API_KEY not configured. Using mock debate.');
    }

    const tickerScores = new Map<string, RocketScoreData>();
    for (const s of scores) {
      tickerScores.set(s.ticker, s);
    }

    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      const ticker = candidate.ticker;
      const score = tickerScores.get(ticker);

      if (!score) {
        await appendLog(runId, `[${ticker}] ERROR: Score data not found, skipping`);
        continue;
      }

      await updateStatus(runId, {
        done: i,
        total: candidates.length,
        current: ticker,
        message: `Analyzing ${ticker} (${i + 1}/${candidates.length})`
      });

      try {
        // Fetch news
        await appendLog(runId, `[${ticker}] Fetching news...`);
        const newsResult = await fetchNewsForTicker(ticker, { days: 14, limit: 8 });
        await writeArtifact(runId, `news/news_${ticker}.json`, JSON.stringify(newsResult, null, 2));

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
          await appendLog(runId, `[${ticker}] Running agents...`);
          const [bull, bear, regime, volume] = await Promise.all([
            callDeepSeekForDebate(buildAgentPrompt('bull'), `Analyze ${ticker} json:\n${contextJson}`, runId, ticker),
            callDeepSeekForDebate(buildAgentPrompt('bear'), `Analyze ${ticker} json:\n${contextJson}`, runId, ticker),
            callDeepSeekForDebate(buildAgentPrompt('regime'), `Analyze ${ticker} json:\n${contextJson}`, runId, ticker),
            callDeepSeekForDebate(buildAgentPrompt('volume'), `Analyze ${ticker} json:\n${contextJson}`, runId, ticker)
          ]);

          await appendLog(runId, `[${ticker}] Running Judge...`);
          const judgeInput = JSON.stringify({ bull, bear, regime, volume, context }, null, 2);
          const judge = await callDeepSeekForDebate(
            buildJudgePrompt(),
            `Review and decide json:\n${judgeInput}`,
            runId, ticker
          ) as { verdict: string; confidence: number; tags?: string[] };

          debate = { ticker, agents: { bull, bear, regime, volume }, judge, createdAt: new Date().toISOString(), selection_group: candidate.selection_group };
        } else {
          const verdict = score.rocket_score >= 70 ? 'BUY' : score.rocket_score >= 50 ? 'HOLD' : 'SELL';
          const confidence = Math.min(85, Math.max(20, Math.round(score.rocket_score)));

          debate = {
            ticker,
            agents: {
              bull: { agent: 'bull', thesis: `Bull case for ${ticker}` },
              bear: { agent: 'bear', thesis: `Bear case for ${ticker}` },
              regime: { agent: 'regime', thesis: `Regime for ${ticker}` },
              volume: { agent: 'volume', thesis: `Volume for ${ticker}` }
            },
            judge: { verdict, confidence, reasoning: 'Mock verdict', tags: score.tags || [] },
            createdAt: new Date().toISOString(),
            selection_group: candidate.selection_group,
            warnings: ['Mock debate - configure DEEPSEEK_API_KEY for real analysis']
          };
        }

        const judgeData = debate.judge as { verdict: string; confidence: number; tags?: string[] };
        const verdictRaw = (judgeData.verdict || 'HOLD').toUpperCase();
        const verdict = verdictRaw === 'WAIT' ? 'SELL' : verdictRaw;
        const confidence = judgeData.confidence || 50;
        const tags = (judgeData.tags || score.tags || []).slice(0, 4);

        await writeArtifact(runId, `debate/${ticker}.json`, JSON.stringify(debate, null, 2));

        summary.byTicker[ticker] = {
          verdict, confidence,
          rocket_score: score.rocket_score,
          rocket_rank: rankMap.get(ticker) ?? null,
          sector: score.sector,
          tags,
          selection_group: candidate.selection_group
        };

        if (verdict === 'BUY') summary.buy.push(ticker);
        else if (verdict === 'HOLD') summary.hold.push(ticker);
        else summary.sell.push(ticker);

        await appendLog(runId, `[${ticker}] Completed: ${verdict} (${confidence}%)`);

      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        errors.push({ ticker, error: errorMsg });
        await appendLog(runId, `[${ticker}] FAILED: ${errorMsg}`);
        await writeArtifact(runId, `debate/${ticker}_error.json`, JSON.stringify({ ticker, error: errorMsg, timestamp: new Date().toISOString() }, null, 2));
      }
    }

    // Write summary
    await writeArtifact(runId, 'debate/debate_summary.json', JSON.stringify(summary, null, 2));

    // Create final_buys.json
    const finalBuyCandidates = summary.buy
      .map((ticker) => ({ ticker, ...(summary.byTicker[ticker] as object || {}) }))
      .filter((entry) => entry.ticker);

    finalBuyCandidates.sort((a, b) => {
      const ac = (a as { confidence?: number }).confidence || 0;
      const bc = (b as { confidence?: number }).confidence || 0;
      return bc - ac;
    });

    const finalBuys = finalBuyCandidates.slice(0, 12);

    await writeArtifact(runId, 'final_buys.json',
      JSON.stringify({
        runId,
        createdAt: new Date().toISOString(),
        selection: { total_buy: summary.buy.length, selected: finalBuys.length },
        items: finalBuys
      }, null, 2)
    );

    if (errors.length > 0) {
      await writeArtifact(runId, 'debate/debate_error.json', JSON.stringify({ errors, timestamp: new Date().toISOString() }, null, 2));
    }

    await updateStatus(
      runId,
      {
        done: candidates.length,
        total: candidates.length,
        current: null,
        message: `Debate complete: ${summary.buy.length} BUY, ${summary.hold.length} HOLD, ${summary.sell.length} SELL`
      },
      errors.length > 0 && summary.buy.length === 0 ? 'error' : 'debate_ready'
    );

    await appendLog(runId, `Debate complete. BUY: ${summary.buy.length}, HOLD: ${summary.hold.length}, SELL: ${summary.sell.length}`);

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
