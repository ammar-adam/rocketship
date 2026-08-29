"""
Production prompts, loaded verbatim from backend/main.py.

Rather than copying the prompt text (which would silently drift from the
product), this extracts the get_*_prompt() functions from the source file and
execs them in an isolated namespace. If someone renames or moves them, the
eval fails loudly instead of quietly evaluating stale prompts.

backend/main.py is not imported directly because importing it constructs a
FastAPI app and pulls in server dependencies the eval does not need.
"""
from __future__ import annotations

import os
import re

from evals import config as C

BACKEND_MAIN = os.path.join(C.REPO_ROOT, "backend", "main.py")

_REQUIRED = ["get_bull_prompt", "get_bear_prompt", "get_regime_prompt",
             "get_value_prompt", "get_judge_prompt"]


def _extract() -> dict:
    if not os.path.exists(BACKEND_MAIN):
        raise SystemExit("Cannot find " + BACKEND_MAIN)
    src = open(BACKEND_MAIN, encoding="utf-8").read()

    ns: dict = {}
    for name in _REQUIRED:
        # Grab `def name() -> str:` through to the next top-level def/decorator.
        m = re.search(
            r"^def " + name + r"\(\) -> str:\n(?:.*?\n)*?(?=^(?:def |@|# =))",
            src,
            flags=re.MULTILINE,
        )
        if not m:
            raise SystemExit(
                "Could not extract " + name + " from backend/main.py. The eval "
                "must use production prompts verbatim; refusing to guess."
            )
        exec(compile(m.group(0), BACKEND_MAIN, "exec"), ns)

    missing = [n for n in _REQUIRED if n not in ns]
    if missing:
        raise SystemExit("Extraction incomplete: " + ", ".join(missing))
    return ns


_NS = _extract()

BULL = _NS["get_bull_prompt"]()
BEAR = _NS["get_bear_prompt"]()
REGIME = _NS["get_regime_prompt"]()
VALUE = _NS["get_value_prompt"]()
JUDGE = _NS["get_judge_prompt"]()

AGENT_PROMPTS = {"bull": BULL, "bear": BEAR, "regime": REGIME, "value": VALUE}


# ---------------------------------------------------------------------------
# Eval-only additions
# ---------------------------------------------------------------------------

# Production emits `confidence` (0-100), which is a confidence in a verdict, not
# a probability of any measurable event -- nothing to score a Brier against. So
# every deciding arm gets this one appended block, identical text, so the arms
# stay comparable to each other. It DOES mean the deciding prompt is production
# text plus this block, and results/summary.md says so.
BRIER_EXTENSION = """

ADDITIONALLY (evaluation harness field, required):
Include a field "prob_beat_spy_1m": an integer 0-100 giving the probability
that this stock's total return over the NEXT ONE MONTH exceeds SPY's total
return over the same month. 50 means a coin flip. Be calibrated: if you say 80,
you should be right about 80% of the time across many such calls."""


# The single-call arm: one prompt carrying the same four analytic asks plus the
# same decision rule, so it sees identical content with no debate structure.
SINGLE_CALL = (
    """You are a senior portfolio manager for a $10,000 AGGRESSIVE GROWTH portfolio.

Work through all four analytic lenses yourself, in one pass, then decide.

1. BULL LENS: the strongest evidence-based case to buy this stock.
2. BEAR LENS: the risks and concerns, fairly weighted.
3. REGIME LENS: whether the market/sector environment is favourable.
4. VALUE LENS: valuation and margin of safety.

Then apply this decision framework:
"""
    + JUDGE
    + """

Return ONE JSON object containing your four lenses and your decision:
{
  "bull_view": "2-3 sentences",
  "bear_view": "2-3 sentences",
  "regime_view": "2-3 sentences",
  "value_view": "2-3 sentences",
  "verdict": "ENTER|HOLD|EXIT",
  "confidence": 0-100,
  "reasoning": "3-5 sentence summary"
}"""
)
