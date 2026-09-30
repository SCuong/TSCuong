import { describe, expect, it } from 'vitest';
import { formatStat, histogram, parseNumbers, percentile, preciseSum, suggestBinCount, summarize } from './stats';

describe('parseNumbers', () => {
  it('accepts many separators and reports ignored tokens', () => {
    const r = parseNumbers('1, 2;3\t4\n5  -6.5 +7 .5 1e3 abc 12px −2');
    expect(r.values).toEqual([1, 2, 3, 4, 5, -6.5, 7, 0.5, 1000, -2]);
    expect(r.ignored).toEqual(['abc', '12px']);
    expect(r.ignoredCount).toBe(2);
  });
  it('handles empty and emoji input', () => {
    expect(parseNumbers('   ').values).toEqual([]);
    expect(parseNumbers('😀 3').values).toEqual([3]);
    expect(parseNumbers('1e999').ignoredCount).toBe(1);
  });
});

describe('summarize', () => {
  it('matches reference values', () => {
    // Values checked against R / NumPy.
    const s = summarize([2, 4, 4, 4, 5, 5, 7, 9])!;
    expect(s.count).toBe(8);
    expect(s.sum).toBe(40);
    expect(s.mean).toBe(5);
    expect(s.median).toBe(4.5);
    expect(s.modes).toEqual([4]);
    expect(s.modeFrequency).toBe(3);
    expect(s.populationVariance).toBeCloseTo(4, 12);
    expect(s.populationStdDev).toBeCloseTo(2, 12);
    expect(s.sampleVariance).toBeCloseTo(32 / 7, 12);
    expect(s.sampleStdDev).toBeCloseTo(Math.sqrt(32 / 7), 12);
    expect(s.q1).toBe(4);
    expect(s.q3).toBe(5.5);
    expect(s.iqr).toBe(1.5);
    expect(s.range).toBe(7);
    expect(s.geometricMean).toBeCloseTo(4.6032, 4);
    expect(s.harmonicMean).toBeCloseTo(4.2018, 4);
    expect(s.skewness).toBeCloseTo(0.8185, 3);
  });

  it('handles single values and multi-modes', () => {
    const one = summarize([42])!;
    expect(one.mean).toBe(42);
    expect(one.median).toBe(42);
    expect(one.sampleVariance).toBeNull();
    expect(one.populationVariance).toBe(0);
    expect(one.modes).toEqual([]);
    expect(one.skewness).toBeNull();
    expect(summarize([1, 1, 2, 2, 3])!.modes).toEqual([1, 2]);
    expect(summarize([1, 2, 3])!.modes).toEqual([]);
    expect(summarize([])).toBeNull();
  });

  it('refuses geometric/harmonic means for non-positive data', () => {
    const s = summarize([-1, 2, 3])!;
    expect(s.geometricMean).toBeNull();
    expect(s.harmonicMean).toBeNull();
    expect(summarize([0, 1])!.geometricMean).toBeNull();
  });

  it('is numerically stable for large offsets', () => {
    const base = 1e9;
    const s = summarize([base + 4, base + 7, base + 13, base + 16])!;
    expect(s.sampleVariance).toBeCloseTo(30, 6);
    expect(preciseSum([1e16, 1, -1e16])).toBe(1);
    expect(summarize(Array(10).fill(0.1))!.sum).toBe(1);
  });

  it('handles large inputs', () => {
    const values = Array.from({ length: 200_000 }, (_, i) => i + 1);
    const s = summarize(values)!;
    expect(s.mean).toBe(100000.5);
    expect(s.median).toBe(100000.5);
  });
});

describe('percentile', () => {
  it('interpolates like Excel PERCENTILE.INC', () => {
    const sorted = [15, 20, 35, 40, 50];
    expect(percentile(sorted, 40)).toBe(29);
    expect(percentile(sorted, 0)).toBe(15);
    expect(percentile(sorted, 100)).toBe(50);
    expect(percentile(sorted, 90)).toBe(46);
    expect(percentile([], 50)).toBeNaN();
  });
});

describe('histogram', () => {
  it('bins all values', () => {
    const sorted = Array.from({ length: 100 }, (_, i) => i);
    const bins = histogram(sorted);
    expect(bins.reduce((a, b) => a + b.count, 0)).toBe(100);
    expect(bins[0].from).toBe(0);
    expect(bins.at(-1)!.to).toBe(99);
    expect(histogram([5, 5, 5])).toEqual([{ from: 5, to: 5, count: 3 }]);
    expect(histogram([])).toEqual([]);
    expect(suggestBinCount([1, 1, 1, 1, 2])).toBeGreaterThanOrEqual(1);
  });
});

describe('formatStat', () => {
  it('formats', () => {
    expect(formatStat(0.1 + 0.2)).toBe('0.3');
    expect(formatStat(null)).toBe('—');
    expect(formatStat(1e20)).toBe('1e+20');
  });

  it('keeps every integer digit', () => {
    // Regression: 12345678901 was shown as 12345678900 (rounded to 10 significant digits).
    expect(formatStat(12345678901)).toBe('12345678901');
    expect(formatStat(12345678901.5)).toBe('12345678901.5');
    expect(formatStat(-9876543210987)).toBe('-9876543210987');
    expect(formatStat(1234567.891234)).toBe('1234567.891');
  });
});

describe('summarize overflow', () => {
  it('reports the mean even when the sum overflows', () => {
    // Regression: Neumaier compensation turned an overflowing sum into NaN, so mean and sum showed "—".
    const s = summarize([1e308, 1e308])!;
    expect(s.sum).toBe(Infinity);
    expect(s.mean).toBe(1e308);
    expect(preciseSum([1e308, 1e308, -1e308])).toBe(Infinity);
  });
});
