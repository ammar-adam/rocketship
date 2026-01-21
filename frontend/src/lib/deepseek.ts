/**
 * DeepSeek API integration for multi-agent debate
 */

interface RocketScoreRow {
  ticker: string;
  sector: string;
  current_price: number;
  rocket_score: number;
  technical_score: number;
  macro_score: number;
  breakdown: Record<string, number>;
  tags: string[];
  macro_trends_matched: Array<{ name: string; confidence: number; thesis: string }>;
}

interface AgentOutput {
  summary: string;
  points: string[];
  risks: string[];
  sources: string[];
}

interface RegimeOutput {
  summary: string;
  regime: 'risk-on' | 'risk-off' | 'neutral';
  why: string;
  sources: string[];
}

interface VolumeOutput {
  summary: string;
  signals: string[];
  why: string;
  sources: string[];
}

interface JudgeOutput {
  verdict: 'BUY' | 'HOLD' | 'WAIT';
  confidence: number;
  rationale: string;
  key_disagreements: string[];
  what_would_change_mind: string[];
}

interface DebateResult {
  ticker: string;
  agents: {
    bull: AgentOutput;
    bear: AgentOutput;
    regime: RegimeOutput;
    volume: VolumeOutput;
  };
  judge: JudgeOutput;
  createdAt: string;
}

const DEEPSEEK_API_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';

async function callDeepSeek(systemPrompt: string, userPrompt: string, retries = 2): Promise<unknown> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(`${DEEPSEEK_API_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.5,
          response_format: { type: 'json_object' }
        })
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DeepSeek API error ${response.status}: ${errorText}`);
      }
      
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content;
      
      if (!content) {
        throw new Error('Empty response from DeepSeek');
      }
      
      return JSON.parse(content);
    } catch (error) {
      if (attempt === retries) {
        throw error;
      }
      // Add retry prompt hint
      if (error instanceof SyntaxError) {
        console.warn(`JSON parse failed, retrying with hint (attempt ${attempt + 1})`);
      }
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw new Error('All retries exhausted');
}

function buildContext(ticker: string, row: RocketScoreRow): string {
  return `
Ticker: ${ticker}
Sector: ${row.sector || 'Unknown'}
Current Price: $${row.current_price?.toFixed(2) || 'N/A'}
RocketScore: ${row.rocket_score}/100
  - Technical: ${row.technical_score}/100
  - Macro: ${row.macro_score}/100
Breakdown:
  - Momentum: ${row.breakdown?.momentum || 0}
  - Volume: ${row.breakdown?.volume || 0}
  - Trend: ${row.breakdown?.trend || 0}
  - Quality: ${row.breakdown?.quality || 0}
Tags: ${row.tags?.join(', ') || 'None'}
Macro Trends: ${row.macro_trends_matched?.map(t => t.name).join(', ') || 'None'}
`.trim();
}

const BULL_SYSTEM = `You are a BULL analyst. Find reasons to BUY this stock.
Output ONLY valid JSON:
{
  "summary": "1-2 sentence bull case",
  "points": ["point 1", "point 2", "point 3"],
  "risks": ["key risk 1"],
  "sources": ["data point cited"]
}`;

const BEAR_SYSTEM = `You are a BEAR analyst. Find reasons NOT to buy this stock.
Output ONLY valid JSON:
{
  "summary": "1-2 sentence bear case",
  "points": ["concern 1", "concern 2", "concern 3"],
  "risks": ["downside risk"],
  "sources": ["data point cited"]
}`;

const REGIME_SYSTEM = `You are a MACRO/REGIME analyst. Assess market environment for this stock.
Output ONLY valid JSON:
{
  "summary": "1 sentence regime assessment",
  "regime": "risk-on" or "risk-off" or "neutral",
  "why": "explanation",
  "sources": ["macro indicator"]
}`;

const VOLUME_SYSTEM = `You are a VOLUME/FLOW analyst. Assess trading activity signals.
Output ONLY valid JSON:
{
  "summary": "1 sentence volume assessment",
  "signals": ["signal 1", "signal 2"],
  "why": "explanation",
  "sources": ["volume data point"]
}`;

const JUDGE_SYSTEM = `You are the JUDGE. Given bull, bear, regime, and volume analyses, make a final verdict.
Output ONLY valid JSON:
{
  "verdict": "BUY" or "HOLD" or "WAIT",
  "confidence": 0.0 to 1.0,
  "rationale": "2-3 sentence explanation",
  "key_disagreements": ["disagreement between analysts"],
  "what_would_change_mind": ["condition that would flip verdict"]
}
Decision rules:
- BUY: Strong bull case + regime tailwind + volume confirmation + confidence > 0.7
- HOLD: Mixed signals or need more confirmation
- WAIT: Bear case dominates or regime headwind or weak volume`;

function getDefaultAgentOutput(): AgentOutput {
  return { summary: '', points: [], risks: [], sources: [] };
}

function getDefaultRegimeOutput(): RegimeOutput {
  return { summary: '', regime: 'neutral', why: '', sources: [] };
}

function getDefaultVolumeOutput(): VolumeOutput {
  return { summary: '', signals: [], why: '', sources: [] };
}

function getDefaultJudge(error?: string): JudgeOutput {
  return {
    verdict: 'WAIT',
    confidence: 0,
    rationale: error || 'Unable to complete analysis',
    key_disagreements: [],
    what_would_change_mind: []
  };
}

export async function generateDebate(ticker: string, rocketRow: RocketScoreRow): Promise<DebateResult> {
  const context = buildContext(ticker, rocketRow);
  const userPrompt = `Analyze: ${ticker}\n\n${context}`;
  
  let bull: AgentOutput = getDefaultAgentOutput();
  let bear: AgentOutput = getDefaultAgentOutput();
  let regime: RegimeOutput = getDefaultRegimeOutput();
  let volume: VolumeOutput = getDefaultVolumeOutput();
  let judge: JudgeOutput = getDefaultJudge();
  
  // Check if API key is available
  if (!DEEPSEEK_API_KEY || DEEPSEEK_API_KEY === 'your_key_here') {
    // Return mock data when no API key
    return {
      ticker,
      agents: {
        bull: {
          summary: `${ticker} shows strong technical momentum with sector tailwinds`,
          points: ['Strong RocketScore indicates momentum', 'Sector alignment favorable', 'Technical setup positive'],
          risks: ['Valuation concerns at current levels'],
          sources: ['RocketScore analysis']
        },
        bear: {
          summary: `${ticker} faces headwinds from macro uncertainty`,
          points: ['Macro conditions uncertain', 'Competition intensifying', 'Growth may slow'],
          risks: ['Multiple compression risk'],
          sources: ['Sector analysis']
        },
        regime: {
          summary: 'Market regime neutral with sector rotation ongoing',
          regime: 'neutral',
          why: 'Mixed signals from macro indicators',
          sources: ['Market data']
        },
        volume: {
          summary: 'Volume patterns suggest accumulation',
          signals: ['Volume surge detected', 'Institutional interest'],
          why: 'Above-average volume on up days',
          sources: ['Volume analysis']
        }
      },
      judge: {
        verdict: rocketRow.rocket_score >= 70 ? 'BUY' : rocketRow.rocket_score >= 50 ? 'HOLD' : 'WAIT',
        confidence: Math.min(rocketRow.rocket_score / 100, 0.85),
        rationale: `Based on RocketScore of ${rocketRow.rocket_score.toFixed(1)}, ${ticker} ${rocketRow.rocket_score >= 70 ? 'shows strong setup' : rocketRow.rocket_score >= 50 ? 'needs more confirmation' : 'should be avoided for now'}`,
        key_disagreements: ['Bull/Bear differ on valuation'],
        what_would_change_mind: ['Clearer macro direction', 'Volume confirmation']
      },
      createdAt: new Date().toISOString()
    };
  }
  
  try {
    // Run agents in parallel
    const [bullResult, bearResult, regimeResult, volumeResult] = await Promise.allSettled([
      callDeepSeek(BULL_SYSTEM, userPrompt),
      callDeepSeek(BEAR_SYSTEM, userPrompt),
      callDeepSeek(REGIME_SYSTEM, userPrompt),
      callDeepSeek(VOLUME_SYSTEM, userPrompt)
    ]);
    
    if (bullResult.status === 'fulfilled') bull = bullResult.value as AgentOutput;
    if (bearResult.status === 'fulfilled') bear = bearResult.value as AgentOutput;
    if (regimeResult.status === 'fulfilled') regime = regimeResult.value as RegimeOutput;
    if (volumeResult.status === 'fulfilled') volume = volumeResult.value as VolumeOutput;
    
    // Run judge with all agent outputs
    const judgePrompt = `
${userPrompt}

Bull Analysis: ${JSON.stringify(bull)}
Bear Analysis: ${JSON.stringify(bear)}
Regime Analysis: ${JSON.stringify(regime)}
Volume Analysis: ${JSON.stringify(volume)}

Make your final verdict.`;
    
    try {
      judge = await callDeepSeek(JUDGE_SYSTEM, judgePrompt) as JudgeOutput;
    } catch (e) {
      judge = getDefaultJudge(`Judge error: ${e instanceof Error ? e.message : 'unknown'}`);
    }
    
  } catch (error) {
    console.error(`Debate generation failed for ${ticker}:`, error);
    judge = getDefaultJudge(`Analysis error: ${error instanceof Error ? error.message : 'unknown'}`);
  }
  
  return {
    ticker,
    agents: { bull, bear, regime, volume },
    judge,
    createdAt: new Date().toISOString()
  };
}
