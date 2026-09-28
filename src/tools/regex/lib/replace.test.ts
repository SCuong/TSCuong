import { describe, expect, it } from 'vitest';
import { findMatches } from './match';
import { expandReplacement } from './replace';
import { runRegexJob } from './job';

/** Expand the template for every match and stitch the result like String.prototype.replace. */
function replaceWithExpand(pattern: string, flags: string, text: string, template: string): string {
  const { matches } = findMatches(pattern, flags, text);
  const hasNamedGroups = /\(\?<(?![=!])/.test(pattern);
  let out = '';
  let last = 0;
  for (const match of matches) {
    out += text.slice(last, match.index) + expandReplacement(template, { input: text, match, hasNamedGroups });
    last = match.end;
  }
  return out + text.slice(last);
}

describe('expandReplacement', () => {
  const cases: Array<[string, string, string, string]> = [
    ['(\\w+)@(\\w+)', 'g', 'alice@example bob@test', '$2 at $1'],
    ['(\\d{4})-(\\d{2})-(\\d{2})', 'g', '2024-03-15 and 1999-12-31', '$3/$2/$1'],
    ['(?<first>\\w+) (?<last>\\w+)', '', 'Ada Lovelace', '$<last>, $<first>'],
    ['b', 'g', 'abc', '[$`|$&|$\']'],
    ['a', 'g', 'aaa', '$$'],
    ['a', 'g', 'aa', '$'],
    ['(a)', 'g', 'aa', '$0 $1 $2 $10 $01 $00'],
    ['(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)', '', 'abcdefghijk', '$11-$10-$1-$12'],
    ['(a)', '', 'a', '$<name>'],
    ['(?<n>a)', '', 'a', '$<n>$<missing>$<unclosed'],
    ['(?<n>a)|(?<m>b)', 'g', 'ab', '[$<n>|$<m>]'],
    ['x*', 'g', 'abc', '-'],
    ['', 'gu', '😀é', '|'],
    ['(é)', 'gi', 'Été', '<$1>'],
  ];

  for (const [pattern, flags, text, template] of cases) {
    it(`matches String.replace for /${pattern}/${flags} with "${template}"`, () => {
      expect(replaceWithExpand(pattern, flags, text, template)).toBe(text.replace(new RegExp(pattern, flags), template));
    });
  }

  it('treats an empty template as deletion', () => {
    expect(replaceWithExpand('\\s+', 'g', 'a b  c', '')).toBe('abc');
  });
});

describe('runRegexJob', () => {
  it('returns matches only in match mode', () => {
    const r = runRegexJob({ pattern: '\\d', flags: 'g', text: 'a1b2', replacement: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.summary.total).toBe(2);
    expect(r.replaced).toBeNull();
    expect(r.replacements).toBeNull();
    expect(r.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('returns the replaced text and per-match replacements in replace mode', () => {
    const r = runRegexJob({ pattern: '(\\w)(\\d)', flags: 'g', text: 'a1 b2', replacement: '$2$1' });
    expect(r.ok && r.replaced).toBe('1a 2b');
    expect(r.ok && r.replacements).toEqual(['1a', '2b']);
  });

  it('replaces only the first match without g, like JavaScript', () => {
    const r = runRegexJob({ pattern: 'o', flags: '', text: 'foo', replacement: '0' });
    expect(r.ok && r.replaced).toBe('f0o');
  });

  it('returns a human error for invalid patterns', () => {
    const r = runRegexJob({ pattern: '(', flags: 'g', text: 'x', replacement: null });
    expect(r).toEqual({ ok: false, error: expect.stringContaining('never closed') });
  });
});
