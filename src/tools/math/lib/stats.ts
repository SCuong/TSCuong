export interface ParsedNumbers {
  values: number[];
  /** Tokens that could not be read as numbers (first 50). */
  ignored: string[];
  ignoredCount: number;
}

/**
 * Numbers may be separated by commas, semicolons, spaces, tabs or new lines.
 * Use a dot as the decimal separator. Scientific notation (1.5e3) is accepted.
 */
export function parseNumbers(text: string): ParsedNumbers {
  const values: number[] = [];
  const ignored: string[] = [];
  let ignoredCount = 0;
  for (const raw of text.split(/[\s,;]+/)) {
    const token = raw.trim().replace(/−/g, '-');
    if (!token) continue;
    if (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(token)) {
      const n = Number(token);
      if (Number.isFinite(n)) {
        values.push(n);
        continue;
      }
    }
    ignoredCount++;
    if (ignored.length < 50) ignored.push(raw.trim());
  }
  return { values, ignored, ignoredCount };
}

/** Neumaier (improved Kahan) summation. */
export function preciseSum(values: readonly number[]): number {
  let sum = 0;
  let c = 0;
  for (const v of values) {
    const t = sum + v;
    if (Math.abs(sum) >= Math.abs(v)) c += sum - t + v;
    else c += v - t + sum;
    sum = t;
  }
  return sum + c;
}

/**
 * Percentile with linear interpolation between closest ranks (R type 7,
 * Excel PERCENTILE.INC / QUARTILE.INC, NumPy default). `sorted` must be ascending.
 */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (p <= 0) return sorted[0];
  if (p >= 100) return sorted[sorted.length - 1];
  const h = (sorted.length - 1) * (p / 100);
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export interface Summary {
  count: number;
  sum: number;
  mean: number;
  median: number;
  modes: number[];
  modeFrequency: number;
  min: number;
  max: number;
  range: number;
  populationVariance: number;
  sampleVariance: number | null;
  populationStdDev: number;
  sampleStdDev: number | null;
  standardError: number | null;
  q1: number;
  q3: number;
  iqr: number;
  geometricMean: number | null;
  harmonicMean: number | null;
  skewness: number | null;
  coefficientOfVariation: number | null;
  sorted: number[];
}

export function summarize(values: readonly number[]): Summary | null {
  const n = values.length;
  if (n === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);

  // Welford's online algorithm for a numerically stable variance.
  let mean = 0;
  let m2 = 0;
  let k = 0;
  for (const x of values) {
    k++;
    const d = x - mean;
    mean += d / k;
    m2 += d * (x - mean);
  }
  const sum = preciseSum(values);
  const populationVariance = m2 / n;
  const sampleVariance = n > 1 ? m2 / (n - 1) : null;

  // Modes
  const freq = new Map<number, number>();
  let top = 0;
  for (const v of sorted) {
    const f = (freq.get(v) ?? 0) + 1;
    freq.set(v, f);
    if (f > top) top = f;
  }
  const modes = top > 1 ? [...freq].filter(([, f]) => f === top).map(([v]) => v) : [];

  const allPositive = sorted[0] > 0;
  const geometricMean = allPositive ? Math.exp(preciseSum(values.map(Math.log)) / n) : null;
  const harmonicMean = allPositive ? n / preciseSum(values.map((v) => 1 / v)) : null;

  let skewness: number | null = null;
  if (n >= 3 && m2 > 0) {
    const m3 = preciseSum(values.map((x) => (x - mean) ** 3)) / n;
    const g1 = m3 / (m2 / n) ** 1.5;
    skewness = (Math.sqrt(n * (n - 1)) / (n - 2)) * g1;
  }

  const q1 = percentile(sorted, 25);
  const q3 = percentile(sorted, 75);
  const sampleStdDev = sampleVariance === null ? null : Math.sqrt(sampleVariance);
  return {
    count: n,
    sum,
    mean: sum / n,
    median: percentile(sorted, 50),
    modes,
    modeFrequency: top,
    min: sorted[0],
    max: sorted[n - 1],
    range: sorted[n - 1] - sorted[0],
    populationVariance,
    sampleVariance,
    populationStdDev: Math.sqrt(populationVariance),
    sampleStdDev,
    standardError: sampleStdDev === null ? null : sampleStdDev / Math.sqrt(n),
    q1,
    q3,
    iqr: q3 - q1,
    geometricMean,
    harmonicMean,
    skewness,
    coefficientOfVariation: sampleStdDev !== null && mean !== 0 ? sampleStdDev / Math.abs(mean) : null,
    sorted,
  };
}

export interface Bin {
  from: number;
  to: number;
  count: number;
}

/** Bin count by Freedman–Diaconis, falling back to Sturges when the IQR is 0. Clamped to 1–30. */
export function suggestBinCount(sorted: readonly number[]): number {
  const n = sorted.length;
  if (n < 2) return 1;
  const range = sorted[n - 1] - sorted[0];
  if (range === 0) return 1;
  const iqr = percentile(sorted, 75) - percentile(sorted, 25);
  let bins: number;
  if (iqr > 0) {
    const width = (2 * iqr) / Math.cbrt(n);
    bins = Math.ceil(range / width);
  } else {
    bins = Math.ceil(Math.log2(n)) + 1;
  }
  return Math.max(1, Math.min(30, bins));
}

export function histogram(sorted: readonly number[], binCount = suggestBinCount(sorted)): Bin[] {
  const n = sorted.length;
  if (n === 0) return [];
  const min = sorted[0];
  const max = sorted[n - 1];
  if (min === max) return [{ from: min, to: max, count: n }];
  const width = (max - min) / binCount;
  const bins: Bin[] = Array.from({ length: binCount }, (_, i) => ({
    from: min + i * width,
    to: i === binCount - 1 ? max : min + (i + 1) * width,
    count: 0,
  }));
  for (const v of sorted) {
    const idx = Math.min(binCount - 1, Math.floor((v - min) / width));
    bins[idx].count++;
  }
  return bins;
}

/** Compact number formatting for statistics output. */
export function formatStat(value: number | null | undefined, significant = 10): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '-∞';
  if (Object.is(value, -0)) return '0';
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-6)) {
    const [m, e] = value.toExponential(significant - 1).split('e');
    return `${m.replace(/\.?0+$/, '')}e${e}`;
  }
  return String(Number(value.toPrecision(significant)));
}
