import Link from 'next/link';
import { getRuns } from '@/src/lib/runStore';
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

  return (
    <div className={styles.page}>
      <div className={styles.container}>

        {/* ---- run it ---------------------------------------------------- */}
        <header className={styles.hero}>
          <p className={styles.eyebrow}>Multi-agent LLM equity screener</p>
          <h1 className={styles.title}>
            Point it at 500 stocks.
            <br />
            <em>See what it picks.</em>
          </h1>
          <p className={styles.standfirst}>
            A deterministic score ranks the universe, four analyst agents argue
            over the survivors, and a judge decides. You get every memo, every
            verdict and the portfolio it builds &mdash; then you can check whether
            any of it actually predicted anything.
          </p>

          <div className={styles.actions}>
            <Link className={styles.primary} href="/setup">
              Run the scanner
            </Link>
            {latestRun && (
              <Link className={styles.secondary} href={`/run/${latestRun}`}>
                Open the last run
              </Link>
            )}
            <Link className={styles.tertiary} href="/evals">
              Or build your own screen &rarr;
            </Link>
          </div>
        </header>

        {/* ---- what a run gives you --------------------------------------- */}
        <section className={styles.findings}>
          <article className={styles.finding}>
            <span className={styles.findingLabel}>Every argument, in full</span>
            <span className={styles.findingHeading}>Four analysts, one judge</span>
            <span className={styles.findingNote}>
              Bull, bear, regime and value each write a memo citing the actual
              metrics. The judge reads all four plus the underlying data, then
              returns a verdict, a confidence and what would change its mind.
            </span>
          </article>

          <article className={styles.finding}>
            <span className={styles.findingLabel}>A real portfolio</span>
            <span className={styles.findingHeading}>8&ndash;12 positions, weighted</span>
            <span className={styles.findingNote}>
              A convex optimiser sets sizes under sector and concentration caps,
              with the position limits and every promotion or drop recorded so
              you can see exactly why a name made it.
            </span>
          </article>

          <article className={styles.finding}>
            <span className={styles.findingLabel}>And a way to check it</span>
            <span className={styles.findingHeading}>19,051 stock-dates</span>
            <span className={styles.findingNote}>
              Every stage is scored against realised forward returns, so you can
              tell which part of the pipeline earns its place &mdash; and rebuild
              the screen yourself if it does not.
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
            Every stage is scored separately against realised returns, and the
            screen is yours to rebuild: drag the factor weights and watch the
            information coefficient move across 19,051 stock-dates.{' '}
            <Link href="/evals" className={styles.inlineLink}>
              Open the screen lab &rarr;
            </Link>
          </p>
        </section>

        <footer className={styles.footer}>
          <p>
            Labels are realised 1&ndash;month and 3&ndash;month total returns,
            excess of SPY. Intervals are cluster bootstraps resampling as-of
            dates. Research project, not investment advice.
          </p>
        </footer>
      </div>
    </div>
  );
}
