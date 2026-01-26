import Link from 'next/link';
import { getRuns } from '@/src/lib/runStore';
import styles from './home.module.css';

export default async function WelcomePage() {
  const runs = getRuns();
  const latestRun = runs[0];

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.hero}>
          <div className={styles.badge}>AI-Powered Stock Discovery</div>
          <h1 className={styles.title}>RocketShip</h1>
          <p className={styles.subtitle}>
            Institutional-grade stock screening, multi-agent AI debate, and portfolio optimization in one pipeline.
          </p>
          <div className={styles.actions}>
            <Link className={styles.primary} href="/setup">
              <span>New Analysis</span>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M6 12L10 8L6 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Link>
            {latestRun && (
              <Link className={styles.secondary} href={`/run/${latestRun}`}>
                Continue Latest Run
              </Link>
            )}
          </div>
        </div>

        <div className={styles.grid}>
          <div className={styles.card}>
            <div className={styles.cardIcon}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
              </svg>
            </div>
            <h3>RocketScore</h3>
            <p>Quantitative scoring across technical momentum, volume flow, quality metrics, and macro alignment.</p>
          </div>
          <div className={styles.card}>
            <div className={styles.cardIcon}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <h3>Multi-Agent Debate</h3>
            <p>Bull, Bear, Regime, and Volume analysts debate each stock with evidence-backed reasoning.</p>
          </div>
          <div className={styles.card}>
            <div className={styles.cardIcon}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 20V10M12 20V4M6 20v-6"/>
              </svg>
            </div>
            <h3>Convex Optimization</h3>
            <p>CVXPY-powered portfolio construction with risk constraints, sector caps, and backtest analytics.</p>
          </div>
        </div>

        <div className={styles.stats}>
          <div className={styles.stat}>
            <span className={styles.statValue}>493</span>
            <span className={styles.statLabel}>S&P 500 Stocks</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>40</span>
            <span className={styles.statLabel}>Debated Per Run</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statValue}>5</span>
            <span className={styles.statLabel}>AI Agents</span>
          </div>
        </div>

        <p className={styles.disclaimer}>
          For research and educational purposes only. Not investment advice.
        </p>
      </div>
    </div>
  );
}
