import { describe, expect, it } from 'vitest';
import { RandomReader, cryptoBytes, entropyBits, randomFromAlphabet, shuffleInPlace, symbols } from './random';

/** Byte source that replays a fixed sequence. */
function replay(seq: number[]) {
  let i = 0;
  return (n: number) => Uint8Array.from({ length: n }, () => seq[i++ % seq.length]);
}

describe('cryptoBytes', () => {
  it('fills more than 64 KiB', () => {
    const b = cryptoBytes(200_000);
    expect(b.length).toBe(200_000);
    // The tail must be filled too (not all zeros).
    expect(b.subarray(150_000).some((x) => x !== 0)).toBe(true);
  });
});

describe('RandomReader.below', () => {
  it('rejects values in the biased tail', () => {
    // n = 3: limit = floor(2^32/3)*3 = 4294967295; 0xFFFFFFFF must be rejected.
    const r = new RandomReader(replay([0xff, 0xff, 0xff, 0xff, 0, 0, 0, 5]), 8);
    expect(r.below(3)).toBe(5 % 3);
  });

  it('handles ranges above 2^32', () => {
    const r = new RandomReader();
    for (let i = 0; i < 1000; i++) {
      const v = r.below(2 ** 40 + 7);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(2 ** 40 + 7);
    }
  });

  it('validates the range', () => {
    const r = new RandomReader();
    expect(() => r.below(0)).toThrow(RangeError);
    expect(() => r.below(1.5)).toThrow(RangeError);
    expect(() => r.below(2 ** 54)).toThrow(RangeError);
    expect(r.below(1)).toBe(0);
  });

  it('is uniform (chi-square) for a small non-power-of-two range', () => {
    const r = new RandomReader();
    const k = 6;
    const n = 60_000;
    const counts = new Array(k).fill(0);
    for (let i = 0; i < n; i++) counts[r.below(k)]++;
    const expected = n / k;
    const chi = counts.reduce((s, c) => s + (c - expected) ** 2 / expected, 0);
    // df = 5; p = 0.0001 critical value ≈ 25.7
    expect(chi).toBeLessThan(25.7);
  });

  it('intBetween covers both ends', () => {
    const r = new RandomReader();
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(r.intBetween(-2, 2));
    expect([...seen].sort()).toEqual([-1, -2, 0, 1, 2].sort());
  });

  it('float is in [0, 1)', () => {
    const r = new RandomReader();
    for (let i = 0; i < 1000; i++) {
      const f = r.float();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);
    }
  });
});

describe('randomFromAlphabet', () => {
  it('works for alphabets larger than 256 symbols', () => {
    const alpha = Array.from({ length: 300 }, (_, i) => String.fromCodePoint(0x4e00 + i));
    const s = randomFromAlphabet(alpha, 50, new RandomReader());
    expect(Array.from(s)).toHaveLength(50);
    for (const ch of s) expect(alpha).toContain(ch);
  });

  it('single-symbol alphabet repeats', () => {
    expect(randomFromAlphabet(['x'], 4, new RandomReader())).toBe('xxxx');
  });
});

describe('shuffleInPlace', () => {
  it('keeps all elements', () => {
    const a = Array.from({ length: 100 }, (_, i) => i);
    const s = shuffleInPlace(a.slice(), new RandomReader());
    expect(s.slice().sort((x, y) => x - y)).toEqual(a);
  });

  it('produces all 6 permutations of 3 items roughly evenly', () => {
    const r = new RandomReader();
    const counts = new Map<string, number>();
    for (let i = 0; i < 12_000; i++) {
      const key = shuffleInPlace([1, 2, 3], r).join('');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    for (const c of counts.values()) expect(Math.abs(c - 2000)).toBeLessThan(250);
  });
});

describe('helpers', () => {
  it('symbols keeps emoji together', () => {
    expect(symbols('a😀b')).toEqual(['a', '😀', 'b']);
  });
  it('entropyBits', () => {
    expect(entropyBits(64, 21)).toBe(126);
    expect(entropyBits(1, 10)).toBe(0);
  });
});
