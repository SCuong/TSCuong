import { describe, expect, it } from 'vitest';
import { advanceIndex, findMatches } from './match';

describe('findMatches', () => {
  it('returns no matches for empty text or no match', () => {
    expect(findMatches('a', 'g', '')).toMatchObject({ matches: [], total: 0, capped: false });
    expect(findMatches('x', 'g', 'abc').total).toBe(0);
  });

  it('reports the group count even when nothing matches', () => {
    expect(findMatches('(a)(?<b>b)', 'g', 'zzz').groupCount).toBe(2);
  });

  it('finds only the first match without g', () => {
    const r = findMatches('\\d+', '', 'a1 b22 c333');
    expect(r.total).toBe(1);
    expect(r.matches[0]).toMatchObject({ index: 1, end: 2, text: '1' });
  });

  it('finds all matches with g, with positions', () => {
    const r = findMatches('\\d+', 'g', 'a1 b22 c333');
    expect(r.matches.map((m) => [m.index, m.end, m.text])).toEqual([
      [1, 2, '1'],
      [4, 6, '22'],
      [8, 11, '333'],
    ]);
  });

  it('reports numbered and named groups with spans', () => {
    const r = findMatches('(?<y>\\d{4})-(\\d{2})(x)?', 'g', 'on 2024-05!');
    const [m] = r.matches;
    expect(m.groups).toEqual([
      { index: 1, name: 'y', value: '2024', start: 3, end: 7 },
      { index: 2, name: undefined, value: '05', start: 8, end: 10 },
      { index: 3, name: undefined, value: undefined, start: null, end: null },
    ]);
  });

  it('handles zero-length matches without looping forever', () => {
    const r = findMatches('x*', 'g', 'abc');
    expect(r.total).toBe(4);
    expect(r.matches.map((m) => m.index)).toEqual([0, 1, 2, 3]);
    expect(findMatches('', 'g', 'ab').total).toBe(3);
    expect(findMatches('\\b', 'g', 'hi there').matches.map((m) => m.index)).toEqual([0, 2, 3, 8]);
    expect(findMatches('^', 'gm', 'a\nb\n').total).toBe(3);
  });

  it('agrees with String.prototype.matchAll on assorted patterns', () => {
    const cases: Array<[string, string, string]> = [
      ['a*', 'g', 'baaac'],
      ['(?:)', 'gu', '😀a'],
      ['.', 'g', 'a😀b'],
      ['.', 'gu', 'a😀b'],
      ['\\w+|(?=x)', 'g', 'ab x cd'],
      ['$', 'gm', 'l1\nl2\r\nl3'],
      ['a', 'gy', 'aab'],
      ['a', 'gi', 'AaBa'],
    ];
    for (const [p, f, t] of cases) {
      const native = [...t.matchAll(new RegExp(p, f))].map((m) => [m.index, m[0]]);
      const ours = findMatches(p, f, t).matches.map((m) => [m.index, m.text]);
      expect(ours, `/${p}/${f}`).toEqual(native);
    }
  });

  it('steps over whole emoji for empty matches with u, and splits them without', () => {
    expect(findMatches('', 'gu', '😀').total).toBe(2);
    expect(findMatches('', 'g', '😀').total).toBe(3);
  });

  it('matches emoji as one character with the u flag', () => {
    const r = findMatches('^.$', 'u', '😀');
    expect(r.total).toBe(1);
    expect(r.matches[0]).toMatchObject({ index: 0, end: 2, text: '😀' });
    expect(findMatches('^.$', '', '😀').total).toBe(0);
    expect(findMatches('\\p{Emoji_Presentation}', 'gu', 'a🎉b🚀').matches.map((m) => m.text)).toEqual(['🎉', '🚀']);
  });

  it('supports the v flag', () => {
    expect(findMatches('[\\w--\\d]+', 'gv', 'ab12cd').matches.map((m) => m.text)).toEqual(['ab', 'cd']);
  });

  it('respects the sticky flag', () => {
    expect(findMatches('a', 'y', 'ba').total).toBe(0);
    expect(findMatches('a', 'gy', 'aaba').total).toBe(2);
  });

  it('caps details and counting on large input', () => {
    const text = 'ab '.repeat(200_000);
    const r = findMatches('ab', 'g', text, { maxDetails: 50, maxCount: 1000 });
    expect(r.matches).toHaveLength(50);
    expect(r.total).toBe(1000);
    expect(r.capped).toBe(true);
    const all = findMatches('ab', 'g', text, { maxDetails: 10 });
    expect(all.total).toBe(100_000);
    expect(all.capped).toBe(true);
  });

  it('does not claim a cap when the count limit equals the real count', () => {
    const r = findMatches('a', 'g', 'aaa', { maxCount: 3 });
    expect(r.total).toBe(3);
    expect(r.capped).toBe(false);
  });

  it('throws for an invalid pattern', () => {
    expect(() => findMatches('(', 'g', 'x')).toThrow(SyntaxError);
  });
});

describe('advanceIndex', () => {
  it('advances by a code point in unicode mode', () => {
    expect(advanceIndex('😀a', 0, true)).toBe(2);
    expect(advanceIndex('😀a', 0, false)).toBe(1);
    expect(advanceIndex('ab', 1, true)).toBe(2);
  });
});
