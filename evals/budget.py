"""
Hard spend ceiling.

A per-call reservation, not a running total checked afterwards. The reservation
prices output at `max_tokens` -- the worst case the API could return -- so the
guard can never be overshot by a single unexpectedly long completion. The actual
usage is settled once the response arrives and the difference is released.

Deliberately small: one process-local guard with one number. No ledger, no
rolling windows, no per-arm sub-budgets. The purpose is to make "a bug in a loop
spends unbounded money" impossible, and that needs a ceiling, not accounting.
"""
from __future__ import annotations

import threading
from datetime import datetime, timezone

from evals import config as C


class BudgetExceeded(RuntimeError):
    """Raised instead of making a call that could breach the ceiling."""


def tariff(dt: datetime | None = None) -> dict:
    """Peak: 01:00-04:00 and 06:00-10:00 UTC, Mon-Fri. Off-peak is half price."""
    return C.tariff(dt or datetime.now(timezone.utc))


def estimate_cost(prompt_tokens: int, completion_tokens: int,
                  dt: datetime | None = None, cached_input: bool = False) -> float:
    t = tariff(dt)
    in_rate = t["in_hit"] if cached_input else t["in_miss"]
    return (prompt_tokens / 1e6) * in_rate + (completion_tokens / 1e6) * t["out"]


class BudgetGuard:
    """Thread-safe; the arms fan out agents across a pool."""

    def __init__(self, max_usd: float, label: str = "eval"):
        self.max_usd = float(max_usd)
        self.label = label
        self._spent = 0.0
        self._reserved = 0.0
        self._calls = 0
        self._lock = threading.Lock()

    # -- accounting -----------------------------------------------------
    @property
    def spent(self) -> float:
        with self._lock:
            return self._spent

    @property
    def committed(self) -> float:
        with self._lock:
            return self._spent + self._reserved

    @property
    def remaining(self) -> float:
        return max(0.0, self.max_usd - self.committed)

    def snapshot(self) -> dict:
        with self._lock:
            return {
                "label": self.label,
                "max_usd": round(self.max_usd, 4),
                "spent_usd": round(self._spent, 6),
                "reserved_usd": round(self._reserved, 6),
                "remaining_usd": round(max(0.0, self.max_usd - self._spent - self._reserved), 6),
                "calls": self._calls,
                "tariff": "peak" if tariff() is C.PRICE_PEAK else "off-peak",
            }

    # -- the two operations ---------------------------------------------
    def reserve(self, prompt_tokens: int, max_tokens: int) -> float:
        """
        Worst-case price for one call. Raises rather than letting it proceed.

        Pricing output at max_tokens is intentional: the response length is not
        known in advance, so anything less would let a long completion overshoot
        the ceiling.
        """
        worst = estimate_cost(prompt_tokens, max_tokens)
        with self._lock:
            if self._spent + self._reserved + worst > self.max_usd:
                raise BudgetExceeded(
                    f"[{self.label}] budget ceiling reached: "
                    f"spent ${self._spent:.4f} + reserved ${self._reserved:.4f} "
                    f"+ this call's worst case ${worst:.4f} "
                    f"exceeds ${self.max_usd:.2f}. "
                    f"Raise EVAL_BUDGET_USD_MAX and re-run; the prompt-hash cache "
                    f"means nothing already bought is paid for twice."
                )
            self._reserved += worst
            return worst

    def settle(self, reserved: float, prompt_tokens: int, completion_tokens: int,
               cached_input: bool = False) -> float:
        """Replace the reservation with the real cost."""
        actual = estimate_cost(prompt_tokens, completion_tokens, cached_input=cached_input)
        with self._lock:
            self._reserved = max(0.0, self._reserved - reserved)
            self._spent += actual
            self._calls += 1
        return actual

    def release(self, reserved: float) -> None:
        """Give back a reservation for a call that never billed (e.g. it errored)."""
        with self._lock:
            self._reserved = max(0.0, self._reserved - reserved)


def make_guard(max_usd: float | None = None, label: str = "eval") -> BudgetGuard:
    return BudgetGuard(max_usd if max_usd is not None else C.BUDGET_USD_MAX, label)
