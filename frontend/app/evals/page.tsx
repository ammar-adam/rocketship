import Link from 'next/link';
import { PageShell } from '@/components/ui/PageShell';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Collapsible } from '@/components/ui/Collapsible';
import {
  AxisTicks,
  IntervalBar,
  SeparationChip,
  SeedDots,
  Stat,
} from '@/components/evals/Uncertainty';
import {
  arms,
  fmt,
  fmtPct,
  fmtUsd,
  Horizon,
  pairedDeltas,
  portfolio,
  runMeta,
  screen,
  separationOf,
} from '@/src/lib/evals';
import styles from './evals.module.css';

export const metadata = {
  title: 'Evaluation | RocketShip',
  description:
    'Does the multi-agent debate beat one LLM call? Measured against realised forward returns.',
};

const HEADLINE_KEYS = [
  'full_debate_vs_single_call',
  'full_debate_vs_rank_by_rocket_score',
  'full_debate_vs_random',
];

export default function EvalsPage() {
  const meta = runMeta();
  const armRows = arms();
  const deltas = pairedDeltas(HEADLINE_KEYS);
  const a = screen();
  const c = portfolio();

  // One shared domain across every forest row, so bar lengths are comparable
  // between rows rather than each being scaled to itself.
  const bounds = deltas.flatMap((d) => [d.interval.lo ?? 0, d.interval.hi ?? 0, 0]);
  const pad = (Math.max(...bounds) - Math.min(...bounds)) * 0.12 || 0.05;
  const domain: [number, number] = [Math.min(...bounds) - pad, Math.max(...bounds) + pad];

  const anySeparates = deltas.some((d) => separationOf(d.interval) === 'separated');

  return (
    <PageShell
      title="Does the debate beat one call?"
      subtitle="Three pipeline stages, measured against realised forward returns excess of SPY."
      actions={
        <Link href="/" className={styles.backLink}>
          Back to runs
        </Link>
      }
    >
      {/* ---- run metadata ------------------------------------------------ */}
      <div className={styles.meta}>
        <span>
          Pairs <b>{meta.pairs}</b>
        </span>
        <span>
          As-of dates <b>{meta.dates}</b>
        </span>
        <span>
          Seeds <b>{meta.seeds}</b>
        </span>
        <span>
          API calls <b>{meta.calls.toLocaleString()}</b>
        </span>
        <span>
          Cost <b>${meta.spend.toFixed(2)}</b>
        </span>
        <span>
          Model <b>{meta.model}</b>
        </span>
      </div>

      {/* ---- the finding ------------------------------------------------- */}
      <Card>
        <CardHeader>
          <CardTitle>The finding</CardTitle>
        </CardHeader>
        <CardContent>
          <p className={styles.lede}>
            {anySeparates
              ? 'At least one arm separates from its baseline. See the chart below.'
              : 'No arm separates from any other. The debate costs seven times what a single call costs and adds no measurable information beyond the deterministic score it is handed.'}
          </p>

          <div className={styles.forest}>
            {(['1M', '3M'] as Horizon[]).map((h) => (
              <div key={h} className={styles.forestGroup}>
                <h3 className={styles.groupTitle}>{h} horizon</h3>
                {deltas
                  .filter((d) => d.horizon === h)
                  .map((d) => (
                    <div key={d.key + h} className={styles.forestRow}>
                      <span className={styles.rowLabel}>{d.label}</span>
                      <IntervalBar interval={d.interval} domain={domain} />
                      <SeparationChip separation={separationOf(d.interval)} />
                    </div>
                  ))}
              </div>
            ))}
            <div className={styles.axisWrap}>
              <span className={styles.rowLabel} />
              <AxisTicks domain={domain} />
            </div>
          </div>

          <p className={styles.caption}>
            Paired differences in rank correlation with forward excess return. The
            same stocks, the same dates, and one bootstrap resample plan applied to
            both arms, so the interval is on the difference rather than on two
            separately estimated levels. Hatched intervals cross zero.
          </p>
        </CardContent>
      </Card>

      {/* ---- stage A ------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <span className={styles.stageMark}>Stage A</span>
          <CardTitle>Does the deterministic screen rank anything?</CardTitle>
        </CardHeader>
        <CardContent>
          <p className={styles.body}>
            RocketScore ranks the universe before any LLM runs. Running this first
            is deliberate: if the screen carries no signal, the debate is being
            asked to add value on top of noise. Costs nothing, so it is never
            constrained by budget: {a.nPairs} pairs over {a.nDates} as-of dates.
          </p>
          <SeparationChip separation="noise" />

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Score</th>
                  <th>1M rank correlation</th>
                  <th>3M rank correlation</th>
                </tr>
              </thead>
              <tbody>
                {Object.keys(a.horizons['1M'].spearman)
                  .filter((k) => k !== 'weighted_score_before_tags')
                  .map((k) => (
                    <tr key={k}>
                      <td>{k.replace('_score', '').replace(/_/g, ' ')}</td>
                      <td>
                        <Stat interval={a.horizons['1M'].spearman[k]} />
                      </td>
                      <td>
                        <Stat interval={a.horizons['3M'].spearman[k]} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <div className={styles.callout}>
            <span className={styles.calloutLabel}>The weights are not the weights</span>
            A component with no cross-sectional variance cannot move a ranking,
            whatever weight the config assigns it.
          </div>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Component</th>
                  <th>Advertised</th>
                  <th>Actual influence</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(a.varianceShare).map(([k, v]) => (
                  <tr key={k}>
                    <td>{k.replace('_score', '')}</td>
                    <td>{(v.advertised_weight * 100).toFixed(0)}%</td>
                    <td>
                      <b>{(v.share * 100).toFixed(1)}%</b>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className={styles.note}>
            The tag bonus moves rank correlation by{' '}
            <Stat interval={a.horizons['1M'].tag_bonus_delta} /> &mdash; a tight
            interval around zero, not an inconclusive one.
          </p>
        </CardContent>
      </Card>

      {/* ---- stage B ------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <span className={styles.stageMark}>Stage B</span>
          <CardTitle>Does the debate beat one call?</CardTitle>
        </CardHeader>
        <CardContent>
          <p className={styles.body}>
            The only stage that spends money. <code>RocketScore only</code> is free
            and is the baseline that matters: the debate is handed the RocketScore
            and its rank <em>inside its own context</em>, so if it cannot beat
            &ldquo;use the number you were given&rdquo;, the four extra calls are
            decoration.
          </p>

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Arm</th>
                  <th>1M corr.</th>
                  <th>Per seed</th>
                  <th>3M corr.</th>
                  <th>New info vs screen (3M)</th>
                  <th>Calls</th>
                  <th>$/decision</th>
                  <th>Latency</th>
                </tr>
              </thead>
              <tbody>
                {armRows.map((r) => {
                  const s = r.spearman['1M'];
                  const seedDomain: [number, number] = [
                    Math.min(s.min ?? 0, -0.05),
                    Math.max(s.max ?? 0, 0.05),
                  ];
                  return (
                    <tr key={r.arm}>
                      <td>
                        <span className={styles.armName}>{r.label}</span>
                        <span className={styles.armBlurb}>{r.blurb}</span>
                      </td>
                      <td>
                        <Stat spread={r.spearman['1M']} />
                      </td>
                      <td>
                        <SeedDots
                          values={
                            s.min !== null && s.n_seeds > 1
                              ? [s.min, s.mean ?? 0, s.max ?? 0]
                              : []
                          }
                          domain={seedDomain}
                        />
                      </td>
                      <td>
                        <Stat spread={r.spearman['3M']} />
                      </td>
                      <td>
                        <Stat interval={r.incremental['3M']} />
                      </td>
                      <td>{r.callsPerDecision.toFixed(0)}</td>
                      <td className={r.free ? styles.free : undefined}>
                        {r.free ? 'free' : fmtUsd(r.costPerDecision)}
                      </td>
                      <td>{r.latency.toFixed(1)}s</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className={styles.callout}>
            <span className={styles.calloutLabel}>The headline number</span>
            Residualise each arm&apos;s score on the RocketScore it was given, then
            correlate the residual with forward return. That isolates what the LLM
            knew that the screen did not. Every interval brackets zero.
          </div>

          <Collapsible title="Other metrics">
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Arm</th>
                    <th>Brier (3M)</th>
                    <th>Top-5 hit rate</th>
                    <th>Buy rate</th>
                    <th>Fallbacks</th>
                  </tr>
                </thead>
                <tbody>
                  {armRows.map((r) => (
                    <tr key={r.arm}>
                      <td>{r.label}</td>
                      <td>
                        <Stat spread={r.brier} format="ratio" />
                      </td>
                      <td>
                        {r.hitRate.mean === null
                          ? '--'
                          : `${(r.hitRate.mean * 100).toFixed(1)}%`}
                      </td>
                      <td>
                        {r.buyRate.mean === null
                          ? '--'
                          : `${(r.buyRate.mean * 100).toFixed(1)}%`}
                      </td>
                      <td>{r.fallbacks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={styles.note}>
              Always answering &ldquo;50%&rdquo; scores exactly 0.250 on Brier. Both
              LLM arms sit on that baseline; random scores 0.336, so the metric does
              discriminate.
            </p>
          </Collapsible>
        </CardContent>
      </Card>

      {/* ---- stage C ------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <span className={styles.stageMark}>Stage C</span>
          <CardTitle>Does the optimiser beat dividing by N?</CardTitle>
        </CardHeader>
        <CardContent>
          <p className={styles.body}>
            {c.basket}, covariance fitted only on data ending at the as-of date,
            evaluated on realised forward returns. The shipped backtest does none of
            that &mdash; it replays the same window the selection and the covariance
            both came from.
          </p>
          <SeparationChip separation="noise" />

          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Horizon</th>
                  <th>Optimiser</th>
                  <th>Equal weight</th>
                  <th>Difference</th>
                </tr>
              </thead>
              <tbody>
                {(['1M', '3M'] as Horizon[]).map((h) => (
                  <tr key={h}>
                    <td>{h}</td>
                    <td>
                      <Stat interval={c.horizons[h]?.optimizer} format="pct" />
                    </td>
                    <td>
                      <Stat interval={c.horizons[h]?.equal_weight} format="pct" />
                    </td>
                    <td>
                      <Stat
                        interval={c.horizons[h]?.optimizer_minus_equal}
                        format="pct"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.callout}>
            <span className={styles.calloutLabel}>The look-ahead premium</span>
            The product&apos;s own in-sample framing reports Sharpe{' '}
            <b>{fmt(c.lookahead?.optimizer?.in_sample_sharpe?.point, 2)}</b>. The
            honest forward Sharpe on identical weights is{' '}
            <b>{fmt(c.lookahead?.optimizer?.forward_sharpe?.point, 2)}</b>. The gap
            is what backtesting on your own selection window buys you.
          </div>

          <Collapsible title="Is the risk term doing anything?">
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>risk_lambda</th>
                    <th>Mean HHI</th>
                    <th>Max weight</th>
                    <th>Names at the 12% cap</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(c.lambdaSweep ?? {}).map(([lam, v]) => (
                    <tr key={lam}>
                      <td>{lam}</td>
                      <td>{v.mean_hhi.toFixed(4)}</td>
                      <td>{v.mean_max_weight.toFixed(4)}</td>
                      <td>{v.mean_n_at_cap.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={styles.note}>
              Max weight stays pinned at the cap from lambda 0 through 4. Equal
              weight over twelve names would be an HHI of 0.0833. At the shipped
              lambda of 1 the solution is a corner: max weight on the top scores
              until the caps bind.
            </p>
          </Collapsible>
        </CardContent>
      </Card>

      {/* ---- caveats ------------------------------------------------------ */}
      <Card>
        <CardHeader>
          <CardTitle>What would change my mind</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className={styles.notes}>
            <li>
              <b>Twelve as-of dates is still few.</b> Going from four dates to twelve
              flipped the sign of two separate estimates in this project, including
              the one that had looked closest to significant. A longer history is the
              highest-value next step.
            </li>
            <li>
              <b>The screen it builds on has no signal either.</b> The debate is being
              asked to add value on top of noise, over fifty mega-caps where edge is
              hard to find by construction.
            </li>
            <li>
              <b>Training-data contamination biases every arm upward</b>, not down.
              The model has seen outcomes for dates this recent. These are ceilings.
            </li>
            <li>
              <b>Fundamentals are not point-in-time</b>, so the quality component is
              pinned to neutral, removing a fifth of the score&apos;s nominal weight.
              Identical across arms, so comparisons hold; absolute scores do not match
              production.
            </li>
          </ul>
          <p className={styles.body}>
            The honest reading is not &ldquo;the debate is worthless&rdquo; but
            &ldquo;it is not measurably better, and the burden of proof was on
            it&rdquo;.
          </p>
        </CardContent>
      </Card>
    </PageShell>
  );
}
