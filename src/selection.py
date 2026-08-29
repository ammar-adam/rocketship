"""
Position-limit logic: turning judge verdicts into an 8-12 name book.

Extracted verbatim from backend/main.py::run_debate_pipeline, where it sat
inline inside a 470-line function and could not be tested or evaluated. It is
the single largest DETERMINISTIC lever on the final portfolio: it can promote
stocks the judge declined to buy, drop stocks it did buy, and it always emits
between 8 and 12 names whatever the debate concluded.

Behaviour is unchanged. The `log` callable defaults to a no-op so the caller can
pass its own logger and keep every existing log line byte for byte. The ablation
flags all default to shipped behaviour, so this is strictly additive; Stage C of
the eval flips them to ask what each rule is worth.
"""
from __future__ import annotations

from typing import Any, Callable

MIN_BUY = 8
MAX_BUY = 12
MAX_PER_SECTOR = 6


def _rank_key(entry: dict) -> tuple:
    """
    Production's ordering: confidence first, RocketScore as the tiebreak.

    Worth knowing: when every confidence is equal -- which is exactly what
    happens when the LLM is failing and each verdict falls back to the synthetic
    HOLD/50 -- this collapses to rocket_score descending, and the "debate output"
    silently becomes the top N of the deterministic screen.
    """
    return (-entry.get("confidence", 0), -entry.get("rocket_score", 0))


def apply_position_limits(
    summary: dict,
    *,
    min_buy: int = MIN_BUY,
    max_buy: int = MAX_BUY,
    max_per_sector: int = MAX_PER_SECTOR,
    promote_holds: bool = True,
    apply_sector_cap: bool = True,
    log: Callable[[str], None] = lambda _msg: None,
) -> tuple[list[dict], dict, dict]:
    """
    Returns (final_buys, summary, trace).

    `summary` is mutated in place exactly as production mutates it (promoted
    tickers move from 'hold' to 'buy' and gain promoted_from_hold), and is also
    returned for convenience.

    `trace` records what each rule actually did, so an evaluation can attribute
    the outcome to promotion vs sector cap vs clamp rather than guessing.
    """
    by_ticker: dict[str, Any] = summary["byTicker"]
    trace: dict = {
        "judge_buy": list(summary["buy"]),
        "judge_hold": list(summary["hold"]),
        "judge_sell": list(summary.get("sell", [])),
        "promoted": [],
        "sector_dropped": [],
        "clamped": [],
        "padded": [],
    }

    log(f"Force buy check: {len(summary['buy'])} BUY, {len(summary['hold'])} HOLD, "
        f"{len(summary.get('sell', []))} SELL")

    # ---- 1. promote HOLDs to reach the floor ---------------------------
    if promote_holds and len(summary["buy"]) < min_buy:
        hold_candidates = [(t, by_ticker[t]) for t in summary["hold"] if t in by_ticker]
        hold_candidates.sort(key=lambda x: _rank_key(x[1]))
        needed = min_buy - len(summary["buy"])
        log(f"Promoting {needed} HOLD -> BUY to reach MIN_BUY={min_buy}")
        for ticker, data in hold_candidates[:needed]:
            summary["buy"].append(ticker)
            summary["hold"].remove(ticker)
            by_ticker[ticker] = {**data, "verdict": "BUY", "promoted_from_hold": True}
            trace["promoted"].append(ticker)
        log(f"Promoted {len(trace['promoted'])} HOLD to BUY")
    else:
        log(f"No promotion needed ({len(summary['buy'])} BUY >= MIN_BUY={min_buy})")

    # ---- 2. rank ------------------------------------------------------
    candidates = [
        {"ticker": t, **by_ticker[t], "conviction": "high"}
        for t in summary["buy"] if t in by_ticker
    ]
    candidates.sort(key=_rank_key)

    # ---- 3. sector cap ------------------------------------------------
    if apply_sector_cap:
        counts: dict[str, int] = {}
        kept = []
        for c in candidates:
            sector = c.get("sector") or "Unknown"
            if counts.get(sector, 0) < max_per_sector:
                kept.append(c)
                counts[sector] = counts.get(sector, 0) + 1
            else:
                trace["sector_dropped"].append(c["ticker"])
        if trace["sector_dropped"]:
            log(f"Sector diversification: skipped {len(trace['sector_dropped'])} "
                f"candidates (max {max_per_sector} per sector)")
        candidates = kept

    # ---- 4. hard clamp ------------------------------------------------
    if len(candidates) > max_buy:
        trace["clamped"] = [c["ticker"] for c in candidates[max_buy:]]
        log(f"Capping {len(candidates)} BUY -> {max_buy} (MAX_BUY limit)")
    final_buys = candidates[:max_buy]

    # ---- 5. pad from remaining HOLDs ----------------------------------
    # Note these are NOT sector-capped, so padding can breach max_per_sector.
    # Preserved because it is production behaviour; Stage C measures it.
    if len(final_buys) < min_buy:
        remaining = [
            {"ticker": t, **by_ticker[t], "conviction": "low"}
            for t in summary["hold"] if t in by_ticker
        ]
        remaining.sort(key=_rank_key)
        needed = min_buy - len(final_buys)
        log(f"Padding final_buys: {len(final_buys)} -> {min_buy} by adding {needed} HOLD")
        chosen = remaining[:needed]
        final_buys.extend(chosen)
        trace["padded"] = [c["ticker"] for c in chosen]

    log(f"Final buys: {len(final_buys)} positions (target {min_buy}-{max_buy})")
    log(f"  Tickers: {[f['ticker'] for f in final_buys]}")

    trace["final"] = [f["ticker"] for f in final_buys]
    trace["n_final"] = len(final_buys)
    return final_buys, summary, trace


def selection_breakdown(final_buys: list[dict]) -> dict:
    """Counts by the debate's candidate-selection group, for final_buys.json."""
    groups = ("top23", "edge", "best_of_worst", "extra")
    return {g: len([f for f in final_buys if f.get("selection_group") == g]) for g in groups}
