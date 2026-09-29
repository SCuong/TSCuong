import type { Table } from './csv';

export type ColumnType = 'empty' | 'integer' | 'decimal' | 'boolean' | 'date' | 'text';

export interface ValueCount {
  value: string;
  count: number;
}

export interface ColumnStats {
  index: number;
  name: string;
  type: ColumnType;
  /** Share of non-empty values that match the inferred type (1 for a clean column). */
  typeConfidence: number;
  count: number;
  empty: number;
  filled: number;
  unique: number;
  top: ValueCount[];
  minLength: number;
  maxLength: number;
  numeric?: {
    min: number;
    max: number;
    sum: number;
    mean: number;
    median: number;
    stdDev: number;
  };
  dates?: { min: string; max: string };
  booleans?: { trueCount: number; falseCount: number };
}

const naturalOrder = new Intl.Collator(undefined, { numeric: true });
const INTEGER = /^[+-]?\d+$/;
const DECIMAL = /^[+-]?(\d+\.\d*|\.\d+|\d+)([eE][+-]?\d+)?$/;
const BOOLEAN = /^(true|false|yes|no)$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

function isDate(v: string): boolean {
  if (!ISO_DATE.test(v)) return false;
  const month = Number(v.slice(5, 7));
  const day = Number(v.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  return !Number.isNaN(Date.parse(v.length === 10 ? `${v}T00:00:00Z` : v.replace(' ', 'T')));
}

/** The most specific type a single trimmed, non-empty value fits. */
export function valueType(v: string): Exclude<ColumnType, 'empty'> {
  if (INTEGER.test(v)) return Number.isFinite(Number(v)) ? 'integer' : 'text';
  if (DECIMAL.test(v)) return Number.isFinite(Number(v)) ? 'decimal' : 'text';
  if (BOOLEAN.test(v)) return 'boolean';
  if (isDate(v)) return 'date';
  return 'text';
}

export function median(sorted: Float64Array | number[]): number {
  const n = sorted.length;
  if (!n) return NaN;
  const mid = n >> 1;
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface StatsOptions {
  /** Treat whitespace-only cells as empty (default true). */
  trim?: boolean;
  topN?: number;
}

/** Profile a single column. */
export function columnStats(table: Table, index: number, options: StatsOptions = {}): ColumnStats {
  const { trim = true, topN = 5 } = options;
  const counts = new Map<string, number>();
  const typeCounts = { integer: 0, decimal: 0, boolean: 0, date: 0, text: 0 };
  let empty = 0;
  let minLength = Infinity;
  let maxLength = 0;
  const values: string[] = [];
  for (const row of table.rows) {
    const raw = row[index] ?? '';
    const v = trim ? raw.trim() : raw;
    if (v === '') {
      empty++;
      continue;
    }
    values.push(v);
    counts.set(v, (counts.get(v) ?? 0) + 1);
    const len = [...v].length;
    if (len < minLength) minLength = len;
    if (len > maxLength) maxLength = len;
    typeCounts[valueType(v)]++;
  }
  const filled = values.length;
  const numericCount = typeCounts.integer + typeCounts.decimal;
  let type: ColumnType;
  let matching: number;
  if (!filled) {
    type = 'empty';
    matching = 0;
  } else if (typeCounts.integer === filled) {
    type = 'integer';
    matching = filled;
  } else if (numericCount === filled) {
    type = 'decimal';
    matching = filled;
  } else if (typeCounts.boolean === filled) {
    type = 'boolean';
    matching = filled;
  } else if (typeCounts.date === filled) {
    type = 'date';
    matching = filled;
  } else {
    // Mixed column: report text, but say how much of it looked like the dominant non-text type.
    type = 'text';
    matching = typeCounts.text;
  }

  const top = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || naturalOrder.compare(a[0], b[0]))
    .slice(0, topN)
    .map(([value, count]) => ({ value, count }));

  const stats: ColumnStats = {
    index,
    name: table.headers[index] ?? '',
    type,
    typeConfidence: filled ? matching / filled : 0,
    count: table.rows.length,
    empty,
    filled,
    unique: counts.size,
    top,
    minLength: filled ? minLength : 0,
    maxLength,
  };

  // Numeric summary for numeric columns, and for mostly-numeric text columns (ignoring non-numbers).
  if (numericCount > 0 && numericCount / filled >= 0.5 && (type === 'integer' || type === 'decimal' || type === 'text')) {
    const nums = new Float64Array(numericCount);
    let k = 0;
    let sum = 0;
    for (const v of values) {
      const n = Number(v);
      if (DECIMAL.test(v) && Number.isFinite(n)) {
        nums[k++] = n;
        sum += n;
      }
    }
    nums.sort();
    const mean = sum / numericCount;
    let sq = 0;
    for (let i = 0; i < numericCount; i++) sq += (nums[i] - mean) ** 2;
    stats.numeric = {
      min: nums[0],
      max: nums[numericCount - 1],
      sum,
      mean,
      median: median(nums),
      stdDev: numericCount > 1 ? Math.sqrt(sq / (numericCount - 1)) : 0,
    };
  }
  if (type === 'date') {
    let min = values[0];
    let max = values[0];
    let minT = Infinity;
    let maxT = -Infinity;
    for (const v of values) {
      const t = Date.parse(v.length === 10 ? `${v}T00:00:00Z` : v.replace(' ', 'T'));
      if (t < minT) {
        minT = t;
        min = v;
      }
      if (t > maxT) {
        maxT = t;
        max = v;
      }
    }
    stats.dates = { min, max };
  }
  if (type === 'boolean') {
    let trueCount = 0;
    for (const v of values) if (/^(true|yes)$/i.test(v)) trueCount++;
    stats.booleans = { trueCount, falseCount: filled - trueCount };
  }
  return stats;
}

export function tableStats(table: Table, options?: StatsOptions): ColumnStats[] {
  return table.headers.map((_, i) => columnStats(table, i, options));
}

export const TYPE_LABELS: Record<ColumnType, string> = {
  empty: 'Empty',
  integer: 'Integer',
  decimal: 'Decimal',
  boolean: 'Boolean',
  date: 'Date',
  text: 'Text',
};
