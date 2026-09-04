import React from 'react';
import { Interval, separationOf } from '@/src/lib/evals';
import styles from './StageChain.module.css';

export interface StageSummary {
  id: 'A' | 'B' | 'C';
  name: string;
  question: string;
  baseline: string;
  /** The headline effect for this stage, against its own baseline. */
  effect: Interval | null;
  /** How the effect should read: a correlation, or a return. */
  unit: 'corr' | 'pct';
  cost: string;
  note: string;
}

function render(v: number | null | undefined, unit: 'corr' | 'pct'): string {
  if (v === null || v === undefined) return '--';
  return unit === 'pct'
    ? `${v >= 0 ? '+' : ''}${(v * 100).toFixed(2)}%`
    : `${v >= 0 ? '+' : ''}${v.toFixed(3)}`;
}

/**
 * The pipeline, stage by stage, with each stage's verdict against its own
 * baseline.
 *
 * This is the question the whole suite exists to answer - not "is the product
 * good" but "which stage creates value" - and it was previously only legible by
 * reading three separate tables. Numbering the stages A/B/C is not decoration:
 * they are a genuine sequence, and each one's input is the previous one's
 * output.
 */
export function StageChain({ stages }: { stages: StageSummary[] }) {
  return (
    <ol className={styles.chain}>
      {stages.map((s, i) => {
        const sep = separationOf(s.effect);
        return (
          <li key={s.id} className={styles.stage}>
            {i > 0 && <span className={styles.connector} aria-hidden="true" />}
            <div className={`${styles.card} ${styles[sep]}`}>
              <div className={styles.top}>
                <span className={styles.mark}>Stage {s.id}</span>
                <span className={styles.cost}>{s.cost}</span>
              </div>
              <h3 className={styles.name}>{s.name}</h3>
              <p className={styles.question}>{s.question}</p>

              <div className={styles.effect}>
                <span className={styles.effectValue}>
                  {render(s.effect?.point, s.unit)}
                </span>
                {s.effect?.lo !== null && s.effect?.lo !== undefined && (
                  <span className={styles.effectCi}>
                    [{render(s.effect.lo, s.unit)}, {render(s.effect.hi, s.unit)}]
                  </span>
                )}
              </div>
              <span className={styles.baseline}>vs {s.baseline}</span>

              <div className={`${styles.verdict} ${styles[`v_${sep}`]}`}>
                {sep === 'separated' ? 'Adds value' : 'No measurable effect'}
              </div>
              <p className={styles.note}>{s.note}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
