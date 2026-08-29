"""
The retired model alias must not come back, and thinking must stay off.

`deepseek-chat` was retired 2026-07-24 15:59 UTC. Because every agent error
degrades to a synthetic HOLD and the forced-buy floor then promotes HOLDs sorted
by (-confidence, -rocket_score) -- with all confidences equal to the identical
fallback 50 -- a dead model produces a normal-looking portfolio that is really
just the top 8 of the deterministic screen. The failure is invisible from the UI.

These tests are cheap insurance against that recurring.
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
    # the gate must sit BEFORE the forced-buy promotion
    gate = text.index("llm_fail_rate >= LLM_FAILURE_ABORT_RATE")
    promotion = text.index("MIN_BUY = 8")
    assert gate < promotion, \
        "the LLM-health gate must run before the HOLD->BUY promotion"
