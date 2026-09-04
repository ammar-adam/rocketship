import Link from 'next/link';
import { getRuns } from '@/src/lib/runStore';
import { arms, fmt, headToHeadResult, rebuiltScreen, runMeta } from '@/src/lib/evals';
import styles from './home.module.css';

/**
 * The front door.
 *
 * It used to pitch "institutional-grade stock screening" above three identical
 * feature cards - a product claim this site's own evaluation contradicts on the
 * very next page. That is incoherent, and it also buries the most interesting
 * thing here.
 *
 * So the page leads with the finding instead. The evaluation is the work; the
 * pipeline is what was evaluated.
 */
export default async function WelcomePage() {
  const runs = await getRuns();
  const latestRun = runs[0];

  const meta = runMeta();
  const h2h = headToHeadResult();
  const r2 = rebuiltScreen();
  const armRows = arms();
  const debate = armRows.find((a) => a.arm === 'full_debate');
  const single = armRows.find((a) => a.arm === 'single_call');
  const multiple =
    debate && single && single.costPerDecision > 0
      ? (debate.costPerDecision / single.costPerDecision).toFixed(1)
      : '7.0';

  return (
    <div className={styles.page}>
      <div className={styles.container}>

        {/* ---- thesis ---------------------------------------------------- */}
        <header className={styles.hero}>
          <p className={styles.eyebrow}>Multi-agent LLM stock screener &middot; and its evaluation</p>
          <h1 className={styles.title}>
            Five agents argue about a stock.
            <br />
            <em>It does not help.</em>
          </h1>
          <p className={styles.standfirst}>
            RocketShip runs a bull, a bear, a regime and a value analyst over every
            candidate, then a judge decides. Measured against realised forward
            returns, that debate adds no information a single LLM call did not
            already have &mdash; and none that the deterministic score it was handed
            did not already have either.
          </p>

          <div className={styles.actions}>
            <Link className={styles.primary} href="/evals">
              Read the evaluation
            </Link>
            <Link className={styles.secondary} href="/setup">
              Run the pipeline
            </Link>
            {latestRun && (
              <Link className={styles.tertiary} href={`/run/${latestRun}`}>
                Latest run
              </Link>
            )}
          </div>
        </header>

        {/* ---- the three numbers that matter ----------------------------- */}
        <section className={styles.findings}>
          <article className={styles.finding}>
            <span className={styles.findingLabel}>The debate, versus one call</span>
            <span className={`${styles.findingValue} ${styles.null}`}>
              {fmt(
                armRows.find((a) => a.arm === 'full_debate')?.incremental['3M']?.point ?? null
              )}
            </span>
            <span className={styles.findingNote}>
              new information beyond the score it was given, over{' '}
              {meta.pairs} pairs. The interval contains zero. It costs{' '}
              {multiple}&times; a single call.
            </span>
          </article>

          <article className={styles.finding}>
            <span className={styles.findingLabel}>The screen, rebuilt</span>
            <span className={`${styles.findingValue} ${styles.positive}`}>
              {fmt(h2h.delta.point)}
            </span>
            <span className={styles.findingNote}>
              rank correlation gained over the shipped score, on{' '}
              {r2.nPairs.toLocaleString()} pairs. A paired difference that excludes
              zero &mdash; the one thing here that worked.
            </span>
          </article>

          <article className={styles.finding}>
            <span className={styles.findingLabel}>Cost of finding out</span>
            <span className={styles.findingValue}>${meta.spend.toFixed(2)}</span>
            <span className={styles.findingNote}>
              {meta.calls.toLocaleString()} API calls across {meta.dates} as-of
              dates. Every response cached by prompt hash, so reruns are free.
            </span>
          </article>
        </section>

        {/* ---- how it works, as a sequence ------------------------------- */}
        <section className={styles.pipeline}>
          <h2 className={styles.sectionTitle}>The pipeline under test</h2>
          <ol className={styles.steps}>
            <li className={styles.step}>
              <span className={styles.stepIndex}>01</span>
              <div>
                <h3 className={styles.stepName}>Screen</h3>
                <p className={styles.stepBody}>
                  A deterministic score ranks the universe on momentum, volume,
                  quality and sector alignment. No LLM involved.
                </p>
              </div>
            </li>
            <li className={styles.step}>
              <span className={styles.stepIndex}>02</span>
              <div>
                <h3 className={styles.stepName}>Debate</h3>
                <p className={styles.stepBody}>
                  Four analysts argue in parallel over the top candidates; a judge
                  reads their memos and the data, then returns a verdict and a
                  confidence.
                </p>
              </div>
            </li>
            <li className={styles.step}>
              <span className={styles.stepIndex}>03</span>
              <div>
                <h3 className={styles.stepName}>Construct</h3>
                <p className={styles.stepBody}>
                  Position limits force an 8&ndash;12 name book, then a convex
                  optimiser sets weights under sector and concentration caps.
                </p>
              </div>
            </li>
          </ol>
          <p className={styles.pipelineNote}>
            Each stage is evaluated separately against its own baseline, so the
            answer is not &ldquo;does it work&rdquo; but{' '}
            <em>which stage creates value, and which does not.</em>{' '}
            <Link href="/evals" className={styles.inlineLink}>
              See the stage attribution &rarr;
            </Link>
          </p>
        </section>

        <footer className={styles.footer}>
          <p>
            Labels are realised 1&ndash;month and 3&ndash;month total returns,
            excess of SPY. Intervals are cluster bootstraps resampling as-of dates,
            paired across arms. Not investment advice, and on this evidence not
            investment anything.
          </p>
        </footer>
      </div>
    </div>
  );
}
