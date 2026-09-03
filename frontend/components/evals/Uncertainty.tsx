import React from 'react';
import {
  fmt,
  fmtPct,
  Interval,
  SEPARATION_LABEL,
  Separation,
  separationOf,
  Spread,
} from '@/src/lib/evals';
import styles from './Uncertainty.module.css';

type Fmt = 'corr' | 'pct' | 'ratio';

function render(v: number | null | undefined, f: Fmt): string {
  if (f === 'pct') return fmtPct(v);
  if (f === 'ratio') return fmt(v, 2);
  return fmt(v, 3);
}

/**
 * A number and its spread. There is deliberately no `value` prop: it is not
 * possible to render a mean here without the uncertainty attached to it, which
 * is the single easiest way to overstate a result like this one.
 */
export function Stat({
  spread,
  interval,
  format = 'corr',
  density = 'cell',
}: {
  spread?: Spread | null;
  interval?: Interval | null;
  format?: Fmt;
  density?: 'inline' | 'cell' | 'full';
}) {
  if (interval) {
    if (interval.point === null) return <span className={styles.na}>--</span>;
    return (
      <span className={styles.stat}>
        <span className={styles.point}>{render(interval.point, format)}</span>
        {interval.lo !== null && (
          <span className={styles.bounds}>
            [{render(interval.lo, format)}, {render(interval.hi, format)}]
          </span>
        )}
      </span>
    );
  }

  if (!spread || spread.mean === null) return <span className={styles.na}>--</span>;

  return (
    <span className={styles.stat}>
      <span className={styles.point}>{render(spread.mean, format)}</span>
      {spread.n_seeds > 1 && (
        <span className={styles.bounds}>
          &plusmn;{render(spread.sd, format).replace('+', '')}
          {density === 'full' && spread.min !== null && (
            <> [{render(spread.min, format)}, {render(spread.max, format)}] n={spread.n_seeds}</>
          )}
        </span>
      )}
    </span>
  );
}

export function SeparationChip({ separation }: { separation: Separation }) {
  return (
    <span className={`${styles.chip} ${styles[separation]}`}>
      <span className={styles.chipDot} aria-hidden="true" />
      {SEPARATION_LABEL[separation]}
    </span>
  );
}

/**
 * One row of a forest plot: a zero-anchored interval with whisker caps.
 *
 * An interval that crosses zero is hatched as well as greyed, so "inside the
 * noise" survives greyscale, a screenshot, and a colour-blind reader. Given
 * these results, nearly every row is hatched, and that is the finding.
 */
export function IntervalBar({
  interval,
  domain,
  format = 'corr',
}: {
  interval: Interval;
  domain: [number, number];
  format?: Fmt;
}) {
  const sep = separationOf(interval);
  const [lo, hi] = domain;
  const span = hi - lo || 1;
  const pos = (v: number) => ((v - lo) / span) * 100;

  if (interval.point === null || interval.lo === null || interval.hi === null) {
    return <div className={styles.barRow} />;
  }

  const left = pos(interval.lo);
  const right = pos(interval.hi);
  const width = Math.max(right - left, 0.4);

  return (
    <div className={styles.barRow}>
      <div className={styles.barTrack}>
        <div className={styles.zeroRule} style={{ left: `${pos(0)}%` }} aria-hidden="true" />
        <div
          className={`${styles.band} ${sep === 'separated' ? styles.bandSep : styles.bandNoise}`}
          style={{ left: `${left}%`, width: `${width}%` }}
        />
        <div
          className={`${styles.whisker} ${sep === 'separated' ? styles.sepStroke : styles.noiseStroke}`}
          style={{ left: `${left}%`, width: `${width}%` }}
        >
          <span className={styles.cap} style={{ left: 0 }} />
          <span className={styles.cap} style={{ left: '100%' }} />
        </div>
        <div
          className={`${styles.dot} ${sep === 'separated' ? styles.dotSep : styles.dotNoise}`}
          style={{ left: `${pos(interval.point)}%` }}
        />
      </div>
      <div className={styles.barValue}>
        <Stat interval={interval} format={format} />
      </div>
    </div>
  );
}

/**
 * Per-seed dot plot. Three dots from one arm scattered across the same span as
 * three from another is self-evidently not a result, in a way that
 * "+0.031 vs +0.019" is not.
 */
export function SeedDots({
  values,
  domain,
}: {
  values: number[];
  domain: [number, number];
}) {
  const [lo, hi] = domain;
  const span = hi - lo || 1;
  if (!values.length) return null;
  return (
    <div className={styles.seedStrip} title={values.map((v) => fmt(v, 3)).join('  ')}>
      <div className={styles.seedAxis} aria-hidden="true" />
      {values.map((v, i) => (
        <span
          key={i}
          className={styles.seedDot}
          style={{ left: `${((v - lo) / span) * 100}%` }}
        />
      ))}
    </div>
  );
}

export function AxisTicks({ domain, format = 'corr' }: { domain: [number, number]; format?: Fmt }) {
  const [lo, hi] = domain;
  const ticks = [lo, lo + (hi - lo) / 2, hi];
  return (
    <div className={styles.axis}>
      {ticks.map((t, i) => (
        <span
          key={i}
          className={styles.tick}
          style={{ left: `${((t - lo) / (hi - lo || 1)) * 100}%` }}
        >
          {render(t, format)}
        </span>
      ))}
    </div>
  );
}
