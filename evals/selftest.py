"""
Self-test for the harness itself.

None of this calls an LLM. It checks that the machinery would report a real
signal as real and a fake one as fake, which is the only way to trust a
negative result later.

    python -m evals.selftest
"""
from __future__ import annotations

import sys

from evals import config as C
from evals import metrics as M
from evals import news as news_mod
from evals.asof import LeakError, as_of_window, neutralise_quality_score
from evals.runner import labels_from, load_eval_set

FAILURES: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    if cond:
        print("  PASS  " + name)
    else:
        print("  FAIL  " + name + ("  -- " + detail if detail else ""))
        FAILURES.append(name)


# ---------------------------------------------------------------------------

def test_spearman_primitives():
    print("\nSpearman primitives")
    xs = [1, 2, 3, 4, 5]
    check("perfect positive = 1.0", abs(M.spearman(xs, [10, 20, 30, 40, 50]) - 1.0) < 1e-9)
    check("perfect negative = -1.0", abs(M.spearman(xs, [50, 40, 30, 20, 10]) + 1.0) < 1e-9)
    check("monotone but non-linear still 1.0",
          abs(M.spearman(xs, [1, 4, 9, 16, 25]) - 1.0) < 1e-9)
    check("constant input -> None (no rank information)",
          M.spearman([5, 5, 5, 5, 5], [1, 2, 3, 4, 5]) is None)
    check("ties averaged", M.spearman([1, 1, 2, 2], [1, 2, 3, 4]) is not None)


def test_metrics_recover_known_signal():
    """An oracle arm must score ~1.0; an anti-oracle ~-1.0; noise ~0."""
    print("\nMetrics recover a known signal")
    fixture = load_eval_set()
    labels = labels_from(fixture)
    pairs = fixture["pairs"]

    def rows_from(scorer):
        out = []
        for p in pairs:
            exc = p["fwd_excess_1M"]
            out.append({
                "arm": "synthetic", "ticker": p["ticker"], "as_of_date": p["as_of_date"],
                "seed": 1, "verdict": "BUY", "confidence": 50,
                "score": scorer(exc, p), "prob_beat_spy_1m": 1.0 if exc > 0 else 0.0,
                "n_calls": 0, "cost_usd": 0.0,
            })
        return out

    oracle = M.metrics_for_seed(rows_from(lambda e, p: e), labels, "1M", top_n=5)
    anti = M.metrics_for_seed(rows_from(lambda e, p: -e), labels, "1M", top_n=5)

    import random as _r
    rng = _r.Random(0)
    noise = M.metrics_for_seed(rows_from(lambda e, p: rng.random()), labels, "1M", top_n=5)

    check("oracle spearman ~ +1", oracle["spearman"] > 0.99, str(oracle["spearman"]))
    check("anti-oracle spearman ~ -1", anti["spearman"] < -0.99, str(anti["spearman"]))
    check("noise spearman near 0", abs(noise["spearman"]) < 0.35, str(noise["spearman"]))
    check("oracle top-N hit rate = 1.0", oracle["hit_rate_top_n"] > 0.99,
          str(oracle["hit_rate_top_n"]))
    check("oracle top-decile excess > anti's",
          oracle["top_decile_excess"] > anti["top_decile_excess"])
    check("perfect probabilities -> Brier 0", oracle["brier"] < 1e-9, str(oracle["brier"]))


def test_brier_scale():
    print("\nBrier scale")
    fixture = load_eval_set()
    labels = labels_from(fixture)
    rows = [{
        "arm": "s", "ticker": p["ticker"], "as_of_date": p["as_of_date"], "seed": 1,
        "verdict": "HOLD", "confidence": 50, "score": 50.0,
        "prob_beat_spy_1m": 0.5, "n_calls": 0, "cost_usd": 0.0,
    } for p in fixture["pairs"]]
    m = M.metrics_for_seed(rows, labels, "1M", top_n=5)
    check("always-50% gives Brier 0.25", abs(m["brier"] - 0.25) < 1e-9, str(m["brier"]))
    check("constant score gives spearman None", m["spearman"] is None)


def test_separation_rule():
    print("\nSeed-separation rule")
    hi = {"k": {"mean": 0.20, "sd": 0.01, "min": 0.18, "max": 0.22, "n_seeds": 5}}
    lo = {"k": {"mean": 0.05, "sd": 0.01, "min": 0.03, "max": 0.07, "n_seeds": 5}}
    overlap = {"k": {"mean": 0.19, "sd": 0.05, "min": 0.10, "max": 0.30, "n_seeds": 5}}
    check("disjoint ranges separate", M.separated(hi, lo, "k"))
    check("overlapping ranges do not", not M.separated(hi, overlap, "k"))
    check("missing data does not separate", not M.separated(hi, {}, "k"))


def test_as_of_price_truncation():
    print("\nAs-of price discipline")
    import pandas as pd

    as_of = C.AS_OF_DATES[1]
    df = as_of_window("AAPL", as_of)
    check("window ends on or before as-of", df.index.max() <= pd.Timestamp(as_of),
          str(df.index.max()))
    check("window is the configured lookback", len(df) == C.LOOKBACK_TRADING_DAYS,
          str(len(df)))

    later = as_of_window("AAPL", C.AS_OF_DATES[2])
    check("a later as-of yields a later window", later.index.max() > df.index.max())

    # A window that has been tampered with must be rejected.
    from evals.asof import assert_prices_are_as_of
    bad = df.copy()
    bad.loc[pd.Timestamp(as_of) + pd.Timedelta(days=5)] = bad.iloc[-1]
    try:
        assert_prices_are_as_of(bad, as_of, "AAPL")
        check("future price row is rejected", False, "no LeakError raised")
    except LeakError:
        check("future price row is rejected", True)


def test_as_of_news_guard():
    print("\nAs-of news guard")
    as_of = "2026-01-20"
    ok = [{"title": "before", "publishedAt": "2026-01-14T10:00:00Z"}]
    try:
        news_mod.assert_articles_are_as_of(ok, as_of, "TEST")
        check("article before as-of passes", True)
    except LeakError as e:
        check("article before as-of passes", False, str(e)[:80])

    for label, bad in [
        ("same-day article is rejected", [{"title": "x", "publishedAt": "2026-01-20T00:00:01Z"}]),
        ("later article is rejected", [{"title": "x", "publishedAt": "2026-02-01T00:00:00Z"}]),
        ("missing publishedAt is rejected", [{"title": "x"}]),
        ("unparseable date is rejected", [{"title": "x", "publishedAt": "not-a-date"}]),
    ]:
        try:
            news_mod.assert_articles_are_as_of(bad, as_of, "TEST")
            check(label, False, "no LeakError raised")
        except LeakError:
            check(label, True)


def test_product_news_audit_still_finds_the_leak():
    print("\nProduct news-path audit")
    findings = news_mod.audit_product_news_path()
    check("audit finds the now-anchored window in backend/main.py",
          any(f["file"] == "backend/main.py" for f in findings),
          str(findings))


def test_prompts_are_verbatim():
    print("\nPrompts come from the product")
    from evals import prompts as P
    src = open(P.BACKEND_MAIN, encoding="utf-8").read()
    for name, text in [("bull", P.BULL), ("bear", P.BEAR), ("regime", P.REGIME),
                       ("value", P.VALUE), ("judge", P.JUDGE)]:
        first = text.splitlines()[0]
        check(name + " prompt matches backend/main.py", first in src, first[:60])
    # The judge prompt used to say "You MUST issue ENTER verdicts" and "Lean
    # toward ENTER", and the bull was told to "default to ENTER with 65-85
    # confidence". A prescribed confidence band makes the field constant across
    # stocks, which destroys the only signal the debate contributes to ranking.
    for phrase in ("Lean toward ENTER", "MUST issue ENTER"):
        check("judge prompt no longer prescribes a verdict: " + phrase,
              phrase not in P.JUDGE)
    check("bull prompt no longer prescribes a confidence band",
          "65-85 confidence" not in P.BULL)
    check("judge prompt asks for calibration",
          "CALIBRATION" in P.JUDGE.upper())


def test_cache_key_sensitivity():
    print("\nCache keying")
    from evals import cache
    base = dict(model="m", system="s", user="u", temperature=0.4, max_tokens=10, seed=1)
    k0 = cache.prompt_hash(**base)
    check("same inputs -> same key", k0 == cache.prompt_hash(**base))
    for field, val in [("seed", 2), ("system", "s2"), ("user", "u2"),
                       ("temperature", 0.5), ("model", "m2"), ("max_tokens", 11)]:
        alt = dict(base)
        alt[field] = val
        check("changing " + field + " changes the key", cache.prompt_hash(**alt) != k0)


def test_scoring_matches_product_shape():
    print("\nAs-of scoring")
    from evals.asof import score_as_of
    row = score_as_of("MSFT", C.AS_OF_DATES[0])
    for k in ("rocket_score", "technical_score", "volume_score", "quality_score",
              "macro_score", "technical_details", "volume_details"):
        check("score row has " + k, k in row)
    check("quality neutralised to 50", row["quality_score"] == 50.0,
          str(row["quality_score"]))
    check("rocket score in range", 0 <= row["rocket_score"] <= 100,
          str(row["rocket_score"]))


def test_context_identical_except_news():
    print("\nContext parity across arms")
    from evals import context as ctx
    with_news, _ = ctx.build("MSFT", C.AS_OF_DATES[0], 1, 50, include_news=True)
    no_news, _ = ctx.build("MSFT", C.AS_OF_DATES[0], 1, 50, include_news=False)
    head_w = with_news.split("RECENT NEWS:")[0]
    head_n = no_news.split("RECENT NEWS:")[0]
    check("metrics half is byte-identical", head_w == head_n)
    check("no-news arm carries the sentinel", ctx.NO_NEWS_SENTINEL in no_news)


def test_fixture_integrity():
    print("\nFixture integrity")
    fx = load_eval_set()
    pairs = fx["pairs"]
    check("40-60 tickers", 40 <= fx["n_tickers"] <= 60, str(fx["n_tickers"]))
    check("3-4 as-of dates", 3 <= len(fx["as_of_dates"]) <= 4, str(len(fx["as_of_dates"])))
    check("every pair has both horizons",
          all("fwd_excess_1M" in p and "fwd_excess_3M" in p for p in pairs))
    check("sectors span at least 8", len(set(p["sector"] for p in pairs)) >= 8,
          str(len(set(p["sector"] for p in pairs))))
    check("no duplicate pairs",
          len({(p["ticker"], p["as_of_date"]) for p in pairs}) == len(pairs))

    # excess must equal raw minus benchmark, within rounding
    bm = fx["benchmark_forward_returns"]
    worst = 0.0
    for p in pairs:
        for h in ("1M", "3M"):
            b = bm[p["as_of_date"]][h]
            worst = max(worst, abs((p["fwd_ret_" + h] - b) - p["fwd_excess_" + h]))
    check("excess == raw - benchmark", worst < 1e-5, "max drift " + str(worst))

    # labels must be strictly forward-looking
    import pandas as pd
    for p in pairs[:20]:
        check_date = pd.Timestamp(p["as_of_session"]) <= pd.Timestamp(p["as_of_date"])
        if not check_date:
            check("as-of session precedes as-of date", False, p["ticker"])
            return
    check("as-of session precedes as-of date", True)


def main() -> int:
    neutralise_quality_score()
    print("RocketShip eval harness self-test")
    print("=" * 60)

    test_spearman_primitives()
    test_metrics_recover_known_signal()
    test_brier_scale()
    test_separation_rule()
    test_as_of_price_truncation()
    test_as_of_news_guard()
    test_product_news_audit_still_finds_the_leak()
    test_prompts_are_verbatim()
    test_cache_key_sensitivity()
    test_scoring_matches_product_shape()
    test_context_identical_except_news()
    test_fixture_integrity()

    print("\n" + "=" * 60)
    if FAILURES:
        print("FAILED (" + str(len(FAILURES)) + "): " + ", ".join(FAILURES))
        return 1
    print("All checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
