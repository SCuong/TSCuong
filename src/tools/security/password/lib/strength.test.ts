import { beforeAll, describe, expect, it } from 'vitest';
import type { MatchExtended } from '@zxcvbn-ts/core';
import { ATTACK_SCENARIOS, SCORE_INFO, charsetEntropy, describeMatch, guessesToBits, loadEstimator } from './strength';

describe('charsetEntropy', () => {
  it('uses the pools of the character classes present', () => {
    expect(charsetEntropy('')).toEqual({ length: 0, pool: 0, bits: 0, classes: [] });
    expect(charsetEntropy('abc')).toMatchObject({ pool: 26, length: 3 });
    expect(charsetEntropy('abcABC123')).toMatchObject({ pool: 62, classes: ['lowercase', 'uppercase', 'digits'] });
    const all = charsetEntropy('aA1 !');
    expect(all.pool).toBe(95);
    expect(all.bits).toBeCloseTo(5 * Math.log2(95), 10);
  });

  it('counts code points, so emoji and accents are single characters', () => {
    const e = charsetEntropy('pässwörd😀');
    expect(e.length).toBe(9);
    expect(e.classes).toEqual(['lowercase', 'other Unicode']);
    expect(e.pool).toBe(126);
  });

  it('handles very long input', () => {
    expect(charsetEntropy('a'.repeat(10_000)).bits).toBeCloseTo(10_000 * Math.log2(26), 6);
  });
});

describe('describeMatch', () => {
  const m = (partial: Record<string, unknown>) => ({ i: 0, j: 1, token: 'xx', ...partial }) as unknown as MatchExtended;

  it('describes every zxcvbn pattern', () => {
    expect(describeMatch(m({ pattern: 'dictionary', dictionaryName: 'passwords', rank: 2, l33t: true, reversed: false }))).toEqual({
      pattern: 'Dictionary word',
      detail: '#2 in common passwords, with l33t substitutions',
    });
    expect(describeMatch(m({ pattern: 'dictionary', dictionaryName: 'lastnames-en', rank: 1500, reversed: true })).detail).toBe('#1,500 in last names, reversed');
    expect(describeMatch(m({ pattern: 'spatial', graph: 'qwerty', turns: 1, shiftedCount: 0 })).detail).toBe('On a QWERTY keyboard, 1 turn');
    expect(describeMatch(m({ pattern: 'repeat', baseToken: 'ab', repeatCount: 3 })).detail).toBe('2-character block repeated 3×');
    expect(describeMatch(m({ pattern: 'sequence', sequenceName: 'digits', ascending: true })).detail).toBe('Ascending digits');
    expect(describeMatch(m({ pattern: 'regex', regexName: 'recentYear' })).pattern).toBe('Recent year');
    expect(describeMatch(m({ pattern: 'date', year: 1987, month: 3, day: 9 })).detail).toBe('1987-03-09');
    expect(describeMatch(m({ pattern: 'bruteforce' })).pattern).toBe('Random characters');
    expect(describeMatch(m({ pattern: 'separator' })).pattern).toBe('Separator');
    expect(describeMatch(m({ pattern: 'wordSequence', wordCount: 3, ascending: true, dictionaryName: 'cardinalNumbers-en' })).detail).toBe(
      '3 words in natural order (cardinal numbers)',
    );
    expect(describeMatch(m({ pattern: 'custom' })).pattern).toBe('custom');
  });
});

describe('score and scenario tables', () => {
  it('cover scores 0–4 and the four zxcvbn scenarios', () => {
    expect(SCORE_INFO).toHaveLength(5);
    expect(ATTACK_SCENARIOS.map((s) => s.key)).toEqual([
      'onlineThrottlingXPerHour',
      'onlineNoThrottlingXPerSecond',
      'offlineSlowHashingXPerSecond',
      'offlineFastHashingXPerSecond',
    ]);
    expect(guessesToBits(3)).toBeCloseTo(9.966, 3);
  });
});

describe('zxcvbn estimator', () => {
  // Building the dictionaries takes a few seconds on a busy machine; do it once, with a generous timeout.
  beforeAll(async () => {
    await loadEstimator();
  }, 60_000);

  it('rates common passwords low and long random ones high', { timeout: 30_000 }, async () => {
    const check = await loadEstimator();
    const weak = check('password');
    expect(weak.score).toBe(0);
    expect(weak.feedback.warning).toBeTruthy();
    expect(weak.sequence[0].pattern).toBe('dictionary');
    expect(check('P@ssw0rd').score).toBeLessThanOrEqual(1);
    expect(check('qwertyuiop').sequence.some((s) => s.pattern === 'spatial' || s.pattern === 'dictionary')).toBe(true);
    const strong = check('tQ7#vL9!xR2$mZ4%kW8&');
    expect(strong.score).toBe(4);
    expect(strong.crackTimes.offlineFastHashingXPerSecond.display).toBeTruthy();
    expect(check('correct horse battery staple').score).toBeGreaterThanOrEqual(3);
  });

  it('penalises personal words and handles Unicode', { timeout: 30_000 }, async () => {
    const check = await loadEstimator();
    const plain = check('ChristopherWalken1987');
    const personal = check('ChristopherWalken1987', ['Christopher', 'Walken', '1987']);
    expect(personal.guessesLog10).toBeLessThan(plain.guessesLog10);
    expect(check('Zoë😀Ω漢字').score).toBeGreaterThanOrEqual(1);
  });

  it('returns the same estimator instance on repeated loads', async () => {
    expect(await loadEstimator()).toBe(await loadEstimator());
  });
});
