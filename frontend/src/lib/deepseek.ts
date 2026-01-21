/**
 * DeepSeek API Integration - Investment-Grade Debate System
 * Agents write like senior Wall Street analysts
 */

interface RocketScoreRow {
  ticker: string;
  sector: string;
  current_price: number;
  rocket_score: number;
  technical_score: number;
  volume_score: number;
  quality_score: number;
  macro_score: number;
  weights: Record<string, number>;
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
    matched_trends: Array<{ name: string; confidence: number; thesis: string }>;
  };
  tags: string[];
  breakdown: Record<string, number>;
}

interface AgentOutput {
  executive_summary: string;
  core_thesis: string;
  metrics_table: Array<{ metric: string; value: string; interpretation: string }>;
  catalysts: Array<{ event: string; timeframe: string; impact: string }>;
  risks: Array<{ risk: string; probability: string; mitigation: string }>;
  what_would_change_my_mind: Array<{ trigger: string; threshold: string }>;
  time_horizon: string;
  positioning_notes: string;
  sources: string[];
}

interface RegimeOutput {
  executive_summary: string;
  regime_classification: 'risk-on' | 'risk-off' | 'neutral';
  supporting_signals: Array<{ signal: string; reading: string; interpretation: string }>;
  sector_positioning: string;
  correlation_regime: string;
  recommendation: string;
  sources: string[];
}

interface VolumeOutput {
  executive_summary: string;
  flow_assessment: 'accumulation' | 'distribution' | 'neutral';
  volume_signals: Array<{ signal: string; value: string; interpretation: string }>;
  institutional_activity: string;
  liquidity_assessment: string;
  recommendation: string;
  sources: string[];
}

interface JudgeOutput {
  verdict: 'BUY' | 'HOLD' | 'WAIT';
  confidence: number;
  executive_summary: string;
  agreements: {
    bull: string[];
    bear: string[];
    regime: string[];
    volume: string[];
  };
  rejections: {
    bull: string[];
    bear: string[];
    regime: string[];
    volume: string[];
  };
  key_metrics_driving_decision: Array<{ metric: string; value: string; weight: string }>;
  decision_triggers: Array<{ condition: string; new_verdict: string }>;
  position_sizing: string;
  time_horizon: string;
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
  cross_exam: Array<{
    type: 'bull_critiques_bear' | 'bear_critiques_bull';
    critique: string;
    timestamp: string;
  }>;
  createdAt: string;
  data_sources: string[];
  warnings: string[];
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
          temperature: 0.4,
          max_tokens: 2000,
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
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw new Error('All retries exhausted');
}

function buildDataContext(ticker: string, row: RocketScoreRow): string {
  const tech = row.technical_details?.raw_metrics || {};
  const vol = row.volume_details?.raw_metrics || {};
  const qual = row.quality_details?.raw_metrics || {};
  const macro = row.macro_details?.raw_metrics || {};
  
  return `
═══════════════════════════════════════════════════════════
STOCK ANALYSIS DATA PACKAGE: ${ticker}
═══════════════════════════════════════════════════════════

OVERVIEW:
• Ticker: ${ticker}
• Sector: ${row.sector || 'Unknown'}
• Current Price: $${row.current_price?.toFixed(2) || 'N/A'}

ROCKETSCORE BREAKDOWN:
• Final Score: ${row.rocket_score}/100
• Technical (45% weight): ${row.technical_score}/100
• Volume (25% weight): ${row.volume_score}/100
• Quality (20% weight): ${row.quality_score}/100
• Macro (10% weight): ${row.macro_score}/100

TECHNICAL METRICS:
• 1-Month Return: ${tech.return_1m_pct ?? 'N/A'}%
• 3-Month Return: ${tech.return_3m_pct ?? 'N/A'}%
• 6-Month Return: ${tech.return_6m_pct ?? 'N/A'}%
• 1-Year Return: ${tech.return_1y_pct ?? 'N/A'}%
• Trend Slope (Annualized): ${tech.trend_slope_annualized ?? 'N/A'}%
• Drawdown from 52W High: ${tech.drawdown_from_52w_high_pct ?? 'N/A'}%
• Above SMA50: ${tech.above_sma50 ?? 'N/A'}
• Above SMA200: ${tech.above_sma200 ?? 'N/A'}
• Golden Cross Active: ${tech.golden_cross ?? 'N/A'}

VOLUME METRICS:
• Volume Surge Ratio: ${vol.volume_surge_ratio ?? 'N/A'}x
• Volume Z-Score (10d): ${vol.volume_zscore_10d ?? 'N/A'}
• Up/Down Volume Ratio (20d): ${vol.up_down_volume_ratio_20d ?? 'N/A'}
• Avg Daily Volume (20d): ${vol.avg_daily_volume_20d?.toLocaleString() ?? 'N/A'}

FUNDAMENTAL METRICS:
${qual.operating_margin !== undefined ? `• Operating Margin: ${qual.operating_margin}%` : '• Operating Margin: N/A'}
${qual.gross_margin !== undefined ? `• Gross Margin: ${qual.gross_margin}%` : '• Gross Margin: N/A'}
${qual.revenue_growth !== undefined ? `• Revenue Growth: ${qual.revenue_growth}%` : '• Revenue Growth: N/A'}
${qual.profit_margin !== undefined ? `• Profit Margin: ${qual.profit_margin}%` : '• Profit Margin: N/A'}
${qual.fcf_yield !== undefined ? `• FCF Yield: ${qual.fcf_yield}%` : '• FCF Yield: N/A'}

MACRO CONTEXT:
• Sector: ${macro.sector ?? row.sector ?? 'Unknown'}
• Trend Bonus: ${macro.trend_bonus ?? 0}
• Matched Themes: ${row.macro_details?.matched_trends?.map(t => t.name).join(', ') || 'None'}

DATA SOURCES:
• Price/Volume: yfinance
• Fundamentals: yfinance (when available)
• Computations: Internal RocketScore algorithm

NOTE: All metrics are computed from historical data. NO live news has been fetched.
If fundamental data shows N/A, it was not available via yfinance.
═══════════════════════════════════════════════════════════
`.trim();
}

const BULL_SYSTEM = `You are a SENIOR BULL ANALYST at a top-tier buy-side firm.
You are writing a research memo recommending a LONG position.

OUTPUT REQUIREMENTS:
- Write 600-900 words total
- Be specific with numbers from the data provided
- NO generic statements like "macro uncertainty" without data
- Every claim must reference a specific metric
- If data is N/A, acknowledge it explicitly

OUTPUT VALID JSON with this exact structure:
{
  "executive_summary": "2-3 sentence investment thesis",
  "core_thesis": "3-4 paragraphs explaining the bull case with specific data citations",
  "metrics_table": [
    {"metric": "metric_name", "value": "actual_value", "interpretation": "what it means"},
    ... (8-12 rows)
  ],
  "catalysts": [
    {"event": "specific event", "timeframe": "Q1 2025", "impact": "expected impact"},
    ... (3-5 catalysts)
  ],
  "risks": [
    {"risk": "specific risk", "probability": "Low/Medium/High", "mitigation": "how to manage"},
    ... (3-5 risks)
  ],
  "what_would_change_my_mind": [
    {"trigger": "specific condition", "threshold": "numeric threshold if applicable"},
    ... (2-4 triggers)
  ],
  "time_horizon": "3-6 months / 6-12 months / etc.",
  "positioning_notes": "entry strategy, sizing considerations",
  "sources": ["list of data sources used"]
}`;

const BEAR_SYSTEM = `You are a SENIOR BEAR ANALYST at a top-tier buy-side firm.
You are writing a research memo arguing AGAINST a long position.

OUTPUT REQUIREMENTS:
- Write 600-900 words total
- Be specific with numbers from the data provided
- NO generic statements without data backing
- Every concern must reference a specific metric
- If data is N/A, that itself may be a red flag - say so

OUTPUT VALID JSON with this exact structure:
{
  "executive_summary": "2-3 sentence bear thesis",
  "core_thesis": "3-4 paragraphs explaining the bear case with specific data citations",
  "metrics_table": [
    {"metric": "metric_name", "value": "actual_value", "interpretation": "why it's concerning"},
    ... (8-12 rows)
  ],
  "catalysts": [
    {"event": "potential negative event", "timeframe": "timeframe", "impact": "expected impact"},
    ... (3-5 negative catalysts)
  ],
  "risks": [
    {"risk": "upside risk to my bear thesis", "probability": "Low/Medium/High", "mitigation": "how bear thesis survives"},
    ... (3-5 risks to bear case)
  ],
  "what_would_change_my_mind": [
    {"trigger": "condition that would make me bullish", "threshold": "numeric threshold"},
    ... (2-4 triggers)
  ],
  "time_horizon": "expected timeframe for thesis to play out",
  "positioning_notes": "why NOT to be long, potential short considerations",
  "sources": ["list of data sources used"]
}`;

const REGIME_SYSTEM = `You are a SENIOR MACRO/REGIME ANALYST at a top-tier buy-side firm.
You assess the current market regime and how this stock fits within it.

OUTPUT REQUIREMENTS:
- Define regime using MEASURABLE signals
- Be specific about sector positioning
- Reference correlation patterns
- NO vague statements without data

OUTPUT VALID JSON with this exact structure:
{
  "executive_summary": "1-2 sentence regime assessment for this stock",
  "regime_classification": "risk-on" or "risk-off" or "neutral",
  "supporting_signals": [
    {"signal": "signal name", "reading": "current reading", "interpretation": "what it means"},
    ... (4-6 signals)
  ],
  "sector_positioning": "How this sector performs in current regime",
  "correlation_regime": "Current correlation patterns relevant to this stock",
  "recommendation": "Regime-based positioning recommendation",
  "sources": ["data sources"]
}`;

const VOLUME_SYSTEM = `You are a SENIOR FLOW/VOLUME ANALYST at a top-tier buy-side firm.
You analyze volume patterns and institutional flow signals.

OUTPUT REQUIREMENTS:
- Reference specific volume metrics provided
- Assess accumulation vs distribution patterns
- Comment on liquidity conditions
- Be specific with numbers

OUTPUT VALID JSON with this exact structure:
{
  "executive_summary": "1-2 sentence flow assessment",
  "flow_assessment": "accumulation" or "distribution" or "neutral",
  "volume_signals": [
    {"signal": "signal name", "value": "specific value", "interpretation": "what it means"},
    ... (4-6 signals)
  ],
  "institutional_activity": "Assessment of institutional participation",
  "liquidity_assessment": "Liquidity conditions and implications",
  "recommendation": "Flow-based positioning recommendation",
  "sources": ["data sources"]
}`;

const JUDGE_SYSTEM = `You are the SENIOR PORTFOLIO MANAGER making the final decision.
You have received memos from Bull, Bear, Regime, and Volume analysts.

CRITICAL REQUIREMENTS:
1. EXPLICITLY reference specific claims from each analyst
2. State what you AGREE with from each analyst (with quotes/paraphrases)
3. State what you REJECT from each analyst (with reasons)
4. Cite the KEY METRICS that drove your decision
5. Define SPECIFIC triggers that would change your verdict

OUTPUT VALID JSON with this exact structure:
{
  "verdict": "BUY" or "HOLD" or "WAIT",
  "confidence": 0-100,
  "executive_summary": "3-4 sentence decision summary citing key points",
  "agreements": {
    "bull": ["specific point I agree with from Bull", ...],
    "bear": ["specific point I agree with from Bear", ...],
    "regime": ["specific point I agree with from Regime", ...],
    "volume": ["specific point I agree with from Volume", ...]
  },
  "rejections": {
    "bull": ["specific Bull point I reject and why", ...],
    "bear": ["specific Bear point I reject and why", ...],
    "regime": ["specific Regime point I reject and why", ...],
    "volume": ["specific Volume point I reject and why", ...]
  },
  "key_metrics_driving_decision": [
    {"metric": "metric name", "value": "value", "weight": "how much this influenced decision"},
    ... (5-8 metrics)
  ],
  "decision_triggers": [
    {"condition": "if X happens", "new_verdict": "change to Y"},
    ... (3-5 triggers)
  ],
  "position_sizing": "suggested position size as % of portfolio",
  "time_horizon": "investment time horizon"
}`;

function getDefaultAgentOutput(): AgentOutput {
  return {
    executive_summary: '',
    core_thesis: '',
    metrics_table: [],
    catalysts: [],
    risks: [],
    what_would_change_my_mind: [],
    time_horizon: '',
    positioning_notes: '',
    sources: []
  };
}

function getDefaultRegimeOutput(): RegimeOutput {
  return {
    executive_summary: '',
    regime_classification: 'neutral',
    supporting_signals: [],
    sector_positioning: '',
    correlation_regime: '',
    recommendation: '',
    sources: []
  };
}

function getDefaultVolumeOutput(): VolumeOutput {
  return {
    executive_summary: '',
    flow_assessment: 'neutral',
    volume_signals: [],
    institutional_activity: '',
    liquidity_assessment: '',
    recommendation: '',
    sources: []
  };
}

function getDefaultJudge(error?: string): JudgeOutput {
  return {
    verdict: 'WAIT',
    confidence: 0,
    executive_summary: error || 'Analysis incomplete',
    agreements: { bull: [], bear: [], regime: [], volume: [] },
    rejections: { bull: [], bear: [], regime: [], volume: [] },
    key_metrics_driving_decision: [],
    decision_triggers: [],
    position_sizing: 'N/A',
    time_horizon: 'N/A'
  };
}

// Generate mock data when API key not available
function generateMockDebate(ticker: string, row: RocketScoreRow): DebateResult {
  const tech = row.technical_details?.raw_metrics || {};
  const vol = row.volume_details?.raw_metrics || {};
  
  const isBullish = row.rocket_score >= 65;
  const isNeutral = row.rocket_score >= 45 && row.rocket_score < 65;
  
  return {
    ticker,
    agents: {
      bull: {
        executive_summary: `${ticker} presents a compelling opportunity with a RocketScore of ${row.rocket_score.toFixed(1)}/100, driven by ${row.technical_score >= 60 ? 'strong' : 'moderate'} technical momentum.`,
        core_thesis: `The technical setup for ${ticker} shows ${tech.return_3m_pct || 'N/A'}% returns over 3 months with a trend slope of ${tech.trend_slope_annualized || 'N/A'}% annualized. Volume patterns indicate ${(vol.volume_surge_ratio || 1) > 1.5 ? 'accumulation' : 'neutral flow'} with a surge ratio of ${vol.volume_surge_ratio || 'N/A'}x. The sector positioning in ${row.sector} provides ${row.macro_score >= 60 ? 'favorable' : 'neutral'} macro tailwinds.`,
        metrics_table: [
          { metric: 'RocketScore', value: `${row.rocket_score.toFixed(1)}/100`, interpretation: 'Overall momentum signal' },
          { metric: '3M Return', value: `${tech.return_3m_pct || 'N/A'}%`, interpretation: 'Price momentum' },
          { metric: 'Volume Surge', value: `${vol.volume_surge_ratio || 'N/A'}x`, interpretation: 'Flow signal' },
          { metric: 'Drawdown', value: `${tech.drawdown_from_52w_high_pct || 'N/A'}%`, interpretation: 'Distance from highs' }
        ],
        catalysts: [
          { event: 'Continued momentum', timeframe: 'Next 30 days', impact: 'Price appreciation' }
        ],
        risks: [
          { risk: 'Momentum reversal', probability: 'Medium', mitigation: 'Stop loss at key support' }
        ],
        what_would_change_my_mind: [
          { trigger: 'RocketScore drops below 50', threshold: '<50' }
        ],
        time_horizon: '3-6 months',
        positioning_notes: 'Consider entering on pullbacks to moving averages',
        sources: ['yfinance price/volume data', 'RocketScore algorithm']
      },
      bear: {
        executive_summary: `While ${ticker} shows momentum, the ${tech.drawdown_from_52w_high_pct || 'N/A'}% drawdown and ${row.quality_score < 60 ? 'weak' : 'moderate'} quality metrics warrant caution.`,
        core_thesis: `The primary concern is ${row.quality_score < 50 ? 'deteriorating fundamentals' : 'valuation risk'} with quality score at ${row.quality_score}/100. The volume profile shows ${(vol.up_down_volume_ratio_20d || 1) < 1.2 ? 'concerning distribution patterns' : 'mixed signals'}. Sector headwinds in ${row.sector} could pressure returns.`,
        metrics_table: [
          { metric: 'Quality Score', value: `${row.quality_score}/100`, interpretation: 'Fundamental weakness' },
          { metric: 'Up/Down Ratio', value: `${vol.up_down_volume_ratio_20d || 'N/A'}x`, interpretation: 'Distribution signal' }
        ],
        catalysts: [
          { event: 'Sector rotation', timeframe: 'Near-term', impact: 'Outflows' }
        ],
        risks: [
          { risk: 'Continued momentum', probability: 'Medium', mitigation: 'Tight position sizing' }
        ],
        what_would_change_my_mind: [
          { trigger: 'Quality score improves above 70', threshold: '>70' }
        ],
        time_horizon: '1-3 months',
        positioning_notes: 'Avoid chasing momentum at current levels',
        sources: ['yfinance fundamentals', 'RocketScore algorithm']
      },
      regime: {
        executive_summary: `Market regime is ${isNeutral ? 'neutral' : isBullish ? 'supportive' : 'cautionary'} for ${ticker} given current ${row.sector} sector dynamics.`,
        regime_classification: isNeutral ? 'neutral' : isBullish ? 'risk-on' : 'risk-off',
        supporting_signals: [
          { signal: 'Sector Momentum', reading: `${row.macro_score}/100`, interpretation: row.macro_score >= 60 ? 'Favorable' : 'Neutral' }
        ],
        sector_positioning: `${row.sector} is showing ${row.macro_score >= 60 ? 'relative strength' : 'mixed signals'} in current environment`,
        correlation_regime: 'Correlations elevated during risk events',
        recommendation: `${isBullish ? 'Regime supports long positioning' : 'Exercise caution on new longs'}`,
        sources: ['Sector analysis', 'RocketScore macro component']
      },
      volume: {
        executive_summary: `Volume analysis indicates ${(vol.volume_surge_ratio || 1) > 1.5 ? 'accumulation' : 'neutral'} patterns with ${vol.volume_zscore_10d || 0 > 1 ? 'elevated' : 'normal'} activity.`,
        flow_assessment: (vol.volume_surge_ratio || 1) > 1.5 ? 'accumulation' : 'neutral',
        volume_signals: [
          { signal: 'Volume Surge', value: `${vol.volume_surge_ratio || 'N/A'}x`, interpretation: 'vs 60-day average' },
          { signal: 'Volume Z-Score', value: `${vol.volume_zscore_10d || 'N/A'}`, interpretation: 'Statistical significance' }
        ],
        institutional_activity: `${(vol.volume_surge_ratio || 1) > 2 ? 'Elevated institutional participation likely' : 'Normal institutional activity'}`,
        liquidity_assessment: `Average daily volume of ${vol.avg_daily_volume_20d?.toLocaleString() || 'N/A'} shares provides ${(vol.avg_daily_volume_20d || 0) > 1000000 ? 'adequate' : 'limited'} liquidity`,
        recommendation: `Volume patterns ${(vol.volume_surge_ratio || 1) > 1.5 ? 'support' : 'are neutral for'} the momentum thesis`,
        sources: ['yfinance volume data', 'RocketScore volume component']
      }
    },
    judge: {
      verdict: row.rocket_score >= 70 ? 'BUY' : row.rocket_score >= 50 ? 'HOLD' : 'WAIT',
      confidence: Math.min(85, Math.max(20, row.rocket_score)),
      executive_summary: `Based on RocketScore of ${row.rocket_score.toFixed(1)}/100 and analysis of technical (${row.technical_score}), volume (${row.volume_score}), quality (${row.quality_score}), and macro (${row.macro_score}) factors, the verdict is ${row.rocket_score >= 70 ? 'BUY' : row.rocket_score >= 50 ? 'HOLD' : 'WAIT'}.`,
      agreements: {
        bull: ['Technical momentum metrics are accurate'],
        bear: ['Quality concerns are valid'],
        regime: ['Sector assessment is reasonable'],
        volume: ['Flow analysis methodology is sound']
      },
      rejections: {
        bull: row.rocket_score < 60 ? ['Overly optimistic on catalyst timeline'] : [],
        bear: row.rocket_score >= 60 ? ['Underweighting momentum strength'] : [],
        regime: [],
        volume: []
      },
      key_metrics_driving_decision: [
        { metric: 'RocketScore', value: `${row.rocket_score.toFixed(1)}`, weight: 'Primary' },
        { metric: 'Technical Score', value: `${row.technical_score}`, weight: 'High' },
        { metric: 'Volume Score', value: `${row.volume_score}`, weight: 'Medium' }
      ],
      decision_triggers: [
        { condition: 'RocketScore drops below 40', new_verdict: 'WAIT' },
        { condition: 'RocketScore rises above 75', new_verdict: 'BUY' }
      ],
      position_sizing: row.rocket_score >= 70 ? '3-5% of portfolio' : '1-2% or zero',
      time_horizon: '3-6 months'
    },
    cross_exam: [],
    createdAt: new Date().toISOString(),
    data_sources: ['yfinance price/volume', 'yfinance fundamentals (when available)', 'RocketScore algorithm'],
    warnings: ['No live news data fetched', 'Fundamentals may be incomplete']
  };
}

export async function generateDebate(ticker: string, rocketRow: RocketScoreRow): Promise<DebateResult> {
  const dataContext = buildDataContext(ticker, rocketRow);
  const warnings: string[] = ['No live news data fetched - all analysis based on historical metrics'];
  
  // Check if API key is available
  if (!DEEPSEEK_API_KEY || DEEPSEEK_API_KEY === 'your_key_here') {
    warnings.push('DeepSeek API key not configured - using mock analysis');
    return generateMockDebate(ticker, rocketRow);
  }
  
  let bull: AgentOutput = getDefaultAgentOutput();
  let bear: AgentOutput = getDefaultAgentOutput();
  let regime: RegimeOutput = getDefaultRegimeOutput();
  let volume: VolumeOutput = getDefaultVolumeOutput();
  let judge: JudgeOutput = getDefaultJudge();
  
  try {
    // Run first 4 agents in parallel
    const [bullResult, bearResult, regimeResult, volumeResult] = await Promise.allSettled([
      callDeepSeek(BULL_SYSTEM, `Analyze this stock:\n\n${dataContext}`),
      callDeepSeek(BEAR_SYSTEM, `Analyze this stock:\n\n${dataContext}`),
      callDeepSeek(REGIME_SYSTEM, `Assess regime for this stock:\n\n${dataContext}`),
      callDeepSeek(VOLUME_SYSTEM, `Analyze volume/flow for this stock:\n\n${dataContext}`)
    ]);
    
    if (bullResult.status === 'fulfilled') bull = bullResult.value as AgentOutput;
    else warnings.push(`Bull agent failed: ${bullResult.reason}`);
    
    if (bearResult.status === 'fulfilled') bear = bearResult.value as AgentOutput;
    else warnings.push(`Bear agent failed: ${bearResult.reason}`);
    
    if (regimeResult.status === 'fulfilled') regime = regimeResult.value as RegimeOutput;
    else warnings.push(`Regime agent failed: ${regimeResult.reason}`);
    
    if (volumeResult.status === 'fulfilled') volume = volumeResult.value as VolumeOutput;
    else warnings.push(`Volume agent failed: ${volumeResult.reason}`);
    
    // Run judge with all agent outputs
    const judgePrompt = `
${dataContext}

═══════════════════════════════════════════════════════════
ANALYST MEMOS:
═══════════════════════════════════════════════════════════

BULL ANALYST:
${JSON.stringify(bull, null, 2)}

BEAR ANALYST:
${JSON.stringify(bear, null, 2)}

REGIME ANALYST:
${JSON.stringify(regime, null, 2)}

VOLUME ANALYST:
${JSON.stringify(volume, null, 2)}

═══════════════════════════════════════════════════════════
Make your final investment decision. Reference specific claims from each analyst.
`;
    
    try {
      judge = await callDeepSeek(JUDGE_SYSTEM, judgePrompt) as JudgeOutput;
    } catch (e) {
      warnings.push(`Judge failed: ${e instanceof Error ? e.message : 'unknown'}`);
      judge = getDefaultJudge(`Judge analysis failed: ${e instanceof Error ? e.message : 'unknown'}`);
    }
    
  } catch (error) {
    warnings.push(`Debate generation error: ${error instanceof Error ? error.message : 'unknown'}`);
    return generateMockDebate(ticker, rocketRow);
  }
  
  return {
    ticker,
    agents: { bull, bear, regime, volume },
    judge,
    cross_exam: [],
    createdAt: new Date().toISOString(),
    data_sources: ['yfinance price/volume', 'yfinance fundamentals (when available)', 'RocketScore algorithm'],
    warnings
  };
}

export async function generateCrossExam(
  ticker: string,
  type: 'bull_critiques_bear' | 'bear_critiques_bull',
  bullMemo: AgentOutput,
  bearMemo: AgentOutput,
  dataContext: string
): Promise<{ critique: string; error?: string }> {
  if (!DEEPSEEK_API_KEY || DEEPSEEK_API_KEY === 'your_key_here') {
    return { error: 'DeepSeek API key not configured' };
  }
  
  const isBullCritique = type === 'bull_critiques_bear';
  const critic = isBullCritique ? 'Bull' : 'Bear';
  const target = isBullCritique ? 'Bear' : 'Bull';
  const targetMemo = isBullCritique ? bearMemo : bullMemo;
  
  const systemPrompt = `You are the ${critic} analyst. The ${target} analyst has made arguments against your thesis.
Critique their SPECIFIC claims with data. Be professional but firm.
Output a single JSON object: { "critique": "your 200-400 word critique" }`;
  
  const userPrompt = `
${dataContext}

${target} ANALYST'S MEMO TO CRITIQUE:
${JSON.stringify(targetMemo, null, 2)}

Write your professional rebuttal referencing specific claims and data.`;
  
  try {
    const result = await callDeepSeek(systemPrompt, userPrompt) as { critique: string };
    return { critique: result.critique || 'No critique generated' };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
