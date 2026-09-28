import { describe, expect, it } from 'vitest';
import {
  NANOID_URL_ALPHABET,
  checkAlphabet,
  collisionProbability,
  customAlphabet,
  formatBig,
  formatCompact,
  formatSeconds,
  generateNanoids,
  idsForProbability,
} from './nanoid';
import { symbols } from './random';

describe('nanoid generation', () => {
  it('uses only alphabet characters and the requested size', () => {
    const alpha = symbols('abc123');
    const ids = generateNanoids(alpha, 10, 500);
    for (const id of ids) {
      expect(id).toHaveLength(10);
      expect(id).toMatch(/^[abc123]+$/);
    }
  });

  it('default alphabet has 64 unique symbols', () => {
    const r = checkAlphabet(NANOID_URL_ALPHABET);
    expect(r.ok && r.symbols.length).toBe(64);
    const ids = generateNanoids(symbols(NANOID_URL_ALPHABET), 21, 200);
    expect(new Set(ids).size).toBe(200);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{21}$/);
  });

  it('supports emoji alphabets by code point', () => {
    const alpha = symbols('😀😎🎉🚀');
    const id = generateNanoids(alpha, 8, 1)[0];
    expect(Array.from(id)).toHaveLength(8);
  });

  it('rejects masked values past the alphabet end (no modulo bias)', () => {
    // Alphabet of 5 -> mask 7. Bytes 5,6,7 must be skipped.
    const bytes = [5, 6, 7, 0, 13, 4, 1];
    let i = 0;
    const gen = customAlphabet(symbols('abcde'), 4, (n) => Uint8Array.from({ length: n }, () => bytes[i++ % bytes.length]));
    // 0->a, 13&7=5 rejected, 4->e, 1->b, then wraps: 5,6,7 rejected, 0->a
    expect(gen()).toBe('aeba');
  });

  it('is roughly uniform for a non-power-of-two alphabet', () => {
    const alpha = symbols('0123456789');
    const counts = new Array(10).fill(0);
    for (const id of generateNanoids(alpha, 100, 200)) for (const ch of id) counts[Number(ch)]++;
    for (const c of counts) expect(Math.abs(c - 2000)).toBeLessThan(300);
  });
});

describe('checkAlphabet', () => {
  it('flags duplicates, too short and too long', () => {
    expect(checkAlphabet('aa').ok).toBe(false);
    expect(checkAlphabet('a').ok).toBe(false);
    const dup = checkAlphabet('abca');
    expect(!dup.ok && dup.error).toMatch(/"a"/);
    const long = Array.from({ length: 300 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join('');
    expect(checkAlphabet(long).ok).toBe(false);
  });
});

describe('collision math', () => {
  it('matches the known nanoid figure (21 chars, 64 symbols)', () => {
    // 126 bits -> ~1.31e18 ids for a 1% chance; nanoid's docs: "~149 billion years" at 1000 IDs/hour.
    const n = idsForProbability(64, 21, 0.01);
    expect(n).toBeGreaterThan(1.3e18);
    expect(n).toBeLessThan(1.32e18);
    const years = n / 1000 / (365.25 * 24);
    expect(years / 1e9).toBeCloseTo(149, 0);
  });

  it('agrees with the exact birthday problem for small spaces', () => {
    // 365 "days": 23 people -> ~50.7%.
    const p = collisionProbability(365, 1, 23);
    expect(p).toBeGreaterThan(0.49);
    expect(p).toBeLessThan(0.52);
    // Inverse: ids for 50% ≈ 22.5
    expect(idsForProbability(365, 1, 0.5)).toBeCloseTo(22.49, 1);
  });

  it('probability at the computed count is the target', () => {
    const n = idsForProbability(36, 8, 0.01);
    expect(collisionProbability(36, 8, n)).toBeCloseTo(0.01, 3);
    expect(collisionProbability(36, 8, 1)).toBe(0);
  });

  it('formats durations and big numbers', () => {
    expect(formatSeconds(0.2)).toBe('less than a second');
    expect(formatSeconds(90)).toBe('~1.5 minutes');
    expect(formatSeconds(3600)).toBe('~1 hour');
    expect(formatSeconds(3 * 86400)).toBe('~3 days');
    expect(formatSeconds(1e20)).toBe('~3.2 trillion years');
    expect(formatSeconds(149e9 * 365.25 * 86400)).toBe('~149 billion years');
    expect(formatSeconds(1e40)).toMatch(/× 10\^32 years/);
    expect(formatCompact(1.307e18)).toBe('1.3 quintillion');
    expect(formatCompact(4321)).toBe('4,321');
    expect(formatBig(1234567)).toBe('1,234,567');
    expect(formatBig(1.03e18)).toBe('1.03 × 10^18');
    expect(formatBig(9.999e20)).toBe('1.00 × 10^21');
  });
});
