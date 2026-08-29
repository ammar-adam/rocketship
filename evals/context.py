"""
The context every arm sees.

Byte-identical across arms except where an arm is *defined* by a difference
(debate_no_news drops the news block). This is the whole point of the
comparison: if the arms saw different inputs, any difference in outcome would
be uninterpretable.

The layout deliberately mirrors backend/main.py::run_single_debate_with_news
lines 1332-1362, so the full_debate arm is fed the same shape production feeds
its agents.
"""
from __future__ import annotations

import json

from evals import config as C
from evals import news as news_mod
from evals.asof import score_as_of

NO_NEWS_SENTINEL = "RECENT NEWS:\nNo recent news available.\n"


def metrics_context(row: dict, rank: int, total: int) -> dict:
    """Mirror of production's metrics_context dict."""
    return {
        "ticker": row["ticker"],
        "sector": row.get("sector", "Unknown"),
        "current_price": row.get("current_price", 0),
        "rocket_score": round(row.get("rocket_score", 0), 1),
        "rank": rank,
        "total_stocks": total,
        "technical_score": round(row.get("technical_score", 0), 1),
        "volume_score": round(row.get("volume_score", 0), 1),
        "quality_score": round(row.get("quality_score", 0), 1),
        "macro_score": round(row.get("macro_score", 0), 1),
        "tags": (row.get("tags") or [])[:5],
        "signal_labels": (row.get("signal_labels") or [])[:3],
        # Production carries a selection_group here (top23 / edge / ...). The
        # eval scores the whole universe rather than a screened shortlist, so
        # there is no meaningful group; null keeps the schema stable.
        "selection_group": None,
    }


def news_block(articles: list[dict]) -> str:
    """Mirror of production's news_context string builder."""
    out = "RECENT NEWS:\n"
    if articles:
        for a in articles:
            out += "[" + a["id"] + "] " + a.get("date", "") + " - " + a.get("source", "") \
                   + ": " + a.get("title", "") + "\n"
            if a.get("summary"):
                out += "    " + a["summary"][:150] + "...\n"
    else:
        out += "No recent news available.\n"
    return out


def build(ticker: str, as_of: str, rank: int, total: int,
          include_news: bool = True) -> tuple[str, dict]:
    """
    Returns (context_string, provenance).

    provenance records exactly what went in, so results/raw/ is auditable
    after the fact without re-deriving anything.
    """
    row = score_as_of(ticker, as_of)
    mc = metrics_context(row, rank, total)

    if include_news:
        nres = news_mod.news_for(ticker, as_of)
        articles = nres.get("articles", [])
        nblock = news_block(articles)
    else:
        nres = {"articles": [], "count": 0, "error": None, "suppressed": True}
        articles = []
        nblock = NO_NEWS_SENTINEL

    context = "STOCK METRICS:\n" + json.dumps(mc, indent=2) + "\n\n" + nblock

    provenance = {
        "ticker": ticker,
        "as_of_date": as_of,
        "rank": rank,
        "include_news": include_news,
        "news_article_count": len(articles),
        "news_error": nres.get("error"),
        "news_dates": [a.get("date") for a in articles],
        "rocket_score": row.get("rocket_score"),
        "component_scores": {
            "technical": row.get("technical_score"),
            "volume": row.get("volume_score"),
            "quality": row.get("quality_score"),
            "macro": row.get("macro_score"),
        },
        "context_chars": len(context),
    }
    return context, provenance


def rank_universe(as_of: str) -> dict[str, int]:
    """
    RocketScore rank (1 = best) within the eval universe on this date.

    Production only debates the top ~30 of ~500 by this score. The eval runs
    every arm over all 50 so the arms are compared on identical pairs; the rank
    is passed into the context exactly as production passes it.
    """
    scores = []
    for t in C.TICKERS:
        try:
            scores.append((t, score_as_of(t, as_of)["rocket_score"]))
        except Exception:
            scores.append((t, float("-inf")))
    scores.sort(key=lambda kv: kv[1], reverse=True)
    return {t: i + 1 for i, (t, _) in enumerate(scores)}
