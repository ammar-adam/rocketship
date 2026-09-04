import React from 'react';
import { ArmRow, Horizon, separationOf } from '@/src/lib/evals';
import styles from './CostEffect.module.css';

/**
 * Effect against cost, one row per arm.
 *
 * Cost sits next to effect deliberately. An arm that costs seven times more for
 * an interval straddling zero is the whole story, and it should be readable in
 * one glance rather than reconstructed from two tables. The cost bars are on a
 * shared linear scale so the multiple is a length you can see.
 */
export function CostEffect({
  arms,
  horizon = '3M',
}: {
  arms: ArmRow[];
  horizon?: Horizon;
}) {
  const maxCost = Math.max(...arms.map((a) => a.costPerDecision), 1e-9);
  const cheapest = Math.min(
    ...arms.filter((a) => a.costPerDecision > 0).map((a) => a.costPerDecision)
  );

  return (
    <div className={styles.wrap}>
      <div className={`${styles.row} ${styles.head}`}>
        <span>Arm</span>
        <span>Cost per decision</span>
        <span className={styles.right}>New info beyond the screen</span>
      </div>

      {arms.map((a) => {
        const iv = a.incremental[horizon];
        const sep = separationOf(iv);
        const pct = a.costPerDecision > 0 ? (a.costPerDecision / maxCost) * 100 : 0;
        const multiple =
          a.costPerDecision > 0 && cheapest > 0 ? a.costPerDecision / cheapest : 0;

        return (
          <div key={a.arm} className={styles.row}>
            <span className={styles.name}>{a.label}</span>

            <span className={styles.costCell}>
              <span className={styles.barTrack}>
                <span
                  className={a.free ? styles.barFree : styles.bar}
                  style={{ width: `${Math.max(pct, a.free ? 0 : 1.5)}%` }}
                />
              </span>
              <span className={styles.costText}>
                {a.free ? 'free' : `$${a.costPerDecision.toFixed(5)}`}
                {multiple > 1.05 && (
                  <span className={styles.multiple}>{multiple.toFixed(1)}x</span>
                )}
              </span>
            </span>

            <span className={`${styles.effect} ${styles[sep]}`}>
              {iv?.point === null || iv === null || iv === undefined
                ? '--'
                : `${iv.point >= 0 ? '+' : ''}${iv.point.toFixed(3)}`}
              {iv?.lo !== null && iv?.lo !== undefined && (
                <span className={styles.ci}>
                  [{iv.lo >= 0 ? '+' : ''}
                  {iv.lo.toFixed(3)}, {iv.hi! >= 0 ? '+' : ''}
                  {iv.hi!.toFixed(3)}]
                </span>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
