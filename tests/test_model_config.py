"""
The model pin and the thinking flag must not drift.

`deepseek-chat` is deprecated but, verified 2026-08-29, still resolves to
deepseek-v4-flash in non-thinking mode. It is pinned explicitly anyway.

The flag that actually matters is `thinking`. Measured on a trivial call:
deepseek-v4-flash with no thinking parameter returns 64 reasoning tokens and 64
output tokens, against 0 and 9 with thinking disabled. Reasoning bills as output,
so losing this flag is a silent multi-fold cost regression AND a behaviour change
relative to the system the prompts were written for.

Separately: if the LLM ever does fail wholesale, every verdict falls back to the
synthetic HOLD/50 and the forced-buy floor's sort key collapses to rocket_score,
emitting the top 8 of the screen as though a debate produced it. The health gate
must therefore run before position limits.
"""
from __future__ import annotations

import io
import os
import re

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Files that issue a real chat-completions request.
LIVE_CALL_SITES = [
    "backend/main.py",
    "src/agents.py",
    "frontend/src/lib/model.ts",
    "frontend/app/api/debug/deepseek/route.ts",
    "frontend/app/api/run/[runId]/debate/route.ts",
    "frontend/app/api/run/[runId]/debate/[ticker]/cross-exam/route.ts",
]

# Dead code, deleted in Phase 1. Excluded rather than silently passing.
KNOWN_DEAD = ["frontend/src/lib/deepseek.ts"]


def _read(rel: str) -> str:
    with io.open(os.path.join(REPO_ROOT, rel), encoding="utf-8") as f:
        return f.read()


@pytest.mark.parametrize("rel", LIVE_CALL_SITES)
def test_no_retired_model_alias_in_live_code(rel):
    text = _read(rel)
    # Allow the string inside comments explaining the retirement.
    code = "\n".join(
        ln for ln in text.splitlines()
        if not ln.lstrip().startswith(("#", "*", "//", "/*"))
    )
    assert '"deepseek-chat"' not in code and "'deepseek-chat'" not in code, \
        f"{rel} still pins the retired deepseek-chat alias"


def test_backend_defaults_to_v4_flash_with_thinking_disabled():
    text = _read("backend/main.py")
    assert 'DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-flash")' in text
    assert 'DEEPSEEK_THINKING = {"type": "disabled"}' in text
    # and the call site actually uses them
    assert '"model": DEEPSEEK_MODEL' in text
    assert '"thinking": DEEPSEEK_THINKING' in text


def test_eval_harness_agrees_with_the_product():
    from evals import config as C

    assert C.MODEL == "deepseek-v4-flash"
    assert C.THINKING == {"type": "disabled"}

    backend = _read("backend/main.py")
    m = re.search(r'DEEPSEEK_MODEL = os\.environ\.get\("DEEPSEEK_MODEL", "([^"]+)"\)', backend)
    assert m, "could not read the backend default model"
    assert m.group(1) == C.MODEL, \
        f"eval model {C.MODEL!r} != backend default {m.group(1)!r}"


def test_eval_llm_sends_thinking_and_no_seed_param():
    text = _read("evals/llm.py")
    assert '"thinking": C.THINKING' in text
    # DeepSeek has no `seed` parameter; sending one is meaningless.
    body = text.split("body = {", 1)[1].split("}", 1)[0]
    assert '"seed"' not in body, "llm.py must not send a `seed` field; the API has none"


def test_debate_aborts_rather_than_manufacturing_a_portfolio():
    text = _read("backend/main.py")
    assert "LLM_FAILURE_ABORT_RATE" in text
    assert "llm_failures_total" in text
    # The gate must sit BEFORE position limits run. If it does not, a run where
    # every LLM call failed still reaches apply_position_limits, whose sort key
    # collapses to rocket_score when all confidences are the identical fallback
    # 50 -- emitting the top 8 of the screen as though a debate produced it.
    gate = text.index("llm_fail_rate >= LLM_FAILURE_ABORT_RATE")
    selection = text.index("apply_position_limits(")
    assert gate < selection, \
        "the LLM-health gate must run before position limits are applied"
