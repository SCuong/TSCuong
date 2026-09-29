import { describe, expect, it } from 'vitest';
import { SecureRandom, rejectionLimit, type Uint32Source } from './random';

/** A source that replays the given values (then repeats the last one). */
function replay(values: number[]): Uint32Source {
  let i = 0;
  return (target) => {
    for (let j = 0; j < target.length; j++) target[j] = values[Math.min(i++, values.length - 1)];
  };
}

describe('rejectionLimit', () => {
  it('is the largest multiple of n that fits in 2^32', () => {
    expect(rejectionLimit(1)).toBe(2 ** 32);
    expect(rejectionLimit(2)).toBe(2 ** 32);
    expect(rejectionLimit(3)).toBe(2 ** 32 - 1);
    expect(rejectionLimit(10)).toBe(4294967290);
    expect(rejectionLimit(2 ** 31 + 1)).toBe(2 ** 31 + 1);
    expect(rejectionLimit(2 ** 32)).toBe(2 ** 32);
    for (const n of [3, 7, 26, 62, 94, 1296, 1_000_003]) {
      const limit = rejectionLimit(n);
      expect(limit % n).toBe(0);
      expect(2 ** 32 - limit).toBeLessThan(n);
    }
  });

  it('rejects invalid ranges', () => {
    expect(() => rejectionLimit(0)).toThrow(RangeError);
    expect(() => rejectionLimit(1.5)).toThrow(RangeError);
    expect(() => rejectionLimit(2 ** 32 + 1)).toThrow(RangeError);
  });
});

describe('SecureRandom.below', () => {
  it('accepts values just under the limit and rejects the limit itself', () => {
    const n = 10;
    const limit = rejectionLimit(n); // 4294967290
    const rng = new SecureRandom(replay([limit, limit + 5, limit - 1]), 8);
    // limit and limit+5 are rejected (they would bias 0–5), limit-1 → 9.
    expect(rng.below(n)).toBe(9);
    expect(rng.drawn).toBe(3);
  });

  it('maps accepted values with modulo', () => {
    const rng = new SecureRandom(replay([0, 1, 2, 3, 4294967294]), 5);
    expect([rng.below(3), rng.below(3), rng.below(3), rng.below(3), rng.below(3)]).toEqual([0, 1, 2, 0, 2]);
  });

  it('never draws for n = 1 beyond the pool and returns 0', () => {
    const rng = new SecureRandom(replay([123]));
    expect(rng.below(1)).toBe(0);
  });

  it('gives up on a broken source instead of looping forever', () => {
    const rng = new SecureRandom(replay([0xffffffff]));
    expect(() => rng.below(3)).toThrow(/out-of-range/);
  });

  it('is close to uniform with the real crypto source', () => {
    const rng = new SecureRandom();
    const n = 7;
    const counts = new Array(n).fill(0);
    const samples = 70_000;
    for (let i = 0; i < samples; i++) counts[rng.below(n)]++;
    // Chi-square with 6 degrees of freedom: 30 is far beyond the 0.9999 quantile (~27.9).
    const expected = samples / n;
    const chi2 = counts.reduce((sum, c) => sum + (c - expected) ** 2 / expected, 0);
    expect(chi2).toBeLessThan(30);
    expect(Math.min(...counts)).toBeGreaterThan(0);
  });

  it('refills the pool across many draws and picks from arrays', () => {
    const rng = new SecureRandom(undefined, 4);
    const items = ['a', 'b', 'c'];
    for (let i = 0; i < 50; i++) expect(items).toContain(rng.pick(items));
    expect(rng.drawn).toBeGreaterThanOrEqual(50);
    expect(() => rng.pick([])).toThrow(RangeError);
  });
});
