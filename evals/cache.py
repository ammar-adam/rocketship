"""
Disk cache for LLM responses, keyed by a hash of everything that determines the
response: model, temperature, max_tokens, system prompt, user prompt, seed.

Reruns of an unchanged arm cost nothing. Changing a prompt changes the hash, so
stale entries are never silently reused -- they are simply never hit again.
"""
from __future__ import annotations

import hashlib
import json
import os
import threading

from evals import config as C

_lock = threading.Lock()


def prompt_hash(
    *, model: str, system: str, user: str, temperature: float, max_tokens: int, seed: int
) -> str:
    payload = json.dumps(
        {
            "model": model,
            "system": system,
            "user": user,
            "temperature": temperature,
            "max_tokens": max_tokens,
            "seed": seed,
        },
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _path(key: str) -> str:
    # Shard by first two hex chars to keep directory listings sane.
    d = os.path.join(C.CACHE_DIR, key[:2])
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, f"{key}.json")


def get(key: str) -> dict | None:
    p = _path(key)
    if not os.path.exists(p):
        return None
    try:
        with open(p, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return None


def put(key: str, record: dict) -> None:
    p = _path(key)
    tmp = p + ".tmp"
    with _lock:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(record, f)
        os.replace(tmp, p)


def stats() -> dict:
    n = 0
    size = 0
    if os.path.isdir(C.CACHE_DIR):
        for root, _, files in os.walk(C.CACHE_DIR):
            for fn in files:
                if fn.endswith(".json"):
                    n += 1
                    size += os.path.getsize(os.path.join(root, fn))
    return {"entries": n, "bytes": size}
