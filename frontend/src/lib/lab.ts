/**
 * Client-side re-ranking of the whole factor panel.
 *
 * 19,051 stock-dates, 7 factors, 36 cross-sections. Recomputing a composite
 * score, ranking each date, and taking a rank correlation is roughly 130k
 * multiply-adds plus 36 sorts of ~530 elements - low single-digit milliseconds,
 * so it runs on every slider frame rather than behind a "recalculate" button.
 *
 * The bootstrap is cheap for the same reason: once you have 36 per-date
 * correlations, resampling DATES 2,000 times is 72k lookups. The interval
 * updates live too, which is the point - it is what stops someone reading a
 * number they dragged into existence as a discovery.
 */

import labJson from '@/src/fixtures/evals/lab.json';

interface LabPayload {
  nRows: number;
  factors: string[];
  factorMeta: Record<string, { sign: number; desc: string; why: string }>;
  dates: string[];
  dateOffsets: number[];
  tickers: string[];
  zScale: number;
  rScale: number;
  tickerIdx: string;
  z: string;
  fwd1M: string;
  fwd3M: string;
}

const raw = labJson as unknown as LabPayload;

function decode(b64: string): Uint8Array {
  const bin = typeof atob === 'function' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary');
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

const zBytes = decode(raw.z);
const Z = new Int8Array(zBytes.buffer, zBytes.byteOffset, zBytes.byteLength);

function int16(b64: string): Int16Array {
  const b = decode(b64);
  return new Int16Array(b.buffer, b.byteOffset, b.byteLength / 2);
}

const FWD_1M = int16(raw.fwd1M);
const FWD_3M = int16(raw.fwd3M);
const TICKER_IDX = int16(raw.tickerIdx);

export const FACTORS = raw.factors;
export const FACTOR_META = raw.factorMeta;
export const DATES = raw.dates;
export const TICKERS = raw.tickers;
export const N_ROWS = raw.nRows;
export const N_FACTORS = raw.factors.length;
const OFFSETS = raw.dateOffsets;
const Z_SCALE = raw.zScale;
const R_SCALE = raw.rScale;

export type Horizon = '1M' | '3M';

/** Average ranks, ties shared - the same convention the Python uses. */
function avgRanks(values: Float64Array, order: Int32Array, n: number, out: Float64Array) {
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && values[order[j + 1]] === values[order[i]]) j += 1;
    const shared = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) out[order[k]] = shared;
    i = j + 1;
  }
}

function pearson(a: Float64Array, b: Float64Array, n: number): number | null {
  if (n < 3) return null;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i += 1) {
    ma += a[i];
    mb += b[i];
  }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i += 1) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da === 0 || db === 0) return null;
  return num / Math.sqrt(da * db);
}

export interface LabResult {
  ic: number | null;
  icLo: number | null;
  icHi: number | null;
  perDate: { date: string; ic: number }[];
  decileSpread: number | null;
  deciles: number[];
  top: { ticker: string; score: number; realised: number }[];
  nPairs: number;
}

// Reusable scratch buffers. Allocating inside the drag handler would churn the
// GC on every frame.
const scoreBuf = new Float64Array(2048);
const labelBuf = new Float64Array(2048);
const rankA = new Float64Array(2048);
const rankB = new Float64Array(2048);
const orderBuf = new Int32Array(2048);

/**
 * Score every stock with the given factor weights and evaluate the ranking.
 *
 * `weights` is indexed to FACTORS. It is normalised so the result depends on
 * the SHAPE of the weighting, not its magnitude - doubling every slider is not
 * a different model, and the display should not imply it is.
 */
export function evaluate(
  weights: number[],
  horizon: Horizon = '3M',
  bootstrapReps = 1500
): LabResult {
  const fwd = horizon === '1M' ? FWD_1M : FWD_3M;

  let norm = 0;
  for (let f = 0; f < N_FACTORS; f += 1) norm += Math.abs(weights[f]);
  if (norm === 0) norm = 1;

  const perDate: { date: string; ic: number }[] = [];
  const decileTop: number[] = [];
  const decileBot: number[] = [];
  const decileSums = new Float64Array(10);
  const decileCounts = new Float64Array(10);
  let nPairs = 0;
  let top: LabResult['top'] = [];

  for (let d = 0; d < DATES.length; d += 1) {
    const lo = OFFSETS[d];
    const hi = OFFSETS[d + 1];
    const n = hi - lo;
    if (n < 10) continue;
    nPairs += n;

    for (let i = 0; i < n; i += 1) {
      const row = lo + i;
      let s = 0;
      const base = row * N_FACTORS;
      for (let f = 0; f < N_FACTORS; f += 1) {
        s += (weights[f] / norm) * (Z[base + f] / Z_SCALE);
      }
      scoreBuf[i] = s;
      labelBuf[i] = fwd[row] / R_SCALE;
      orderBuf[i] = i;
    }

    const ord = orderBuf.subarray(0, n);
    ord.sort((x, y) => scoreBuf[x] - scoreBuf[y]);
    avgRanks(scoreBuf, orderBuf, n, rankA);
    ord.sort((x, y) => labelBuf[x] - labelBuf[y]);
    avgRanks(labelBuf, orderBuf, n, rankB);

    const ic = pearson(
      rankA.subarray(0, n) as unknown as Float64Array,
      rankB.subarray(0, n) as unknown as Float64Array,
      n
    );
    if (ic !== null) perDate.push({ date: DATES[d], ic });

    // Deciles by score, mean realised return in each.
    ord.sort((x, y) => scoreBuf[y] - scoreBuf[x]); // descending
    const per = Math.max(1, Math.floor(n / 10));
    for (let k = 0; k < 10; k += 1) {
      let sum = 0;
      let cnt = 0;
      for (let i = k * per; i < Math.min((k + 1) * per, n); i += 1) {
        sum += labelBuf[ord[i]];
        cnt += 1;
      }
      if (cnt) {
        decileSums[k] += sum / cnt;
        decileCounts[k] += 1;
      }
    }
    let tSum = 0;
    let bSum = 0;
    for (let i = 0; i < per; i += 1) tSum += labelBuf[ord[i]];
    for (let i = n - per; i < n; i += 1) bSum += labelBuf[ord[i]];
    decileTop.push(tSum / per);
    decileBot.push(bSum / per);

    // The most recent cross-section supplies the visible picks.
    if (d === DATES.length - 1) {
      top = [];
      for (let i = 0; i < Math.min(10, n); i += 1) {
        const idx = ord[i];
        top.push({
          ticker: TICKERS[TICKER_IDX[lo + idx]],
          score: scoreBuf[idx],
          realised: labelBuf[idx],
        });
      }
    }
  }

  const ics = perDate.map((p) => p.ic);
  const mean = ics.length ? ics.reduce((a, b) => a + b, 0) / ics.length : null;

  // Cluster bootstrap over DATES, matching the Python. Deterministic seed so
  // the interval does not shimmer while a slider is held still.
  let icLo: number | null = null;
  let icHi: number | null = null;
  if (ics.length >= 3) {
    let seed = 12345;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const reps: number[] = [];
    for (let b = 0; b < bootstrapReps; b += 1) {
      let s = 0;
      for (let i = 0; i < ics.length; i += 1) s += ics[(rand() * ics.length) | 0];
      reps.push(s / ics.length);
    }
    reps.sort((a, b) => a - b);
    icLo = reps[Math.floor(0.025 * reps.length)];
    icHi = reps[Math.min(reps.length - 1, Math.floor(0.975 * reps.length))];
  }

  const spread =
    decileTop.length
      ? decileTop.reduce((a, b) => a + b, 0) / decileTop.length -
        decileBot.reduce((a, b) => a + b, 0) / decileBot.length
      : null;

  const deciles: number[] = [];
  for (let k = 0; k < 10; k += 1) {
    deciles.push(decileCounts[k] ? decileSums[k] / decileCounts[k] : 0);
  }

  return { ic: mean, icLo, icHi, perDate, decileSpread: spread, deciles, top, nPairs };
}

/**
 * Named starting points. These are the argument the lab is making: the shipped
 * score, the thing that actually worked, and the tempting-but-worse middle.
 */
export const PRESETS: { name: string; note: string; weights: Record<string, number> }[] = [
  {
    name: 'Momentum only',
    note: 'One factor. The best result in the whole project.',
    weights: { mom_12_1: 100 },
  },
  {
    name: 'Equal weight, all seven',
    note: 'The obvious thing to try. It dilutes the one signal that works.',
    weights: Object.fromEntries(FACTORS.map((f) => [f, 100])),
  },
  {
    name: "RocketScore's shape",
    note: 'Approximates the shipped 45/25/20/10 using the factors it leans on.',
    weights: { mom_12_1: 20, trend: 45, vol_surge: 25, drawdown: 10 },
  },
  {
    name: 'Contrarian',
    note: 'Flip momentum. Watch the correlation invert.',
    weights: { mom_12_1: -100 },
  },
];

export function defaultWeights(): number[] {
  return FACTORS.map((f) => (f === 'mom_12_1' ? 100 : 0));
}

export function presetToArray(p: Record<string, number>): number[] {
  return FACTORS.map((f) => p[f] ?? 0);
}
