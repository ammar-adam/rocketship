"""
DeepSeek client for the eval harness.

Differences from the product client (backend/main.py::call_agent), all
deliberate and all recorded in the run metadata:

  * every response is cached to disk by prompt hash (config 6);
  * a `seed` participates in the cache key so N seeds are N independent
    samples, cached separately;
  * the timeout is 60s rather than 25s with no retries. Production falls back
    to HOLD@confidence=30 on timeout, which would masquerade as a real opinion
    and inflate the measured seed spread. Fallbacks are counted and reported.
"""
from __future__ import annotations

import json
import os
import re
import time

import httpx

from evals import cache
from evals import config as C

DEEPSEEK_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")


class LLMUnavailable(RuntimeError):
    pass


def _require_key() -> str:
    key = os.environ.get("DEEPSEEK_API_KEY", "")
    if not key or len(key) < 20:
        raise LLMUnavailable(
            "DEEPSEEK_API_KEY is not set (or is too short). LLM arms cannot run.\n"
            "Set it and re-run; cached responses are reused so you only pay for what is new."
        )
    return key


def safe_parse_json(content: str, agent_type: str) -> dict:
    """Mirror of backend/main.py::safe_parse_json so parse behaviour matches prod."""
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", content)
        if m:
            try:
                return json.loads(m.group(1))
            except json.JSONDecodeError:
                pass
        thesis = (content[:200] + "...") if len(content) > 200 else content
        return {
            "agent": agent_type,
            "raw": content,
            "parsed": None,
            "parse_error": "Failed to parse JSON response",
            "thesis": thesis or f"{agent_type} analysis (parse error)",
            "verdict": "HOLD",
            "confidence": 40,
        }


def call(
    system: str,
    user: str,
    *,
    agent_type: str,
    seed: int,
    temperature: float | None = None,
    max_tokens: int | None = None,
) -> dict:
    """
    One LLM call. Returns:
      {parsed: dict, usage: {...}, cost_usd: float, latency_s: float,
       cached: bool, fallback: bool}
    """
    temperature = C.TEMPERATURE if temperature is None else temperature
    max_tokens = C.MAX_TOKENS if max_tokens is None else max_tokens

    key = cache.prompt_hash(
        model=C.MODEL,
        system=system,
        user=user,
        temperature=temperature,
        max_tokens=max_tokens,
        seed=seed,
    )

    hit = cache.get(key)
    if hit is not None:
        hit = dict(hit)
        hit["cached"] = True
        # cost_usd and latency_s keep the values measured when the call was
        # really made. They answer "what does this arm cost to run", which is
        # the question being asked. incremental_* answers "what did THIS rerun
        # cost", which is zero on a hit.
        hit["incremental_cost_usd"] = 0.0
        hit["incremental_latency_s"] = 0.0
        return hit

    api_key = _require_key()

    body = {
        "model": C.MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
        # DeepSeek accepts `seed` for best-effort determinism. Even where it is
        # ignored, varying it keeps the N samples independent rather than
        # collapsing them onto one cache entry.
        "seed": seed,
    }

    t0 = time.perf_counter()
    fallback = False
    try:
        with httpx.Client(timeout=httpx.Timeout(
            connect=10.0, read=C.AGENT_TIMEOUT_S, write=10.0, pool=10.0
        )) as client:
            resp = client.post(
                f"{DEEPSEEK_URL}/chat/completions",
                headers={"Authorization": f"Bearer {api_key}"},
                json=body,
            )
            resp.raise_for_status()
            data = resp.json()
        content = data["choices"][0]["message"]["content"]
        usage = data.get("usage", {}) or {}
        parsed = safe_parse_json(content, agent_type)
        raw = content
    except Exception as e:
        # Record the failure rather than silently substituting an opinion.
        fallback = True
        usage = {}
        raw = f"{type(e).__name__}: {e}"
        parsed = {
            "agent": agent_type,
            "verdict": "HOLD",
            "confidence": 30,
            "thesis": f"{agent_type} call failed",
            "error": str(e)[:300],
        }

    latency = time.perf_counter() - t0

    pt = int(usage.get("prompt_tokens", 0) or 0)
    ct = int(usage.get("completion_tokens", 0) or 0)
    cost = (pt / 1e6) * C.PRICE_IN_PER_MTOK + (ct / 1e6) * C.PRICE_OUT_PER_MTOK

    record = {
        "parsed": parsed,
        "raw": raw,
        "usage": {"prompt_tokens": pt, "completion_tokens": ct},
        "cost_usd": round(cost, 8),
        "latency_s": round(latency, 3),
        "fallback": fallback,
        "agent_type": agent_type,
        "seed": seed,
        "incremental_cost_usd": round(cost, 8),
        "incremental_latency_s": round(latency, 3),
    }

    # Never cache a failure: a transient network error must not become a
    # permanent fake answer on every future run.
    if not fallback:
        cache.put(key, record)

    record["cached"] = False
    return record
