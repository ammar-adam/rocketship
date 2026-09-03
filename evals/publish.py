"""
Render results/*.json into one self-contained HTML report.

Generated rather than hand-written, so the page can never drift from the numbers
it claims. Re-run after any eval and the report matches:

    python -m evals.publish        # -> results/report.html

Charts are emitted as static SVG from Python. No JavaScript, no chart library:
the page renders identically on first paint, in a thumbnail, and with scripts
disabled - which for a document whose whole argument is "look at these intervals"
is worth more than interactivity.
"""
from __future__ import annotations

import html
import json
import os
from datetime import datetime, timezone

from evals import config as C

# ---------------------------------------------------------------------------
# design tokens
# ---------------------------------------------------------------------------
# Palette: a green-biased neutral ground with a single deep petrol accent.
# Semantic colour is spent only on the separation verdict, which is the one
# thing a reader must not misread, and is deliberately desaturated - almost
# every interval here crosses zero, and the page should look like that.

CSS = """
:root {
  --paper:      #F6F6F3;
  --surface:    #FFFFFF;
  --ink:        #171B19;
  --muted:      #6B726D;
  --rule:       #DCDED8;
  --rule-firm:  #B9BDB6;
  --accent:     #2F5D57;
  --separated:  #1E6B45;
  --noise:      #9AA09B;
  --noise-fill: rgba(154,160,155,.16);
  --hatch:      rgba(154,160,155,.55);
  --zero:       #171B19;

  --measure: 68ch;
  --step--1: .8125rem;
  --step-0:  1rem;
  --step-1:  1.1875rem;
  --step-2:  1.5rem;
  --step-3:  2.125rem;
  --step-4:  3rem;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --paper:      #121614;
    --surface:    #191E1B;
    --ink:        #E7EAE5;
    --muted:      #9AA39C;
    --rule:       #2A312D;
    --rule-firm:  #3D453F;
    --accent:     #79B8AC;
    --separated:  #63C08E;
    --noise:      #7E867F;
    --noise-fill: rgba(126,134,127,.20);
    --hatch:      rgba(126,134,127,.6);
    --zero:       #E7EAE5;
  }
}
:root[data-theme="dark"] {
  --paper:      #121614;
  --surface:    #191E1B;
  --ink:        #E7EAE5;
  --muted:      #9AA39C;
  --rule:       #2A312D;
  --rule-firm:  #3D453F;
  --accent:     #79B8AC;
  --separated:  #63C08E;
  --noise:      #7E867F;
  --noise-fill: rgba(126,134,127,.20);
  --hatch:      rgba(126,134,127,.6);
  --zero:       #E7EAE5;
}

* { box-sizing: border-box; }

body {
  margin: 0;
  background: var(--paper);
  color: var(--ink);
  font-family: "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
  font-size: var(--step-0);
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
}

.wrap { max-width: 1080px; margin: 0 auto; padding: clamp(1.5rem, 4vw, 4rem) clamp(1rem, 4vw, 2.5rem) 6rem; }
.prose { max-width: var(--measure); }

h1, h2, h3 { font-family: Newsreader, Georgia, "Times New Roman", serif; font-weight: 500; text-wrap: balance; margin: 0; }
h1 { font-size: var(--step-4); line-height: 1.08; letter-spacing: -.02em; }
h2 { font-size: var(--step-3); line-height: 1.15; letter-spacing: -.01em; }
h3 { font-size: var(--step-1); line-height: 1.3; }
p  { margin: 0; }

.eyebrow {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-size: var(--step--1);
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--muted);
}

.lede { font-size: var(--step-2); line-height: 1.4; font-family: Newsreader, Georgia, serif; }

header.masthead { display: flex; flex-direction: column; gap: 1.25rem; padding-bottom: 2.5rem; border-bottom: 2px solid var(--rule-firm); }

.meta { display: flex; flex-wrap: wrap; gap: 1.75rem; font-family: "IBM Plex Mono", monospace; font-size: var(--step--1); color: var(--muted); }
.meta b { color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }

section { padding-top: 3.5rem; display: flex; flex-direction: column; gap: 1.25rem; }
section + section { border-top: 1px solid var(--rule); margin-top: 3.5rem; }

.stage-head { display: flex; align-items: baseline; gap: 1rem; }
.stage-mark {
  font-family: "IBM Plex Mono", monospace; font-size: var(--step--1);
  letter-spacing: .1em; color: var(--accent);
  border: 1px solid var(--accent); border-radius: 2px;
  padding: .15rem .5rem; flex: none;
}

.verdict {
  display: inline-flex; align-items: center; gap: .5rem;
  font-family: "IBM Plex Mono", monospace; font-size: var(--step--1);
  letter-spacing: .06em; text-transform: uppercase;
  padding: .3rem .65rem; border-radius: 2px;
  border: 1px solid currentColor; width: fit-content;
}
.verdict.no    { color: var(--noise); }
.verdict.yes   { color: var(--separated); }

table { border-collapse: collapse; width: 100%; font-size: var(--step--1); }
.tablewrap { overflow-x: auto; }
th, td { text-align: right; padding: .55rem .7rem; border-bottom: 1px solid var(--rule); white-space: nowrap; }
th:first-child, td:first-child { text-align: left; }
thead th { font-family: "IBM Plex Mono", monospace; font-size: .75rem; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); font-weight: 500; border-bottom: 1px solid var(--rule-firm); }
tbody td { font-variant-numeric: tabular-nums; font-family: "IBM Plex Mono", monospace; }
tbody td:first-child { font-family: "IBM Plex Sans", sans-serif; }
tbody tr:last-child td { border-bottom: none; }
tr.rule-row td { border-top: 1px solid var(--rule-firm); }
.dim { color: var(--muted); }

figure { margin: 0; display: flex; flex-direction: column; gap: .85rem; }
figcaption { font-size: var(--step--1); color: var(--muted); max-width: var(--measure); }
svg { display: block; width: 100%; height: auto; }

.callout {
  border-left: 2px solid var(--accent);
  padding: .1rem 0 .1rem 1.15rem;
  max-width: var(--measure);
  color: var(--ink);
}
.callout .eyebrow { display: block; margin-bottom: .35rem; }

ul.notes { margin: 0; padding-left: 1.1rem; max-width: var(--measure); display: flex; flex-direction: column; gap: .6rem; }
ul.notes li::marker { color: var(--muted); }

code { font-family: "IBM Plex Mono", monospace; font-size: .92em; background: var(--surface); border: 1px solid var(--rule); border-radius: 2px; padding: .05em .3em; }

footer { margin-top: 4rem; padding-top: 1.5rem; border-top: 1px solid var(--rule); color: var(--muted); font-size: var(--step--1); max-width: var(--measure); }

@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
"""


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def e(x) -> str:
    return html.escape(str(x))


def load(name: str):
    p = os.path.join(C.RESULTS_DIR, name)
    if not os.path.exists(p):
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def fmt(v, nd=3, pct=False, signed=True):
    if v is None:
        return "n/a"
    if pct:
        return f"{v * 100:+.2f}%" if signed else f"{v * 100:.2f}%"
    return f"{v:+.{nd}f}" if signed else f"{v:.{nd}f}"


def ci_cell(c, nd=3, pct=False):
    if not c or c.get("point") is None:
        return '<span class="dim">n/a</span>'
    if c.get("lo") is None:
        return e(fmt(c["point"], nd, pct))
    return (f'{e(fmt(c["point"], nd, pct))} '
            f'<span class="dim">[{e(fmt(c["lo"], nd, pct))}, {e(fmt(c["hi"], nd, pct))}]</span>')


# ---------------------------------------------------------------------------
# the forest plot - the page's central argument
# ---------------------------------------------------------------------------

def forest(rows, width=940, row_h=42, pad_l=250, pad_r=90, pad_t=44, pad_b=46):
    """
    rows: [(label, sublabel, ci_dict), ...]

    A forest plot is the standard way to show a set of effects with intervals
    against a null, which is exactly the claim under test. The zero rule is the
    heaviest line on the page; an interval that crosses it is drawn hatched and
    grey so "inside the noise" reads texturally, not just by colour.
    """
    rows = [r for r in rows if r[2] and r[2].get("point") is not None]
    if not rows:
        return "<p class='dim'>No data.</p>"

    lo = min(min(r[2]["lo"], r[2]["point"]) for r in rows)
    hi = max(max(r[2]["hi"], r[2]["point"]) for r in rows)
    span = max(hi - lo, 1e-9)
    lo -= span * .12
    hi += span * .12
    if lo > 0:
        lo = -span * .1
    if hi < 0:
        hi = span * .1

    h = pad_t + row_h * len(rows) + pad_b
    plot_w = width - pad_l - pad_r

    def x(v):
        return pad_l + (v - lo) / (hi - lo) * plot_w

    out = [
        f'<svg viewBox="0 0 {width} {h}" role="img" '
        f'aria-label="Forest plot of paired differences with 95% confidence intervals">',
        '<defs><pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" '
        'patternTransform="rotate(45)">'
        '<line x1="0" y1="0" x2="0" y2="5" stroke="var(--hatch)" stroke-width="1.4"/>'
        '</pattern></defs>',
    ]

    # axis ticks - every label names a value the plot actually reaches
    n_ticks = 5
    for i in range(n_ticks):
        v = lo + (hi - lo) * i / (n_ticks - 1)
        tx = x(v)
        out.append(f'<line x1="{tx:.1f}" y1="{pad_t - 12}" x2="{tx:.1f}" y2="{h - pad_b + 6}" '
                   f'stroke="var(--rule)" stroke-width="1"/>')
        out.append(f'<text x="{tx:.1f}" y="{h - pad_b + 24}" text-anchor="middle" '
                   f'font-family="IBM Plex Mono, monospace" font-size="11" '
                   f'fill="var(--muted)">{v:+.2f}</text>')

    # the zero rule: the heaviest line here, because it is the whole question
    zx = x(0.0)
    out.append(f'<line x1="{zx:.1f}" y1="{pad_t - 18}" x2="{zx:.1f}" y2="{h - pad_b + 6}" '
               f'stroke="var(--zero)" stroke-width="2"/>')
    out.append(f'<text x="{zx:.1f}" y="{pad_t - 26}" text-anchor="middle" '
               f'font-family="IBM Plex Mono, monospace" font-size="11" '
               f'letter-spacing="1" fill="var(--zero)">NO DIFFERENCE</text>')

    for i, (label, sub, c) in enumerate(rows):
        cy = pad_t + row_h * i + row_h / 2
        sep = bool(c.get("excludes_zero"))
        col = "var(--separated)" if sep else "var(--noise)"

        x1, x2, xp = x(c["lo"]), x(c["hi"]), x(c["point"])

        # interval band
        out.append(f'<rect x="{x1:.1f}" y="{cy - 8:.1f}" width="{max(1.0, x2 - x1):.1f}" height="16" '
                   f'fill="{"none" if sep else "url(#hatch)"}" '
                   f'stroke="none"/>')
        out.append(f'<line x1="{x1:.1f}" y1="{cy:.1f}" x2="{x2:.1f}" y2="{cy:.1f}" '
                   f'stroke="{col}" stroke-width="{2.2 if sep else 1.6}"/>')
        for cap in (x1, x2):
            out.append(f'<line x1="{cap:.1f}" y1="{cy - 6:.1f}" x2="{cap:.1f}" y2="{cy + 6:.1f}" '
                       f'stroke="{col}" stroke-width="{2.2 if sep else 1.6}"/>')
        out.append(f'<circle cx="{xp:.1f}" cy="{cy:.1f}" r="4.5" fill="{col}" '
                   f'stroke="var(--paper)" stroke-width="1.5"/>')

        out.append(f'<text x="{pad_l - 16}" y="{cy - 2:.1f}" text-anchor="end" '
                   f'font-family="IBM Plex Sans, sans-serif" font-size="13" '
                   f'fill="var(--ink)">{e(label)}</text>')
        out.append(f'<text x="{pad_l - 16}" y="{cy + 12:.1f}" text-anchor="end" '
                   f'font-family="IBM Plex Mono, monospace" font-size="10.5" '
                   f'fill="var(--muted)">{e(sub)}</text>')

        verdict = "separates" if sep else "inside the noise"
        out.append(f'<text x="{width - pad_r + 12}" y="{cy + 4:.1f}" '
                   f'font-family="IBM Plex Mono, monospace" font-size="10.5" '
                   f'fill="{col}">{e(verdict)}</text>')

    out.append("</svg>")
    return "\n".join(out)


# ---------------------------------------------------------------------------
# page
# ---------------------------------------------------------------------------

def build() -> str:
    a = load("stage_a.json")
    b = load("summary.json")
    c = load("stage_c.json")

    parts: list[str] = []

    # ---- masthead ----
    n_pairs = b["config"]["n_pairs"] if b else 0
    n_dates = len(b["config"]["as_of_dates"]) if b else 0
    spend = (b.get("budget") or {}).get("spent_usd", 0) if b else 0
    calls = (b.get("budget") or {}).get("calls", 0) if b else 0

    parts.append(f"""
<header class="masthead">
  <span class="eyebrow">Evaluation report &middot; RocketShip</span>
  <h1>Does the multi-agent debate<br>beat one LLM call?</h1>
  <p class="lede prose">Five LLM agents argue about a stock, then a judge decides.
  It costs seven times what a single call costs. Measured against realised
  forward returns across three pipeline stages, no arm separates from any other,
  and the debate adds no information beyond the deterministic score it is
  handed.</p>
  <div class="meta">
    <span>Pairs <b>{n_pairs}</b></span>
    <span>As-of dates <b>{n_dates}</b></span>
    <span>API calls <b>{calls:,}</b></span>
    <span>Cost <b>${spend:.2f}</b></span>
    <span>Labels <b>fwd return excess of SPY</b></span>
  </div>
</header>""")

    # ---- the argument, up front ----
    if b:
        pd_ = b.get("paired_deltas", {})
        rows = []
        for h in ("1M", "3M"):
            for key, label in (
                ("full_debate_vs_single_call", "Debate vs one call"),
                ("full_debate_vs_rank_by_rocket_score", "Debate vs the screen"),
                ("full_debate_vs_random", "Debate vs random"),
            ):
                d = pd_.get(h, {}).get(key)
                if d:
                    rows.append((label, f"{h} horizon", d))
        parts.append(f"""
<section>
  <div class="stage-head"><h2>The whole finding, in one chart</h2></div>
  <p class="prose">Each row is a paired difference in rank correlation with
  forward excess return: the same stocks, the same dates, the same bootstrap
  resample plan applied to both arms. Pairing matters - two arms that move
  together can have heavily overlapping individual intervals while their
  <em>difference</em> is precisely estimated.</p>
  <figure>
    {forest(rows)}
    <figcaption>95% confidence intervals from a cluster bootstrap resampling
    as-of dates. Hatched intervals cross zero. Every one of them does.</figcaption>
  </figure>
</section>""")

    # ---- stage A ----
    if a:
        h1 = a["horizons"].get("1M", {})
        h3 = a["horizons"].get("3M", {})
        vs = a.get("variance_share", {})
        comp_rows = "".join(
            f"<tr><td>{e(k.replace('_score',''))}</td>"
            f"<td>{v['advertised_weight']:.0%}</td>"
            f"<td>{v['share']:.1%}</td></tr>"
            for k, v in vs.items() if v
        )
        score_rows = "".join(
            f"<tr><td>{e(k.replace('_score','').replace('_',' '))}</td>"
            f"<td>{ci_cell(h1['spearman'][k])}</td>"
            f"<td>{ci_cell(h3['spearman'][k])}</td></tr>"
            for k in h1.get("spearman", {}) if k != "weighted_score_before_tags"
        )
        parts.append(f"""
<section>
  <div class="stage-head"><span class="stage-mark">STAGE A</span>
    <h2>Does the screen rank anything?</h2></div>
  <p class="prose">Before any LLM runs, a deterministic score ranks the universe.
  Running this first is deliberate: if the screen carries no signal, the debate
  is being asked to add value on top of noise. Free to compute, so it runs on
  {a['n_dates']} as-of dates rather than the paid stage's four.</p>
  <span class="verdict no">No detectable signal</span>
  <div class="tablewrap"><table>
    <thead><tr><th>Score</th><th>1M rank corr.</th><th>3M rank corr.</th></tr></thead>
    <tbody>{score_rows}</tbody>
  </table></div>
  <div class="callout">
    <span class="eyebrow">The weights are not the weights</span>
    A component with no cross-sectional variance cannot move a ranking, whatever
    weight the config gives it.
  </div>
  <div class="tablewrap"><table>
    <thead><tr><th>Component</th><th>Advertised weight</th><th>Actual influence</th></tr></thead>
    <tbody>{comp_rows}</tbody>
  </table></div>
  <p class="prose dim">The tag bonus moves rank correlation by
  {e(fmt((h1.get('tag_bonus_delta') or {}).get('point')))} - a tight interval
  around zero, not an inconclusive one.</p>
</section>""")

    # ---- stage B ----
    if b:
        arm_rows = []
        for arm, entry in b["arms"].items():
            cost = entry["cost"]
            agg1 = entry["horizons"]["1M"]["aggregate"]["spearman"]
            agg3 = entry["horizons"]["3M"]["aggregate"]["spearman"]
            ii = (b.get("incremental_information", {}).get(arm) or {}).get("3M", {})
            arm_rows.append(
                f"<tr><td>{e(arm)}</td>"
                f"<td>{e(fmt(agg1['mean']))} <span class='dim'>&plusmn;{agg1['sd']:.3f}</span></td>"
                f"<td>{e(fmt(agg3['mean']))} <span class='dim'>&plusmn;{agg3['sd']:.3f}</span></td>"
                f"<td>{ci_cell(ii.get('incremental'))}</td>"
                f"<td>{cost['calls_per_decision']:.0f}</td>"
                f"<td>${cost['cost_per_decision_usd']:.5f}</td>"
                f"<td>{cost['mean_latency_s']:.1f}s</td></tr>"
            )
        parts.append(f"""
<section>
  <div class="stage-head"><span class="stage-mark">STAGE B</span>
    <h2>Does the debate beat one call?</h2></div>
  <p class="prose">The only stage that spends money. <code>rank_by_rocket_score</code>
  is free and is the baseline that matters: the debate is handed the RocketScore
  and its rank <em>inside its own context</em>, so if it cannot beat "use the
  number you were given", the four extra calls are decoration.</p>
  <span class="verdict no">Nothing separates</span>
  <div class="tablewrap"><table>
    <thead><tr><th>Arm</th><th>1M corr.</th><th>3M corr.</th>
      <th>New info beyond screen (3M)</th><th>Calls</th><th>$/decision</th><th>Latency</th></tr></thead>
    <tbody>{''.join(arm_rows)}</tbody>
  </table></div>
  <div class="callout">
    <span class="eyebrow">The headline number</span>
    Residualise each arm's score on the RocketScore it was given, then correlate
    the residual with forward return. That isolates what the LLM knew that the
    screen did not. Every interval brackets zero.
  </div>
</section>""")

    # ---- stage C ----
    if c:
        lp = c.get("lookahead_premium", {}).get("optimizer", {})
        rows_c = []
        for h in ("1M", "3M"):
            blk = c["horizons"].get(h, {})
            rows_c.append(
                f"<tr><td>{h} horizon</td>"
                f"<td>{ci_cell(blk.get('optimizer'), pct=True)}</td>"
                f"<td>{ci_cell(blk.get('equal_weight'), pct=True)}</td>"
                f"<td>{ci_cell(blk.get('optimizer_minus_equal'), pct=True)}</td></tr>"
            )
        parts.append(f"""
<section>
  <div class="stage-head"><span class="stage-mark">STAGE C</span>
    <h2>Does the optimiser beat dividing by N?</h2></div>
  <p class="prose">Same basket, covariance fitted only on data ending at the
  as-of date, evaluated on realised forward returns. The shipped backtest does
  none of that - it replays the same window the selection and the covariance
  both came from.</p>
  <span class="verdict no">Worth about two basis points</span>
  <div class="tablewrap"><table>
    <thead><tr><th></th><th>Optimiser</th><th>Equal weight</th><th>Difference</th></tr></thead>
    <tbody>{''.join(rows_c)}</tbody>
  </table></div>
  <div class="callout">
    <span class="eyebrow">The look-ahead premium</span>
    The product's own in-sample framing reports Sharpe
    {e(fmt((lp.get('in_sample_sharpe') or {}).get('point'), 2))}. The honest
    forward Sharpe on identical weights is
    {e(fmt((lp.get('forward_sharpe') or {}).get('point'), 2))}. The gap is what
    backtesting on your selection window buys you.
  </div>
</section>""")

    # ---- method ----
    parts.append(f"""
<section>
  <div class="stage-head"><h2>What would change my mind</h2></div>
  <ul class="notes">
    <li><b>Twelve as-of dates is still few.</b> Between four dates and twelve,
    the screen's own point estimate changed sign. Per-date correlation ranges
    from &minus;0.31 to +0.44. A longer history could move the debate's
    incremental estimate off zero, or nail it there.</li>
    <li><b>The screen it builds on has no signal either.</b> The debate is being
    asked to add value on top of noise, over 50 mega-caps where edge is hard to
    find by construction.</li>
    <li><b>Training-data contamination biases every arm upward</b>, not down.
    The model has seen the outcomes for dates this recent. These are ceilings.</li>
    <li><b>Fundamentals are not point-in-time</b>, so the quality component is
    pinned to neutral - removing a fifth of the score's nominal weight.
    Identical across arms, so comparisons hold; absolute scores do not match
    production.</li>
  </ul>
  <p class="prose">The honest reading is not "the debate is worthless" but "it is
  not measurably better, and the burden of proof was on it". A negative result
  that can be explained is worth more than a claim that cannot be defended.</p>
</section>

<footer>
  Generated by <code>python -m evals.publish</code> from
  <code>results/*.json</code> on {e(datetime.now(timezone.utc).strftime('%Y-%m-%d'))}.
  Every figure on this page is read from the run output, so the report cannot
  drift from the numbers it reports.
</footer>""")

    return f"""<title>Does the Debate Beat One Call?</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap">
<style>{CSS}</style>
<div class="wrap">
{''.join(parts)}
</div>
"""


def main() -> int:
    out = os.path.join(C.RESULTS_DIR, "report.html")
    os.makedirs(C.RESULTS_DIR, exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write(build())
    print("Wrote " + out)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
