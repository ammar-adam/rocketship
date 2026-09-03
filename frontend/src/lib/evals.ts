/**
 * Eval results: types, loaders, and the separation rule.
 *
 * The JSON is checked into src/fixtures/evals/ and imported at build time, so
 * the page works deployed without the eval service running. Regenerate with
 * `make eval` and copy the three files across.
 */
import stageAJson from '@/src/fixtures/evals/stage_a.json';
import stageCJson from '@/src/fixtures/evals/stage_c.json';
import summaryJson from '@/src/fixtures/evals/summary.json';

// The fixtures are generated, so their inferred literal types are both enormous
// and brittle. Widen once here rather than casting at every access site.
type Json = Record<string, unknown>;
const summary = summaryJson as unknown as Json;
const stageA = stageAJson as unknown as Json;
const stageC = stageCJson as unknown as Json;

/** A bootstrap interval. Never render the point estimate without the bounds. */
export interface Interval {
  point: number | null;
  lo: number | null;
  hi: number | null;
  n_dates?: number;
  per_date?: Record<string, number>;
  excludes_zero?: boolean;
}

/** Mean and spread across seeds. */
export interface Spread {
  mean: number | null;
  sd: number;
  min: number | null;
  max: number | null;
  n_seeds: number;
}

export type Horizon = '1M' | '3M';
export type Separation = 'separated' | 'noise' | 'insufficient';

/**
 * Ported from evals/metrics.py::separated, and deliberately strict: the ranges
 * must be disjoint, not merely different on average. With a handful of seeds
 * there is no honest parametric test, so the bar is "the worst run of the better
 * arm still beats the best run of the worse one".
 *
 * If this ever disagrees with the Python, the UI is claiming something the
 * report does not, and the section loses its credibility. Keep them identical.
 */
export function separatedSpread(a?: Spread, b?: Spread): boolean {
  if (!a || !b || a.min === null || b.min === null || a.max === null || b.max === null) {
    return false;
  }
  return a.min > b.max || b.min > a.max;
}

/** For an interval, "separated" means it excludes zero. */
export function separationOf(iv?: Interval | null): Separation {
  if (!iv || iv.point === null) return 'insufficient';
  if (iv.lo === null || iv.hi === null) return 'insufficient';
  return iv.lo > 0 || iv.hi < 0 ? 'separated' : 'noise';
}

export const SEPARATION_LABEL: Record<Separation, string> = {
  separated: 'separates',
  noise: 'inside the noise',
  insufficient: 'not enough data',
};

// ---------------------------------------------------------------------------
// formatting
// ---------------------------------------------------------------------------

export function fmt(v: number | null | undefined, digits = 3, signed = true): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '--';
  const s = v.toFixed(digits);
  return signed && v >= 0 ? `+${s}` : s;
}

export function fmtPct(v: number | null | undefined, digits = 2, signed = true): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '--';
  const s = (v * 100).toFixed(digits);
  return `${signed && v >= 0 ? '+' : ''}${s}%`;
}

export function fmtUsd(v: number | null | undefined, digits = 5): string {
  if (v === null || v === undefined) return '--';
  return `$${v.toFixed(digits)}`;
}

// ---------------------------------------------------------------------------
// shaped accessors
// ---------------------------------------------------------------------------

export interface ArmRow {
  arm: string;
  label: string;
  blurb: string;
  free: boolean;
  callsPerDecision: number;
  costPerDecision: number;
  latency: number;
  fallbacks: number;
  spearman: Record<Horizon, Spread>;
  incremental: Record<Horizon, Interval | null>;
  brier: Spread;
  hitRate: Spread;
  buyRate: Spread;
}

const ARM_META: Record<string, { label: string; blurb: string }> = {
  full_debate: {
    label: 'Full debate',
    blurb: 'Bull, bear, regime and value agents in parallel, then a judge. Five calls.',
  },
  single_call: {
    label: 'Single call',
    blurb: 'One call carrying the same four lenses and the same decision rule.',
  },
  rank_by_rocket_score: {
    label: 'RocketScore only',
    blurb: 'The deterministic screen, which the debate is handed inside its own context.',
  },
  random: {
    label: 'Random',
    blurb: 'Uniform random ranking. The noise floor, over eight seeds.',
  },
};

export function arms(): ArmRow[] {
  const src = (summary.arms ?? {}) as Record<string, unknown>;
  const ii = (summary.incremental_information ?? {}) as Record<
    string,
    Record<Horizon, { incremental: Interval }>
  >;

  return Object.entries(src).map(([arm, entry]) => {
    const e = entry as {
      cost: Record<string, number>;
      horizons: Record<Horizon, { aggregate: Record<string, Spread> }>;
    };
    const agg = (h: Horizon) => e.horizons[h].aggregate;
    const meta = ARM_META[arm] ?? { label: arm, blurb: '' };
    return {
      arm,
      label: meta.label,
      blurb: meta.blurb,
      free: e.cost.cost_per_decision_usd === 0,
      callsPerDecision: e.cost.calls_per_decision,
      costPerDecision: e.cost.cost_per_decision_usd,
      latency: e.cost.mean_latency_s,
      fallbacks: e.cost.fallbacks,
      spearman: { '1M': agg('1M').spearman, '3M': agg('3M').spearman },
      incremental: {
        '1M': ii[arm]?.['1M']?.incremental ?? null,
        '3M': ii[arm]?.['3M']?.incremental ?? null,
      },
      brier: agg('3M').brier,
      hitRate: agg('3M').hit_rate_top_n,
      buyRate: agg('3M').buy_rate,
    };
  });
}

export interface DeltaRow {
  key: string;
  label: string;
  horizon: Horizon;
  interval: Interval;
}

const DELTA_LABEL: Record<string, string> = {
  full_debate_vs_single_call: 'Debate vs one call',
  full_debate_vs_rank_by_rocket_score: 'Debate vs the screen',
  full_debate_vs_random: 'Debate vs random',
  rank_by_rocket_score_vs_single_call: 'Screen vs one call',
  random_vs_single_call: 'Random vs one call',
};

export function pairedDeltas(only?: string[]): DeltaRow[] {
  const pd = summary.paired_deltas as Record<Horizon, Record<string, Interval>>;
  const out: DeltaRow[] = [];
  (['1M', '3M'] as Horizon[]).forEach((h) => {
    Object.entries(pd?.[h] ?? {}).forEach(([key, interval]) => {
      if (only && !only.includes(key)) return;
      out.push({ key, label: DELTA_LABEL[key] ?? key, horizon: h, interval });
    });
  });
  return out;
}

export function runMeta() {
  const cfg = summary.config as {
    n_pairs: number;
    as_of_dates: string[];
    seeds: number;
    model: string;
  };
  const budget = (summary.budget ?? {}) as { spent_usd: number; calls: number };
  return {
    pairs: cfg.n_pairs,
    dates: cfg.as_of_dates.length,
    dateList: cfg.as_of_dates,
    seeds: cfg.seeds,
    model: cfg.model,
    spend: budget.spent_usd ?? 0,
    calls: budget.calls ?? 0,
    generatedAt: summary.generated_at as string,
  };
}

export function screen() {
  const h = stageA.horizons as Record<
    Horizon,
    {
      spearman: Record<string, Interval>;
      top_decile_excess: Interval;
      tag_bonus_delta: Interval;
      buckets: { bucket: number; label: string; n: number; mean_excess: number | null }[];
    }
  >;
  return {
    nPairs: stageA.n_pairs as number,
    nDates: stageA.n_dates as number,
    varianceShare: stageA.variance_share as Record<
      string,
      { weighted_sd: number; share: number; advertised_weight: number }
    >,
    horizons: h,
  };
}

export function portfolio() {
  return {
    basket: stageC.basket as string,
    nDates: stageC.n_dates as number,
    horizons: stageC.horizons as Record<Horizon, Record<string, Interval>>,
    lookahead: stageC.lookahead_premium as Record<
      string,
      { in_sample_sharpe: Interval; forward_sharpe: Interval; premium: Interval }
    >,
    lambdaSweep: stageC.lambda_sweep as Record<
      string,
      { mean_hhi: number; mean_max_weight: number; mean_n_at_cap: number }
    >,
  };
}
