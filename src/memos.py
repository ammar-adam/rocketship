"""Memo generation for stock analysis results."""
import os


def write_memo(ticker: str, analysis_result: dict, output_dir: str) -> None:
    """
    Write markdown memo to {output_dir}/memos/{ticker}.md
    
    Args:
        ticker: Stock ticker symbol
        analysis_result: Dictionary containing all agent outputs
        output_dir: Base output directory
    """
    os.makedirs(f"{output_dir}/memos", exist_ok=True)
    
    fp = analysis_result["facts_pack"]
    bull = analysis_result["bull"]
    bear = analysis_result["bear"]
    skeptic = analysis_result["skeptic"]
    regime = analysis_result["regime"]
    judge = analysis_result["judge"]
    
    memo = f"""# RocketShip Analysis: {ticker}

**Date:** {fp['date']}  
**Sector:** {fp['sector']}  
**Current Price:** ${fp['current_price']:.2f}  
**RocketScore:** {fp['rocket_score']}/100

## RocketScore Breakdown

| Component | Score | Weight |
|-----------|-------|--------|
| Momentum | {fp['rocket_score_breakdown']['momentum']}/100 | 35% |
| Volume | {fp['rocket_score_breakdown']['volume']}/100 | 25% |
| Trend | {fp['rocket_score_breakdown']['trend']}/100 | 25% |
| Quality | {fp['rocket_score_breakdown']['quality']}/100 | 15% |
| **Technical** | **{fp['rocket_score_breakdown']['technical']:.1f}/100** | **60%** |
| **Macro Alignment** | **{fp['rocket_score_breakdown']['macro']:.1f}/100** | **40%** |

## Macro Trends Matched

"""
    
    for trend in fp.get('macro_trends_matched', []):
        memo += f"* **{trend['name']}** (Confidence: {trend['confidence']}%)\n"
        memo += f"  - {trend['thesis']}\n\n"
    
    memo += f"""---

## Judge Decision

**Verdict:** `{judge.get('verdict', 'N/A')}`  
**Conviction:** {judge.get('conviction', 0)}/100

### Position Rationale
"""
    
    for i, rationale in enumerate(judge.get('position_rationale', []), 1):
        memo += f"{i}. {rationale}\n"
    
    risk_controls = judge.get('risk_controls', {})
    memo += f"""
### Risk Controls
- **Stop Loss:** {risk_controls.get('stop_loss', 'N/A')}
- **Invalidation:** {risk_controls.get('invalidation', 'N/A')}
- **Max Position:** {risk_controls.get('max_position_size', 'N/A')}

### What Would Change My Mind
"""
    
    for condition in judge.get('change_my_mind', []):
        memo += f"- {condition}\n"
    
    memo += f"""
---

## Bull Case

**Thesis:** {bull.get('thesis', 'N/A')}

**Catalysts:**
"""
    
    for i, catalyst in enumerate(bull.get('catalysts', []), 1):
        memo += f"{i}. {catalyst}\n"
    
    memo += "\n**Macro Alignment:**\n"
    for alignment in bull.get('macro_alignment', []):
        memo += f"- {alignment}\n"
    
    memo += "\n**Key Assumptions:**\n"
    for assumption in bull.get('key_assumptions', []):
        memo += f"- {assumption}\n"
    
    memo += "\n**Failure Modes:**\n"
    for failure in bull.get('failure_modes', []):
        memo += f"- {failure}\n"
    
    memo += f"\n**Confidence:** {bull.get('confidence', 0)}/100\n"
    
    memo += f"""
---

## Bear Case

**Thesis:** {bear.get('thesis', 'N/A')}

**Risks:**
"""
    
    for i, risk in enumerate(bear.get('risks', []), 1):
        memo += f"{i}. {risk}\n"
    
    memo += "\n**Macro Concerns:**\n"
    for concern in bear.get('macro_concerns', []):
        memo += f"- {concern}\n"
    
    memo += "\n**Key Assumptions:**\n"
    for assumption in bear.get('key_assumptions', []):
        memo += f"- {assumption}\n"
    
    memo += "\n**What Would Prove Me Wrong:**\n"
    for invalidation in bear.get('invalidation', []):
        memo += f"- {invalidation}\n"
    
    memo += f"\n**Confidence:** {bear.get('confidence', 0)}/100\n"
    
    memo += f"""
---

## Skeptic Analysis

**Assessment:** `{skeptic.get('assessment', 'N/A')}`

**Concerns:**
"""
    
    for concern in skeptic.get('concerns', []):
        memo += f"- {concern}\n"
    
    memo += "\n**Data Quality Flags:**\n"
    for flag in skeptic.get('data_quality_flags', []):
        memo += f"- {flag}\n"
    
    memo += f"""
**Recommendation:** `{skeptic.get('recommendation', 'N/A')}`

**Confidence:** {skeptic.get('confidence', 0)}/100

---

## Regime Analysis

**Assessment:** `{regime.get('regime_assessment', 'N/A')}`

**Sector Context:** {regime.get('sector_context', 'N/A')}

**Macro Alignment:** {regime.get('macro_alignment', 'N/A')}

**Relative Positioning:** {regime.get('relative_positioning', 'N/A')}

**Confidence:** {regime.get('confidence', 0)}/100

---

## Technical Details

- **20D Momentum:** {fp['signals']['price_change_20d']}%
- **60D Momentum:** {fp['signals']['price_change_60d']}%
- **Acceleration:** {fp['signals']['acceleration']}
- **Volume Surge:** {fp['signals']['volume_surge']}x
- **Volatility (20D):** {fp['signals']['volatility_20d']}%
- **Distance from 52W High:** {fp['signals']['distance_from_52w_high']}%
- **Above SMA50:** {fp['signals']['above_sma50']}
- **Above SMA200:** {fp['signals']['above_sma200']}
"""
    
    with open(f"{output_dir}/memos/{ticker}.md", "w") as f:
        f.write(memo)
