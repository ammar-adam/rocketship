"""Multi-agent debate system using DeepSeek API."""
import sys
import os
import httpx
import asyncio
import json

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.config import get_config


# System prompts for each agent
BULL_SYSTEM = """You are a BULL analyst finding 2-6x upside opportunities.

You have:
1. Facts Pack (price, volume, technical data)
2. RocketScore breakdown
3. Macro Trends matched to this stock

Your job: Make the STRONGEST upside case.

Focus on:
- Why THIS stock rides current macro trends
- Recent inflection points (earnings, contracts, products)
- Asymmetric upside scenarios (3:1+ reward:risk)
- What changed in last 90 days

Output ONLY valid JSON (no markdown, no explanations):
{
  "thesis": "2-3 sentence core bull case",
  "catalysts": ["catalyst 1", "catalyst 2", "catalyst 3"],
  "macro_alignment": ["which macro trends support this"],
  "key_assumptions": ["assumption 1", "assumption 2"],
  "failure_modes": ["what breaks this thesis"],
  "confidence": 75,
  "evidence": ["fact_pack cite 1", "fact_pack cite 2"]
}

Rules:
- Max 3 catalysts, 2 assumptions, 2 failure modes
- Every claim must cite Facts Pack numbers
- Reference specific macro trends by name
- Be aggressive but honest about risks"""


BEAR_SYSTEM = """You are a BEAR analyst killing bad trades.

You have:
1. Facts Pack
2. RocketScore (check for red flags)
3. Macro Trends

Your job: Destroy the bull case.

Focus on:
- Why is this trade LATE? (already priced in, crowded)
- Mean reversion setup (unsustainable multiples, margins)
- Macro headwinds (rate sensitivity, regulation, competition)
- What market doesn't see yet

Output ONLY valid JSON:
{
  "thesis": "2-3 sentence bear case",
  "risks": ["risk 1", "risk 2", "risk 3"],
  "macro_concerns": ["which trends work against this"],
  "key_assumptions": ["assumption 1", "assumption 2"],
  "invalidation": ["what would prove me wrong"],
  "confidence": 70,
  "evidence": ["fact cite 1", "fact cite 2"]
}

Rules:
- Be brutal but factual
- Cite specific technical/fundamental concerns
- Max 3 risks, 2 assumptions"""


SKEPTIC_SYSTEM = """You are a DATA QUALITY analyst catching false signals.

Check if this "rocket" is real or:
- 1-day earnings spike (not sustainable)
- Low float pump (illiquid, manipulated)
- Sector rotation noise (entire sector up, not company-specific)
- Data artifact (stock split, dividend, bad data)

Use quality_score from RocketScore breakdown as a hint.

Output ONLY valid JSON:
{
  "assessment": "REAL_SIGNAL",
  "concerns": ["concern 1", "concern 2"],
  "data_quality_flags": ["flag 1", "flag 2"],
  "recommendation": "PROCEED",
  "confidence": 80,
  "evidence": ["fact cite"]
}

Assessment values: "REAL_SIGNAL", "NOISE", "UNCERTAIN"
Recommendation values: "PROCEED", "WAIT_FOR_CONFIRMATION", "REJECT"

Red flags:
- vol_surge < 1.5x (weak volume)
- volatility > 60% (too parabolic)
- big price gaps > 15%
- volume spikes on single days only"""


REGIME_SYSTEM = """You are a MACRO analyst providing market context.

Check:
1. Sector momentum (rotating IN or OUT right now?)
2. Market regime (risk-on vs risk-off)
3. Factor crowding (is momentum overextended?)
4. Relative strength vs sector peers

Use macro_trends data to assess if sector has tailwinds.

Output ONLY valid JSON:
{
  "regime_assessment": "TAILWIND",
  "sector_context": "1-2 sentence sector view",
  "macro_alignment": "how current macro helps/hurts this stock",
  "relative_positioning": "vs sector peers context",
  "confidence": 75,
  "evidence": ["cite sector data"]
}

Assessment values: "TAILWIND", "NEUTRAL", "HEADWIND"

Rules:
- Use matched macro trends from Facts Pack
- Compare stock momentum to sector average if possible
- Max 150 words total"""


JUDGE_SYSTEM = """You are the FINAL DECISION MAKER for a $10,000 aggressive growth portfolio.

Inputs:
- Bull memo (upside case)
- Bear memo (downside case)
- Skeptic memo (signal quality)
- Regime memo (macro context)
- Facts Pack (raw data)

Decision framework:
1. Does bull case have asymmetric upside (3:1+ reward:risk)?
2. Are bear concerns manageable or fatal?
3. Is this a REAL signal (skeptic approval)?
4. Is macro/sector aligned (regime tailwind or neutral)?
5. Is this better than cash or other opportunities?

Output ONLY valid JSON:
{
  "verdict": "ENTER",
  "conviction": 78,
  "position_rationale": [
    "bullet 1: why enter/wait/kill",
    "bullet 2",
    "bullet 3",
    "bullet 4"
  ],
  "risk_controls": {
    "stop_loss": "price level or % below entry",
    "invalidation": "specific condition that proves thesis wrong",
    "max_position_size": "12%"
  },
  "change_my_mind": [
    "condition 1 that would flip verdict",
    "condition 2"
  ]
}

Verdict values: "ENTER", "WAIT", "KILL"

Decision rules:
- ENTER: conviction >70, skeptic approves or uncertain, regime not headwind
- WAIT: uncertain signal, mixed memos, need more confirmation
- KILL: bear case too strong, fake signal confirmed, or better alternatives
- Default WAIT when genuinely uncertain (capital preservation > FOMO)
- Max 4 bullets in position_rationale
- Be decisive but humble (include change_my_mind)"""


async def call_deepseek(system_prompt: str, user_prompt: str, temperature: float = 0.5) -> dict:
    """
    Call DeepSeek API with retry logic (3 attempts).
    
    Args:
        system_prompt: System instructions for the agent
        user_prompt: User message with facts/context
        temperature: Sampling temperature (0.0-1.0)
        
    Returns:
        Parsed JSON response from the agent
    """
    config = get_config()
    
    for attempt in range(3):
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.post(
                    f"{config.deepseek_base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {config.deepseek_api_key}"},
                    json={
                        "model": "deepseek-chat",
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt}
                        ],
                        "temperature": temperature,
                        "response_format": {"type": "json_object"}
                    }
                )
                response.raise_for_status()
                result = response.json()
                content = result["choices"][0]["message"]["content"]
                return json.loads(content)
        except Exception as e:
            if attempt == 2:  # Last attempt
                print(f"[ERROR] DeepSeek API failed after 3 attempts: {e}")
                return {"error": str(e)}
            await asyncio.sleep(2 ** attempt)  # Exponential backoff: 1s, 2s, 4s


async def run_bull_agent(facts_pack: dict) -> dict:
    """Run the BULL analyst agent."""
    user_prompt = f"Facts Pack:\n{json.dumps(facts_pack, indent=2)}\n\nGenerate bull thesis for {facts_pack['ticker']}."
    return await call_deepseek(BULL_SYSTEM, user_prompt, temperature=0.7)


async def run_bear_agent(facts_pack: dict) -> dict:
    """Run the BEAR analyst agent."""
    user_prompt = f"Facts Pack:\n{json.dumps(facts_pack, indent=2)}\n\nGenerate bear case for {facts_pack['ticker']}."
    return await call_deepseek(BEAR_SYSTEM, user_prompt, temperature=0.7)


async def run_skeptic_agent(facts_pack: dict) -> dict:
    """Run the SKEPTIC data quality agent."""
    user_prompt = f"Facts Pack:\n{json.dumps(facts_pack, indent=2)}\n\nAssess signal quality for {facts_pack['ticker']}."
    return await call_deepseek(SKEPTIC_SYSTEM, user_prompt, temperature=0.3)


async def run_regime_agent(facts_pack: dict) -> dict:
    """Run the REGIME macro context agent."""
    user_prompt = f"Facts Pack:\n{json.dumps(facts_pack, indent=2)}\n\nProvide macro context for {facts_pack['ticker']}."
    return await call_deepseek(REGIME_SYSTEM, user_prompt, temperature=0.5)


async def run_judge_agent(facts_pack: dict, bull: dict, bear: dict, skeptic: dict, regime: dict) -> dict:
    """Run the JUDGE final decision agent."""
    user_prompt = f"""Facts Pack:\n{json.dumps(facts_pack, indent=2)}

Bull Memo:\n{json.dumps(bull, indent=2)}

Bear Memo:\n{json.dumps(bear, indent=2)}

Skeptic Memo:\n{json.dumps(skeptic, indent=2)}

Regime Memo:\n{json.dumps(regime, indent=2)}

Make final decision for {facts_pack['ticker']}."""
    return await call_deepseek(JUDGE_SYSTEM, user_prompt, temperature=0.2)


async def analyze_stock(ticker: str, df, signals: dict, rocket_score_data: dict, sector: str) -> dict:
    """
    Run all 5 agents sequentially on one stock.
    
    Args:
        ticker: Stock ticker symbol
        df: DataFrame with OHLCV data
        signals: Dictionary of technical signals
        rocket_score_data: RocketScore breakdown
        sector: Stock sector
        
    Returns:
        Dictionary with all agent memos and final verdict
    """
    from src.facts_pack import build_facts_pack
    
    # Build facts pack
    facts_pack = build_facts_pack(ticker, df, signals, rocket_score_data, sector)
    
    # Run first 4 agents in parallel
    bull, bear, skeptic, regime = await asyncio.gather(
        run_bull_agent(facts_pack),
        run_bear_agent(facts_pack),
        run_skeptic_agent(facts_pack),
        run_regime_agent(facts_pack)
    )
    
    # Run judge with all inputs
    judge = await run_judge_agent(facts_pack, bull, bear, skeptic, regime)
    
    return {
        "ticker": ticker,
        "facts_pack": facts_pack,
        "bull": bull,
        "bear": bear,
        "skeptic": skeptic,
        "regime": regime,
        "judge": judge
    }


if __name__ == "__main__":
    """Test the agents system with NVDA."""
    import sys
    import os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    
    from src.data_fetcher import fetch_ohlcv
    from src.signals import compute_signals
    from src.rocket_score import compute_rocket_score
    from src.universe import get_sector
    
    print("\n" + "="*60)
    print("TESTING MULTI-AGENT SYSTEM")
    print("="*60 + "\n")
    
    # Test with NVDA
    ticker = "NVDA"
    print(f"Analyzing {ticker}...")
    
    # Fetch data
    print(f"  [1/5] Fetching data...")
    df = fetch_ohlcv(ticker, lookback_days=252)
    
    if df is None or len(df) < 252:
        print(f"[ERROR] Insufficient data for {ticker}")
        sys.exit(1)
    
    # Compute signals
    print(f"  [2/5] Computing signals...")
    signals = compute_signals(df)
    
    # Get sector
    sector = get_sector(ticker)
    
    # Compute RocketScore
    print(f"  [3/5] Computing RocketScore...")
    rocket_score_data = compute_rocket_score(ticker, df, signals, sector)
    
    # Run agents
    print(f"  [4/5] Running 5 AI agents (DeepSeek)...")
    analysis = asyncio.run(analyze_stock(ticker, df, signals, rocket_score_data, sector))
    
    # Display results
    print(f"  [5/5] Analysis complete!\n")
    
    print("="*60)
    print(f"AGENT ANALYSIS: {ticker}")
    print("="*60)
    
    print(f"\nRocketScore: {analysis['facts_pack']['rocket_score']:.2f}/100")
    print(f"Sector: {analysis['facts_pack']['sector']}")
    print(f"Price: ${analysis['facts_pack']['current_price']:.2f}")
    
    print("\n--- BULL THESIS ---")
    if "error" not in analysis['bull']:
        print(f"Confidence: {analysis['bull'].get('confidence', 'N/A')}%")
        print(f"Thesis: {analysis['bull'].get('thesis', 'N/A')}")
        print(f"Catalysts: {', '.join(analysis['bull'].get('catalysts', []))}")
    else:
        print(f"Error: {analysis['bull']['error']}")
    
    print("\n--- BEAR CASE ---")
    if "error" not in analysis['bear']:
        print(f"Confidence: {analysis['bear'].get('confidence', 'N/A')}%")
        print(f"Thesis: {analysis['bear'].get('thesis', 'N/A')}")
        print(f"Risks: {', '.join(analysis['bear'].get('risks', []))}")
    else:
        print(f"Error: {analysis['bear']['error']}")
    
    print("\n--- SKEPTIC ASSESSMENT ---")
    if "error" not in analysis['skeptic']:
        print(f"Assessment: {analysis['skeptic'].get('assessment', 'N/A')}")
        print(f"Recommendation: {analysis['skeptic'].get('recommendation', 'N/A')}")
        print(f"Concerns: {', '.join(analysis['skeptic'].get('concerns', []))}")
    else:
        print(f"Error: {analysis['skeptic']['error']}")
    
    print("\n--- REGIME CONTEXT ---")
    if "error" not in analysis['regime']:
        print(f"Assessment: {analysis['regime'].get('regime_assessment', 'N/A')}")
        print(f"Context: {analysis['regime'].get('sector_context', 'N/A')}")
    else:
        print(f"Error: {analysis['regime']['error']}")
    
    print("\n--- FINAL VERDICT ---")
    if "error" not in analysis['judge']:
        print(f"Decision: {analysis['judge'].get('verdict', 'N/A')}")
        print(f"Conviction: {analysis['judge'].get('conviction', 'N/A')}%")
        print(f"\nRationale:")
        for i, point in enumerate(analysis['judge'].get('position_rationale', []), 1):
            print(f"  {i}. {point}")
        
        if 'risk_controls' in analysis['judge']:
            print(f"\nRisk Controls:")
            print(f"  Stop Loss: {analysis['judge']['risk_controls'].get('stop_loss', 'N/A')}")
            print(f"  Max Position: {analysis['judge']['risk_controls'].get('max_position_size', 'N/A')}")
    else:
        print(f"Error: {analysis['judge']['error']}")
    
    print("\n" + "="*60)
    print("[OK] Multi-agent test completed!")
    print("="*60 + "\n")
