"""
One real API call, before spending anything.

Checks the four things that would silently corrupt a paid run:

  1. the model id resolves at all (deepseek-chat is deprecated; verify, do
     not assume, whether it still works)
  2. the response is parseable JSON in the shape the arms expect
  3. reasoning_tokens == 0, i.e. thinking really is disabled. V4 enables it by
     default; reasoning tokens bill as output, the dominant cost line, and they
     change the behaviour the product's prompts were written against
  4. the measured token counts, so the cost model is calibrated against reality
     rather than an estimate

Costs about $0.00002.

    python -m evals.preflight            # check the configured model
    python -m evals.preflight --compare  # also confirm the retired alias fails
"""
from __future__ import annotations

import json
import os
import sys
import time

import httpx

from evals import config as C

URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")


def _load_dotenv() -> None:
    """Minimal .env reader so the key never has to be exported by hand."""
    path = os.path.join(C.REPO_ROOT, ".env")
    if not os.path.exists(path):
        return
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip())


def probe(model: str, thinking: dict | None) -> dict:
    key = os.environ.get("DEEPSEEK_API_KEY", "")
    if not key or len(key) < 20:
        return {"ok": False, "error": "DEEPSEEK_API_KEY not set"}

    body = {
        "model": model,
        "messages": [
            {"role": "system",
             "content": 'Reply with valid JSON only: {"status":"ok","n":7}'},
            {"role": "user", "content": "health check"},
        ],
        "temperature": 0.0,
        "max_tokens": 64,
        "response_format": {"type": "json_object"},
    }
    if thinking is not None:
        body["thinking"] = thinking

    t0 = time.perf_counter()
    try:
        with httpx.Client(timeout=60.0) as c:
            r = c.post(f"{URL}/chat/completions",
                       headers={"Authorization": f"Bearer {key}"}, json=body)
    except Exception as e:
        return {"ok": False, "error": f"{type(e).__name__}: {str(e)[:200]}"}
    latency = time.perf_counter() - t0

    if r.status_code != 200:
        detail = r.text[:300]
        try:
            detail = json.dumps(r.json())[:300]
        except Exception:
            pass
        return {"ok": False, "status": r.status_code, "error": detail,
                "latency_s": round(latency, 2)}

    data = r.json()
    usage = data.get("usage", {}) or {}
    content = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
    try:
        parsed = json.loads(content)
        parse_ok = True
    except Exception:
        parsed, parse_ok = None, False

    details = usage.get("completion_tokens_details") or {}
    return {
        "ok": True,
        "model_echoed": data.get("model"),
        "latency_s": round(latency, 2),
        "prompt_tokens": usage.get("prompt_tokens"),
        "completion_tokens": usage.get("completion_tokens"),
        "reasoning_tokens": details.get("reasoning_tokens", 0),
        "cache_hit_tokens": usage.get("prompt_cache_hit_tokens"),
        "cache_miss_tokens": usage.get("prompt_cache_miss_tokens"),
        "json_parsed": parse_ok,
        "content": (content or "")[:120],
        "raw_usage": usage,
    }


def main(argv: list[str]) -> int:
    _load_dotenv()
    print("Preflight")
    print("=" * 66)

    if "--compare" in argv:
        # Shows WHY thinking must be pinned, with live numbers rather than a
        # claim. The deprecated alias is included because "is it dead yet" is a
        # question to answer by calling it, not by reading a blog post.
        print("\nMatrix (each row is one real call):")
        print(f"  {'model':<20}{'thinking':<11}{'ok':<6}{'reason':>8}{'output':>8}")
        for model, thinking in [
            ("deepseek-chat", None),
            ("deepseek-chat", {"type": "disabled"}),
            (C.MODEL, None),
            (C.MODEL, C.THINKING),
        ]:
            r = probe(model, thinking)
            label = thinking["type"] if thinking else "(unset)"
            print(f"  {model:<20}{label:<11}{str(r.get('ok')):<6}"
                  f"{str(r.get('reasoning_tokens')):>8}{str(r.get('completion_tokens')):>8}")
        print("  -> an unset `thinking` on V4 turns reasoning ON; it bills as output.")

    print(f"\n2. Configured model: {C.MODEL}, thinking={C.THINKING}")
    r = probe(C.MODEL, C.THINKING)
    if not r.get("ok"):
        print(f"   FAILED: HTTP {r.get('status')} {r.get('error')}")
        print("\nDo not spend anything until this passes.")
        return 1

    for k in ("model_echoed", "latency_s", "prompt_tokens", "completion_tokens",
              "reasoning_tokens", "cache_hit_tokens", "cache_miss_tokens",
              "json_parsed"):
        print(f"   {k:<22} {r.get(k)}")
    print(f"   {'content':<22} {r.get('content')!r}")

    failures = []
    if not r.get("json_parsed"):
        failures.append("response was not parseable JSON")
    if (r.get("reasoning_tokens") or 0) > 0:
        failures.append(
            f"reasoning_tokens={r['reasoning_tokens']} - thinking is ON, which "
            "inflates output cost and changes behaviour"
        )

    print()
    if failures:
        for f in failures:
            print(f"   FAIL: {f}")
        return 1
    print("   PASS - model resolves, JSON mode works, thinking is off.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
