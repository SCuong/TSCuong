import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PASSPHRASE_OPTIONS,
  DEFAULT_PASSWORD_OPTIONS,
  DEFAULT_SYMBOLS,
  LOOKALIKES,
  averageCrackTime,
  buildCharsets,
  countWithEverySet,
  generatePassphrase,
  generatePassword,
  log2BigInt,
  passphraseEntropyBits,
  passwordEntropyBits,
  rateEntropy,
  type PasswordOptions,
} from './generate';
import { SecureRandom } from './random';
import { EFF_SHORT_WORDS } from './effShortWords';

const opts = (over: Partial<PasswordOptions> = {}): PasswordOptions => ({ ...DEFAULT_PASSWORD_OPTIONS, ...over });

function charsets(over: Partial<PasswordOptions> = {}) {
  const r = buildCharsets(opts(over));
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe('buildCharsets', () => {
  it('builds the default 88-character alphabet', () => {
    const r = charsets();
    expect(r.sets.map((s) => s.chars.length)).toEqual([26, 26, 10, DEFAULT_SYMBOLS.length]);
    expect(r.alphabet).toHaveLength(62 + DEFAULT_SYMBOLS.length);
  });

  it('removes look-alikes, whitespace and duplicates', () => {
    const r = charsets({ excludeLookalikes: true, symbolSet: '!! |a1 €😀' });
    const all = r.alphabet.join('');
    for (const c of LOOKALIKES) expect(all).not.toContain(c);
    expect(r.sets.find((s) => s.id === 'symbols')!.chars).toEqual(['!', '€', '😀']);
    expect(new Set(r.alphabet).size).toBe(r.alphabet.length);
  });

  it('explains impossible settings', () => {
    const none = buildCharsets(opts({ upper: false, lower: false, digits: false, symbols: false }));
    expect(!none.ok && none.error).toMatch(/at least one character set/);
    const emptySymbols = buildCharsets(opts({ symbolSet: '  ' }));
    expect(!emptySymbols.ok && emptySymbols.error).toMatch(/symbol set is empty/);
    const dupSymbols = buildCharsets(opts({ symbolSet: 'abc' }));
    expect(!dupSymbols.ok && dupSymbols.error).toMatch(/symbol set is empty/);
    const short = buildCharsets(opts({ length: 3 }));
    expect(!short.ok && short.error).toMatch(/between 4 and 128/);
    const long = buildCharsets(opts({ length: 129 }));
    expect(long.ok).toBe(false);
    expect(buildCharsets(opts({ length: 4 })).ok).toBe(true);
  });
});

describe('entropy', () => {
  it('is length × log2(alphabet) without the requirement', () => {
    expect(passwordEntropyBits([26, 26, 10], 10, false)).toBeCloseTo(10 * Math.log2(62), 10);
    expect(passwordEntropyBits([10], 4, true)).toBeCloseTo(4 * Math.log2(10), 10);
    expect(passwordEntropyBits([], 10, false)).toBe(0);
  });

  it('counts exactly the strings that contain every set', () => {
    // Brute force: sets {a,b} and {1} with length 3 → 3^3 − 2^3 (no digit) − 1^3 (no letter) = 18
    expect(countWithEverySet([2, 1], 3)).toBe(18n);
    const brute = () => {
      const alphabet = ['a', 'b', 'c', '1', '2', '#'];
      const sets = [new Set('abc'), new Set('12'), new Set('#')];
      let n = 0;
      for (let i = 0; i < 6 ** 4; i++) {
        const chars = [0, 1, 2, 3].map((k) => alphabet[Math.floor(i / 6 ** k) % 6]);
        if (sets.every((s) => chars.some((c) => s.has(c)))) n++;
      }
      return n;
    };
    expect(countWithEverySet([3, 2, 1], 4)).toBe(BigInt(brute()));
  });

  it('is slightly lower when every set is required, and works for 128 characters', () => {
    const free = passwordEntropyBits([26, 26, 10, 27], 16, false);
    const required = passwordEntropyBits([26, 26, 10, 27], 16, true);
    expect(required).toBeLessThan(free);
    expect(free - required).toBeLessThan(1);
    const huge = passwordEntropyBits([26, 26, 10, 27], 128, true);
    expect(huge).toBeCloseTo(128 * Math.log2(89), 3);
  });

  it('computes log2 of big integers', () => {
    expect(log2BigInt(1n)).toBe(0);
    expect(log2BigInt(1024n)).toBe(10);
    expect(log2BigInt(2n ** 200n)).toBeCloseTo(200, 10);
    expect(log2BigInt(3n ** 300n)).toBeCloseTo(300 * Math.log2(3), 8);
    expect(log2BigInt(0n)).toBe(-Infinity);
  });

  it('rates entropy and estimates crack times', () => {
    expect(rateEntropy(30)).toEqual({ label: 'Weak', tone: 'danger' });
    expect(rateEntropy(50).label).toBe('Fair');
    expect(rateEntropy(70).label).toBe('Strong');
    expect(rateEntropy(128).label).toBe('Very strong');
    expect(averageCrackTime(10, 1e10)).toBe('less than a second');
    expect(averageCrackTime(40, 1e10)).toBe('about 55 seconds');
    expect(averageCrackTime(60, 1e10)).toBe('about 2 years');
    expect(averageCrackTime(80, 1e10)).toBe('about 2 million years');
    expect(averageCrackTime(128, 1e10)).toBe('longer than the age of the universe');
  });
});

describe('generatePassword', () => {
  it('produces the requested length from the alphabet', () => {
    const cs = charsets({ length: 32 });
    const rng = new SecureRandom();
    for (let i = 0; i < 50; i++) {
      const pw = generatePassword(cs, 32, true, rng);
      expect(Array.from(pw)).toHaveLength(32);
      for (const ch of pw) expect(cs.alphabet).toContain(ch);
    }
  });

  it('always includes every set when required, even at the minimum length', () => {
    const cs = charsets({ length: 4, symbolSet: '#' });
    const rng = new SecureRandom();
    for (let i = 0; i < 300; i++) {
      const pw = generatePassword(cs, 4, true, rng);
      expect(pw).toMatch(/[A-Z]/);
      expect(pw).toMatch(/[a-z]/);
      expect(pw).toMatch(/[0-9]/);
      expect(pw).toContain('#');
    }
  });

  it('handles multi-code-unit symbols as single characters', () => {
    const cs = charsets({ upper: false, lower: false, digits: false, symbolSet: '😀🔐', length: 6 });
    const pw = generatePassword(cs, 6, false, new SecureRandom());
    expect(Array.from(pw)).toHaveLength(6);
    expect(pw.replace(/😀|🔐/gu, '')).toBe('');
  });

  it('is uniform over the alphabet', () => {
    const cs = charsets({ upper: false, lower: false, symbols: false, length: 4 });
    const counts = new Map<string, number>();
    const rng = new SecureRandom();
    for (let i = 0; i < 5000; i++) for (const ch of generatePassword(cs, 4, false, rng)) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    expect(counts.size).toBe(10);
    for (const c of counts.values()) expect(Math.abs(c - 2000)).toBeLessThan(250);
  });
});

describe('passphrases', () => {
  it('embeds the complete EFF short word list', () => {
    expect(EFF_SHORT_WORDS).toHaveLength(1296);
    expect(new Set(EFF_SHORT_WORDS).size).toBe(1296);
    expect(EFF_SHORT_WORDS[0]).toBe('acid');
    expect(EFF_SHORT_WORDS[1295]).toBe('zoom');
    expect(EFF_SHORT_WORDS.every((w) => /^[a-z-]{3,5}$/.test(w))).toBe(true);
    expect([...EFF_SHORT_WORDS].sort()).toEqual([...EFF_SHORT_WORDS]);
  });

  it('generates words with the chosen separator and capitalisation', () => {
    const rng = new SecureRandom();
    const lower = generatePassphrase(EFF_SHORT_WORDS, { ...DEFAULT_PASSPHRASE_OPTIONS, words: 5, separator: ' ' }, rng);
    const parts = lower.split(' ');
    expect(parts).toHaveLength(5);
    for (const p of parts) expect(EFF_SHORT_WORDS).toContain(p);
    const title = generatePassphrase(EFF_SHORT_WORDS, { ...DEFAULT_PASSPHRASE_OPTIONS, words: 4, separator: '.', capitalization: 'capitalize' }, rng);
    for (const p of title.split('.')) expect(p).toMatch(/^[A-Z][a-z-]*$/);
    const upper = generatePassphrase(EFF_SHORT_WORDS, { ...DEFAULT_PASSPHRASE_OPTIONS, capitalization: 'upper' }, rng);
    expect(upper).toBe(upper.toUpperCase());
  });

  it('inserts one number when asked', () => {
    const rng = new SecureRandom();
    for (let i = 0; i < 50; i++) {
      const phrase = generatePassphrase(EFF_SHORT_WORDS, { ...DEFAULT_PASSPHRASE_OPTIONS, words: 3, includeNumber: true }, rng);
      const tokens = phrase.split('-').filter((t) => t !== '' && t !== 'yo');
      const numbers = tokens.filter((t) => /^\d+$/.test(t));
      expect(numbers).toHaveLength(1);
      expect(Number(numbers[0])).toBeLessThan(100);
    }
  });

  it('mixes case randomly per word', () => {
    const rng = new SecureRandom();
    const phrase = generatePassphrase(EFF_SHORT_WORDS, { ...DEFAULT_PASSPHRASE_OPTIONS, words: 20, capitalization: 'random', separator: ' ' }, rng);
    const caps = phrase.split(' ').filter((w) => /^[A-Z]/.test(w)).length;
    expect(caps).toBeGreaterThan(0);
    expect(caps).toBeLessThan(20);
  });

  it('computes passphrase entropy', () => {
    expect(passphraseEntropyBits(1296, { ...DEFAULT_PASSPHRASE_OPTIONS, words: 6 })).toBeCloseTo(6 * Math.log2(1296), 10);
    expect(passphraseEntropyBits(1296, { ...DEFAULT_PASSPHRASE_OPTIONS, words: 4, capitalization: 'random' })).toBeCloseTo(4 * Math.log2(1296) + 4, 10);
    expect(passphraseEntropyBits(1296, { ...DEFAULT_PASSPHRASE_OPTIONS, words: 4, includeNumber: true })).toBeCloseTo(4 * Math.log2(1296) + Math.log2(100) + Math.log2(5), 10);
    expect(passphraseEntropyBits(1, DEFAULT_PASSPHRASE_OPTIONS)).toBe(0);
    expect(() => generatePassphrase([], DEFAULT_PASSPHRASE_OPTIONS, new SecureRandom())).toThrow(/empty/);
  });
});
