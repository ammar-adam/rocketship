import Link from 'next/link';
import { getRuns } from '@/src/lib/runStore';
import styles from './home.module.css';

export default function WelcomePage() {
  const runs = getRuns();
  const latestRun = runs[0];

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.hero}>
          <h1 className={styles.title}>RocketShip</h1>
          <p className={styles.subtitle}>
            Quant-first stock discovery with institutional-grade debate and portfolio construction.
          </p>
          <div className={styles.actions}>
            <Link className={styles.primary} href="/setup">Start</Link>
            {latestRun && (
              <Link className={styles.secondary} href={`/run/${latestRun}`}>
                View Latest Run
              </Link>
            )}
          </div>
        </div>

        <div className={styles.grid}>
          <div className={styles.card}>
            <h3>RocketScore</h3>
            <p>Rank the universe by technical momentum, volume flow, quality, and macro alignment.</p>
          </div>
          <div className={styles.card}>
            <h3>Debate Engine</h3>
            <p>Senior-analyst style memos with explicit evidence and cross-examination.</p>
          </div>
          <div className={styles.card}>
            <h3>Optimization</h3>
            <p>Convex portfolio optimization with risk and sector constraints.</p>
          </div>
        </div>

        <p className={styles.disclaimer}>
          For research purposes only. Not investment advice.
        </p>
      </div>
    </div>
  );
}
