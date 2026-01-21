'use client';

import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/Card';
import styles from './home.module.css';

export default function WelcomePage() {
  const router = useRouter();
  
  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.content}>
          <h1 className={styles.title}>RocketShip</h1>
          <p className={styles.subtitle}>
            Multi-agent stock discovery system for identifying high-momentum opportunities
          </p>
          
          <Card variant="elevated" padding="lg" className={styles.card}>
            <CardContent>
              <h2 className={styles.cardTitle}>How It Works</h2>
              
              <div className={styles.steps}>
                <div className={styles.step}>
                  <span className={styles.stepNumber}>1</span>
                  <div className={styles.stepContent}>
                    <h3>RocketScore</h3>
                    <p>Screen stocks using technical momentum, volume flow, quality metrics, and macro alignment</p>
                  </div>
                </div>
                
                <div className={styles.step}>
                  <span className={styles.stepNumber}>2</span>
                  <div className={styles.stepContent}>
                    <h3>Multi-Agent Debate</h3>
                    <p>Bull, Bear, Regime, and Volume agents analyze each candidate with a Judge making final verdicts</p>
                  </div>
                </div>
                
                <div className={styles.step}>
                  <span className={styles.stepNumber}>3</span>
                  <div className={styles.stepContent}>
                    <h3>Portfolio Optimization</h3>
                    <p>Construct a risk-managed portfolio of 8-25 positions using convex optimization</p>
                  </div>
                </div>
              </div>
              
              <div className={styles.methodology}>
                <h3>RocketScore Methodology</h3>
                <div className={styles.weights}>
                  <div className={styles.weight}>
                    <span className={styles.weightPct}>45%</span>
                    <span className={styles.weightName}>Technical</span>
                  </div>
                  <div className={styles.weight}>
                    <span className={styles.weightPct}>25%</span>
                    <span className={styles.weightName}>Volume</span>
                  </div>
                  <div className={styles.weight}>
                    <span className={styles.weightPct}>20%</span>
                    <span className={styles.weightName}>Quality</span>
                  </div>
                  <div className={styles.weight}>
                    <span className={styles.weightPct}>10%</span>
                    <span className={styles.weightName}>Macro</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          
          <button 
            className={styles.startButton}
            onClick={() => router.push('/setup')}
          >
            Get Started →
          </button>
          
          <p className={styles.disclaimer}>
            For research purposes only. Not financial advice.
          </p>
        </div>
      </div>
    </div>
  );
}
