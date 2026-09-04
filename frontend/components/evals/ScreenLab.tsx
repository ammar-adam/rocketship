'use client';

import React, { useMemo, useState } from 'react';
import {
  DATES,
  FACTOR_META,
  FACTORS,
  Horizon,
  PRESETS,
  defaultWeights,
  evaluate,
  presetToArray,
} from '@/src/lib/lab';
import styles from './ScreenLab.module.css';

const LABEL: Record<string, string> = {
  mom_12_1: '12-1 momentum',
  reversal_1m: '1-month reversal',
  vol_surge: 'Volume surge',
  idio_vol: 'Low volatility',
  trend: 'Trend slope',
  drawdown: 'Near 52-week high',
  liquidity: 'Illiquidity',
};

function pct(v: number | null, d = 2): string {
  if (v === null || Number.isNaN(v)) return '--';
  return `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`;
}
function num(v: number | null, d = 3): string {
  if (v === null || Number.isNaN(v)) return '--';
  return `${v >= 0 ? '+' : ''}${v.toFixed(d)}`;
}

/**
 * Build a screen, and find out immediately whether it ranks anything.
 *
 * The evaluation was previously a verdict with nothing a reader could do about
 * it. This is the same 19,051 stock-dates and the same statistics, but the
 * weights are yours. Everything recomputes on each frame, including the
 * confidence interval - which is deliberate, because the interval is what stops
 * a number you dragged into existence from reading as a discovery.
 */
export function ScreenLab() {
  const [weights, setWeights] = useState<number[]>(defaultWeights);
  const [horizon, setHorizon] = useState<Horizon>('3M');

  const result = useMemo(() => evaluate(weights, horizon), [weights, horizon]);

  const separates =
    result.icLo !== null && result.icHi !== null && (result.icLo > 0 || result.icHi < 0);

  const setOne = (i: number, v: number) =>
    setWeights((w) => {
      const next = [...w];
      next[i] = v;
      return next;
    });

  const maxDecile = Math.max(...result.deciles.map(Math.abs), 1e-9);
  const maxSpark = Math.max(...result.perDate.map((p) => Math.abs(p.ic)), 1e-9);

  return (
    <div className={styles.lab}>
      {/* ---- controls -------------------------------------------------- */}
      <div className={styles.controls}>
        <div className={styles.controlsHead}>
          <h3 className={styles.panelTitle}>Weights</h3>
          <div className={styles.horizon}>
            {(['1M', '3M'] as Horizon[]).map((h) => (
              <button
                key={h}
                type="button"
                className={h === horizon ? styles.hzOn : styles.hz}
                onClick={() => setHorizon(h)}
              >
                {h}
              </button>
            ))}
          </div>
        </div>

        {FACTORS.map((f, i) => (
          <div key={f} className={styles.slider}>
            <div className={styles.sliderTop}>
              <label htmlFor={`w-${f}`} className={styles.sliderLabel}>
                {LABEL[f] ?? f}
              </label>
              <output className={styles.sliderValue} htmlFor={`w-${f}`}>
                {weights[i] > 0 ? '+' : ''}
                {weights[i]}
              </output>
            </div>
            <input
              id={`w-${f}`}
              className={styles.range}
              type="range"
              min={-100}
              max={100}
              step={5}
              value={weights[i]}
              onChange={(e) => setOne(i, Number(e.target.value))}
              aria-describedby={`d-${f}`}
            />
            <p id={`d-${f}`} className={styles.sliderDesc}>
              {FACTOR_META[f]?.desc}
            </p>
          </div>
        ))}

        <div className={styles.presets}>
          <span className={styles.presetLabel}>Start from</span>
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              className={styles.preset}
              onClick={() => setWeights(presetToArray(p.weights))}
              title={p.note}
            >
              {p.name}
            </button>
          ))}
          <button
            type="button"
            className={styles.preset}
            onClick={() => setWeights(FACTORS.map(() => 0))}
          >
            Clear
          </button>
        </div>
      </div>

      {/* ---- readout ---------------------------------------------------- */}
      <div className={styles.readout}>
        <div className={styles.headline}>
          <span className={styles.headlineLabel}>Rank correlation with forward return</span>
          <span className={`${styles.headlineValue} ${separates ? styles.sep : styles.noise}`}>
            {num(result.ic)}
          </span>
          <span className={styles.headlineCi}>
            95% CI [{num(result.icLo)}, {num(result.icHi)}]
          </span>
          <span className={`${styles.verdict} ${separates ? styles.vSep : styles.vNoise}`}>
            {separates ? 'separates from zero' : 'inside the noise'}
          </span>
          <span className={styles.headlineMeta}>
            {result.nPairs.toLocaleString()} stock-dates &middot; {result.perDate.length} months
            &middot; recomputed live
          </span>
        </div>

        <div className={styles.block}>
          <h4 className={styles.blockTitle}>
            Mean forward return by score decile
            <span className={styles.blockNote}>
              top decile minus bottom: <strong>{pct(result.decileSpread)}</strong>
            </span>
          </h4>
          <div className={styles.deciles}>
            {result.deciles.map((v, i) => (
              <div key={i} className={styles.decileCol} title={`Decile ${i + 1}: ${pct(v)}`}>
                <div className={styles.decileTrack}>
                  <div
                    className={v >= 0 ? styles.decileUp : styles.decileDown}
                    style={{ height: `${(Math.abs(v) / maxDecile) * 100}%` }}
                  />
                </div>
                <span className={styles.decileTick}>{i + 1}</span>
              </div>
            ))}
          </div>
          <p className={styles.axisNote}>
            <span>1 = highest scored</span>
            <span>10 = lowest</span>
          </p>
        </div>

        <div className={styles.block}>
          <h4 className={styles.blockTitle}>
            Month by month
            <span className={styles.blockNote}>
              a signal that works only once is not a signal
            </span>
          </h4>
          <div className={styles.spark}>
            {result.perDate.map((p) => (
              <div
                key={p.date}
                className={styles.sparkCol}
                title={`${p.date}: ${num(p.ic)}`}
              >
                <div className={styles.sparkTrack}>
                  <div
                    className={p.ic >= 0 ? styles.sparkUp : styles.sparkDown}
                    style={{ height: `${(Math.abs(p.ic) / maxSpark) * 50}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <p className={styles.axisNote}>
            <span>{DATES[0]}</span>
            <span>{DATES[DATES.length - 1]}</span>
          </p>
        </div>

        <div className={styles.block}>
          <h4 className={styles.blockTitle}>
            What it would have bought
            <span className={styles.blockNote}>top 10 on {DATES[DATES.length - 1]}</span>
          </h4>
          <ol className={styles.picks}>
            {result.top.map((t) => (
              <li key={t.ticker} className={styles.pick}>
                <span className={styles.pickTicker}>{t.ticker}</span>
                <span
                  className={t.realised >= 0 ? styles.pickUp : styles.pickDown}
                  title="realised forward return, excess of SPY"
                >
                  {pct(t.realised)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
