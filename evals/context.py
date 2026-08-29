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

        # Mirrors backend/main.py: the raw metrics the scorer computed. Before
        # these were forwarded the agents saw ~96 tokens of aggregate scores and
        # were still asked to cite evidence "from metrics".
        "technical_metrics": (row.get("technical_details") or {}).get("raw_metrics", {}),
        "volume_metrics": (row.get("volume_details") or {}).get("raw_metrics", {}),
        "quality_metrics": (row.get("quality_details") or {}).get("raw_metrics", {}),
        "macro_trends_matched": [
            {"name": t.get("name"), "confidence": t.get("confidence")}
            for t in ((row.get("macro_details") or {}).get("matched_trends") or [])[:3]
        ],
        "score_rationale": {
            "technical": ((row.get("technical_details") or {}).get("rationale") or [])[:4],
            "volume": ((row.get("volume_details") or {}).get("rationale") or [])[:3],
            "quality": ((row.get("quality_details") or {}).get("rationale") or [])[:3],
        },
        # What "normal" looks like, for the metrics whose baseline is not
        # self-evident.
        #
        # Without this the model systematically misreads them. Measured in the
        # pilot: volume_surge_ratio is a 10-day / 60-day average volume ratio, so
        # ~1.0 IS normal by construction (observed median across the eval set:
        # 0.97, with 79% below the 1.2 scoring threshold). All 48 judge memos
        # mentioned volume and 19 called it "weak" or "lacking conviction" -
        # reading an ordinary reading as bearish purely because no baseline was
        # given. These are factual reference points, not a thumb on the scale.
        "metric_reference": {
            "volume_surge_ratio": "10d/60d avg volume. 1.0 = normal, >1.5 elevated, <0.7 quiet",
            "volume_zscore_10d": "0 = typical volume, >2 unusually heavy",
            "up_down_volume_ratio_20d": "1.0 = balanced buying and selling",
            "drawdown_from_52w_high_pct": "0 = at the 52-week high; negative is normal",
            "trend_slope_annualized": "annualised % slope of log price over 60d",
            "scores": "each component is 0-100. NOTE volume is 0-anchored, so an "
                      "ordinary stock scores near 0 there - that is the scale, "
                      "not a red flag",
        },
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
