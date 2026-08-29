"""
As-of news retrieval, plus an audit of the product's news path.

THE LEAK THIS CLOSES
--------------------
Both product news fetchers hardcode the window to *now*:

    backend/main.py:481          to_date = datetime.now(UTC)
                                 from_date = to_date - timedelta(days=days)
    frontend/lib/newsapi.ts:56   const toDate = new Date();

Neither accepts an as-of date, so replaying a past date through the product
would hand the agents headlines from the future. This module takes an explicit
as-of date, requests a window that ends strictly before it, and then re-checks
every returned article's publishedAt and raises rather than proceeding.

Results are frozen into evals/fixtures/news.json so a run is reproducible and
does not re-hit NewsAPI.

    python -m evals.news --audit    # audit the product call path, no network
    python -m evals.news --fetch    # populate the news fixture (needs NEWS_API_KEY)
"""
from __future__ import annotations

import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

from evals import config as C
from evals.asof import LeakError

NEWS_API_BASE = "https://newsapi.org/v2"


# ---------------------------------------------------------------------------
# Leak guard
# ---------------------------------------------------------------------------

def assert_articles_are_as_of(articles: list[dict], as_of: str, ticker: str) -> None:
    """
    Fail loudly if any article is dated on or after the as-of date.

    Strict inequality: an article published during the as-of session could
    itself be a reaction to that session's price move, which is exactly the
    information the pipeline is supposed to be predicting.
    """
    cutoff = datetime.strptime(as_of, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    offenders = []
    for a in articles:
        raw = (a.get("publishedAt") or a.get("date") or "").strip()
        if not raw:
            offenders.append((a.get("title", "?"), "<missing publishedAt>"))
            continue
        try:
            ts = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        except ValueError:
            try:
                ts = datetime.strptime(raw[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
            except ValueError:
                offenders.append((a.get("title", "?"), f"<unparseable: {raw}>"))
                continue
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        if ts >= cutoff:
            offenders.append((a.get("title", "?"), raw))

    if offenders:
        lines = "\n".join(f"    {ts}  {title[:80]}" for title, ts in offenders[:10])
        raise LeakError(
            f"{ticker} @ {as_of}: {len(offenders)} article(s) published on or after the "
            f"as-of date reached the pipeline. Refusing to run.\n{lines}"
        )


# ---------------------------------------------------------------------------
# Fetch
# ---------------------------------------------------------------------------

def fetch_news_as_of(ticker: str, as_of: str, days: int | None = None,
                     limit: int | None = None) -> dict:
    """
    NewsAPI /everything restricted to [as_of - days, as_of), then re-verified.

    Returns {"articles": [...], "count": n, "error": str|None, "window": {...}}.
    A NewsAPI plan without historical archive access yields an explicit error,
    never a silent fallback to recent news.
    """
    import httpx

    days = C.NEWS_LOOKBACK_DAYS if days is None else days
    limit = C.NEWS_LIMIT if limit is None else limit

    api_key = os.environ.get("NEWS_API_KEY", "")
    as_of_dt = datetime.strptime(as_of, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    from_dt = as_of_dt - timedelta(days=days)
    to_dt = as_of_dt - timedelta(seconds=1)   # strictly before the as-of date

    window = {"from": from_dt.strftime("%Y-%m-%d"), "to": to_dt.strftime("%Y-%m-%d")}

    if not api_key or len(api_key) < 20:
        return {"articles": [], "count": 0, "window": window,
                "error": "NEWS_API_KEY not configured"}

    params = {
        "q": ticker,
        "from": from_dt.strftime("%Y-%m-%dT%H:%M:%S"),
        "to": to_dt.strftime("%Y-%m-%dT%H:%M:%S"),
        "sortBy": "publishedAt",
        "language": "en",
        "pageSize": str(limit),
        "apiKey": api_key,
    }

    try:
        with httpx.Client(timeout=20.0) as client:
            r = client.get(f"{NEWS_API_BASE}/everything", params=params,
                           headers={"User-Agent": "RocketShip-Eval/1.0"})
        if r.status_code != 200:
            try:
                detail = r.json().get("message", "")[:200]
            except Exception:
                detail = r.text[:200]
            return {"articles": [], "count": 0, "window": window,
                    "error": f"NewsAPI {r.status_code}: {detail}"}
        data = r.json()
        if data.get("status") != "ok":
            return {"articles": [], "count": 0, "window": window,
                    "error": str(data.get("message", "NewsAPI non-ok status"))[:200]}
    except Exception as e:
        return {"articles": [], "count": 0, "window": window,
                "error": f"{type(e).__name__}: {str(e)[:200]}"}

    articles = []
    for i, a in enumerate(data.get("articles", [])[:limit]):
        articles.append({
            "id": f"N{i+1}",
            "title": (a.get("title") or "")[:150],
            "source": (a.get("source") or {}).get("name", "Unknown"),
            "publishedAt": a.get("publishedAt", ""),
            "date": (a.get("publishedAt") or "")[:10],
            "summary": (a.get("description") or "")[:200],
        })

    # The whole point: verify rather than trust the API honoured `to`.
    assert_articles_are_as_of(articles, as_of, ticker)

    return {"articles": articles, "count": len(articles), "window": window, "error": None}


# ---------------------------------------------------------------------------
# Fixture
# ---------------------------------------------------------------------------

def load_fixture() -> dict:
    if not os.path.exists(C.NEWS_FIXTURE_PATH):
        return {}
    with open(C.NEWS_FIXTURE_PATH, "r", encoding="utf-8") as f:
        return json.load(f)


def news_for(ticker: str, as_of: str) -> dict:
    """Frozen news for a pair, re-verified on every read."""
    entry = load_fixture().get(ticker + "@" + as_of)
    if entry is None:
        return {"articles": [], "count": 0, "error": "not in news fixture"}
    assert_articles_are_as_of(entry.get("articles", []), as_of, ticker)
    return entry


def build_fixture() -> dict:
    out: dict = {}
    total, with_news, errors = 0, 0, 0
    for as_of in C.AS_OF_DATES:
        for ticker in C.TICKERS:
            total += 1
            res = fetch_news_as_of(ticker, as_of)
            out[ticker + "@" + as_of] = res
            if res.get("error"):
                errors += 1
            elif res["count"] > 0:
                with_news += 1
        got = sum(1 for t in C.TICKERS if out[t + "@" + as_of].get("count", 0) > 0)
        print("  " + as_of + ": " + str(got) + "/" + str(len(C.TICKERS)) + " tickers with articles")

    os.makedirs(C.FIXTURE_DIR, exist_ok=True)
    with open(C.NEWS_FIXTURE_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print("\nWrote " + C.NEWS_FIXTURE_PATH + ": " + str(with_news) + "/" + str(total)
          + " pairs with articles, " + str(errors) + " errors")
    return out


def coverage() -> dict:
    """Per-date news coverage, for honest reporting in the summary."""
    fx = load_fixture()
    cov = {}
    for as_of in C.AS_OF_DATES:
        n_with, n_articles, errs = 0, 0, {}
        for t in C.TICKERS:
            e = fx.get(t + "@" + as_of)
            if not e:
                errs["missing from fixture"] = errs.get("missing from fixture", 0) + 1
                continue
            if e.get("error"):
                k = str(e["error"])[:60]
                errs[k] = errs.get(k, 0) + 1
            if e.get("count", 0) > 0:
                n_with += 1
                n_articles += e["count"]
        cov[as_of] = {
            "tickers_with_news": n_with,
            "tickers_total": len(C.TICKERS),
            "articles_total": n_articles,
            "errors": errs,
        }
    return cov


# ---------------------------------------------------------------------------
# Static audit of the product's news path
# ---------------------------------------------------------------------------

_AUDIT_TARGETS = [
    ("backend/main.py", r"to_date\s*=\s*datetime\.now\(", "python news fetcher (live path)"),
    ("frontend/lib/newsapi.ts", r"const toDate\s*=\s*new Date\(\)", "next.js news fetcher"),
    ("frontend/src/lib/newsapi.ts", r"const toDate\s*=\s*new Date\(\)", "next.js news fetcher (dup copy)"),
]


def audit_product_news_path() -> list[dict]:
    """
    Grep the product for now-anchored news windows. Purely static; no network.
    Reported in results/summary.md so the leak stays visible instead of being
    quietly handled by the eval and forgotten.
    """
    findings = []
    for rel, pattern, label in _AUDIT_TARGETS:
        path = os.path.join(C.REPO_ROOT, rel)
        if not os.path.exists(path):
            continue
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            for lineno, line in enumerate(f, 1):
                if re.search(pattern, line):
                    findings.append({
                        "file": rel,
                        "line": lineno,
                        "label": label,
                        "code": line.strip(),
                        "issue": "news window anchored to now(); no as-of parameter exists",
                    })
    return findings


def _main(argv: list[str]) -> int:
    if "--fetch" in argv:
        build_fixture()
        return 0

    findings = audit_product_news_path()
    print("NewsAPI call-path audit")
    print("=" * 70)
    if not findings:
        print("No now-anchored news windows found.")
    for f in findings:
        print("  LEAK  " + f["file"] + ":" + str(f["line"]) + "  (" + f["label"] + ")")
        print("        " + f["code"])
        print("        -> " + f["issue"])
    print()
    print("The eval does not use these paths. evals/news.py takes an explicit")
    print("as-of date and re-verifies every article's publishedAt before use.")
    fx = load_fixture()
    print("\nNews fixture: " + str(len(fx)) + " entries at " + C.NEWS_FIXTURE_PATH)
    if fx:
        for as_of, c in coverage().items():
            print("  " + as_of + ": " + str(c["tickers_with_news"]) + "/"
                  + str(c["tickers_total"]) + " tickers, "
                  + str(c["articles_total"]) + " articles")
            for k, v in c["errors"].items():
                print("      " + str(v) + " x " + k)
    return 0


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
