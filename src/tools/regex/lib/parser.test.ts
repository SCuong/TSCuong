import { describe, expect, it } from 'vitest';
import { countCaptureGroups, parsePattern, type ClassNode, type GroupNode, type QuantifierNode, type TermNode } from './parser';

const terms = (pattern: string, unicode = false, unicodeSets = false): TermNode[] =>
  parsePattern(pattern, { unicode, unicodeSets }).ast.alternatives[0].terms;

describe('parsePattern', () => {
  it('parses an empty pattern', () => {
    const { ast, groups } = parsePattern('');
    expect(ast.alternatives).toHaveLength(1);
    expect(ast.alternatives[0].terms).toHaveLength(0);
    expect(groups).toEqual([]);
  });

  it('parses literals, dot and anchors', () => {
    const t = terms('^a.b$');
    expect(t.map((n) => n.type)).toEqual(['anchor', 'char', 'dot', 'char', 'anchor']);
    expect(t.every((n) => n.raw.length === 1)).toBe(true);
  });

  it('parses alternation at the top level and in groups', () => {
    const { ast } = parsePattern('cat|dog|');
    expect(ast.alternatives.map((a) => a.raw)).toEqual(['cat', 'dog', '']);
    const g = terms('(a|b)c')[0] as GroupNode;
    expect(g.body.alternatives).toHaveLength(2);
  });

  it('parses quantifiers with greedy and lazy forms', () => {
    const t = terms('a*b+?c?d{2}e{2,}f{2,5}?') as QuantifierNode[];
    expect(t.map((q) => [q.min, q.max, q.greedy, q.symbol])).toEqual([
      [0, Infinity, true, '*'],
      [1, Infinity, false, '+?'],
      [0, 1, true, '?'],
      [2, 2, true, '{2}'],
      [2, Infinity, true, '{2,}'],
      [2, 5, false, '{2,5}?'],
    ]);
    expect(t[5].raw).toBe('f{2,5}?');
  });

  it('treats a brace that is not a quantifier as a literal (Annex B)', () => {
    const t = terms('a{b}{,5}');
    expect(t.every((n) => n.type === 'char')).toBe(true);
    expect(t.map((n) => n.raw).join('')).toBe('a{b}{,5}');
  });

  it('numbers capture groups by their opening parenthesis and records names and spans', () => {
    const { groups } = parsePattern('(a(?<inner>b))(?:c)(d)');
    expect(groups).toEqual([
      { index: 1, start: 0, end: 14 },
      { index: 2, name: 'inner', start: 2, end: 13 },
      { index: 3, start: 19, end: 22 },
    ]);
  });

  it('parses lookarounds and non-capturing groups', () => {
    const t = terms('(?=a)(?!b)(?<=c)(?<!d)(?:e)');
    expect(t.map((n) => (n.type === 'lookaround' ? n.kind : n.type === 'group' ? n.kind : n.type))).toEqual([
      'lookahead',
      'negativeLookahead',
      'lookbehind',
      'negativeLookbehind',
      'noncapture',
    ]);
  });

  it('parses inline modifier groups', () => {
    const g = terms('(?i-m:a)')[0] as GroupNode;
    expect(g.kind).toBe('modifiers');
    expect(g.add).toBe('i');
    expect(g.remove).toBe('m');
  });

  it('parses back-references by number and by name', () => {
    const t = terms('(a)\\1(?<x>b)\\k<x>');
    expect(t[1]).toMatchObject({ type: 'backreference', ref: 1 });
    expect(t[3]).toMatchObject({ type: 'backreference', ref: 'x' });
  });

  it('treats \\N beyond the group count as a legacy octal escape without u', () => {
    const t = terms('\\12');
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ type: 'char', kind: 'octal', codePoint: 0o12 });
    expect(terms('\\8')[0]).toMatchObject({ type: 'char', codePoint: 56 });
  });

  it('treats \\k as a literal k without named groups and without u', () => {
    expect(terms('\\k<a>')[0]).toMatchObject({ type: 'char', kind: 'identity', codePoint: 107 });
  });

  it('parses character escapes to code points', () => {
    const t = terms('\\n\\t\\x41\\u00e9\\cM\\0\\.', false);
    expect(t.map((n) => (n.type === 'char' ? n.codePoint : -1))).toEqual([10, 9, 0x41, 0xe9, 13, 0, 46]);
  });

  it('parses \\u{...} and surrogate-pair escapes in unicode mode', () => {
    expect(terms('\\u{1F600}', true)[0]).toMatchObject({ type: 'char', codePoint: 0x1f600 });
    expect(terms('\\uD83D\\uDE00', true)).toHaveLength(1);
    expect(terms('\\uD83D\\uDE00', true)[0]).toMatchObject({ codePoint: 0x1f600 });
    expect(terms('\\uD83D\\uDE00', false)).toHaveLength(2);
  });

  it('reads astral literals as one character only in unicode mode', () => {
    expect(terms('😀', true)).toHaveLength(1);
    expect(terms('😀', false)).toHaveLength(2);
    const q = terms('😀+', true)[0] as QuantifierNode;
    expect(q.type).toBe('quantifier');
    expect(q.body.raw).toBe('😀');
  });

  it('parses shorthand classes and Unicode properties', () => {
    const t = terms('\\d\\W\\p{L}\\P{Script=Greek}', true);
    expect(t[0]).toMatchObject({ type: 'shorthand', kind: 'd' });
    expect(t[1]).toMatchObject({ type: 'shorthand', kind: 'W' });
    expect(t[2]).toMatchObject({ type: 'property', negated: false, name: 'L' });
    expect(t[3]).toMatchObject({ type: 'property', negated: true, name: 'Script', value: 'Greek' });
  });

  it('parses character classes with ranges, escapes and negation', () => {
    const c = terms('[^a-z0-9_\\-\\d]')[0] as ClassNode;
    expect(c.negated).toBe(true);
    expect(c.items.map((i) => i.type)).toEqual(['range', 'range', 'char', 'char', 'shorthand']);
    expect(c.raw).toBe('[^a-z0-9_\\-\\d]');
  });

  it('keeps a leading or trailing hyphen literal and handles [\\b] as backspace', () => {
    const c = terms('[-a-][\\b]');
    expect((c[0] as ClassNode).items.map((i) => i.raw)).toEqual(['-', 'a', '-']);
    expect((c[1] as ClassNode).items[0]).toMatchObject({ type: 'char', codePoint: 8 });
  });

  it('splits [\\d-z] into three items in Annex B mode', () => {
    const c = terms('[\\d-z]')[0] as ClassNode;
    expect(c.items.map((i) => i.raw)).toEqual(['\\d', '-', 'z']);
  });

  it('parses v-mode set operations, nested classes and \\q strings', () => {
    const sub = terms('[\\w--\\d]', true, true)[0] as ClassNode;
    expect(sub.operation).toBe('subtraction');
    expect(sub.items).toHaveLength(2);
    const inter = terms('[[a-z]&&[^aeiou]]', true, true)[0] as ClassNode;
    expect(inter.operation).toBe('intersection');
    expect(inter.items.map((i) => i.type)).toEqual(['class', 'class']);
    const q = terms('[\\q{abc|d}x]', true, true)[0] as ClassNode;
    expect(q.items[0]).toMatchObject({ type: 'strings', strings: ['abc', 'd'] });
  });

  it('decodes escaped group names', () => {
    const { groups } = parsePattern('(?<\\u0061b>x)', { unicode: true });
    expect(groups[0].name).toBe('ab');
  });

  it('covers the whole source with top-level term spans', () => {
    const pattern = '^(?<y>\\d{4})-(\\d\\d)[-/](?:\\d{2}|xx)$';
    const t = terms(pattern);
    expect(t.map((n) => n.raw).join('')).toBe(pattern);
  });

  it('never throws on invalid or unusual input', () => {
    for (const p of ['(', ')', '[', '\\', '(?', '(?<', 'a{', '[a-', '(?<=', '\\c', '\\u{', '\\p{', '[\\q{']) {
      expect(() => parsePattern(p)).not.toThrow();
      expect(() => parsePattern(p, { unicode: true, unicodeSets: true })).not.toThrow();
    }
  });

  it('parses a very long pattern quickly', () => {
    const pattern = '(?:a|b)[c-e]\\d+'.repeat(5000);
    const started = performance.now();
    const { ast } = parsePattern(pattern);
    expect(ast.alternatives[0].terms).toHaveLength(15000);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});

describe('countCaptureGroups', () => {
  it('ignores escaped parentheses, classes and non-capturing groups', () => {
    expect(countCaptureGroups('(a)\\(b\\)[(](?:c)(?=d)(?<n>e)(?<=f)')).toEqual({ count: 2, hasNamed: true });
    expect(countCaptureGroups('abc')).toEqual({ count: 0, hasNamed: false });
  });
});

describe('countCaptureGroups class nesting', () => {
  it('only nests classes with the v flag', () => {
    // Without v, "[[]" is a complete class, so (a) is group 1 and \1 is a back-reference.
    expect(countCaptureGroups('[[](a)\\1')).toEqual({ count: 1, hasNamed: false });
    expect(countCaptureGroups('[[a]](b)', true)).toEqual({ count: 1, hasNamed: false });
    const ast = parsePattern('[[](a)\\1').ast;
    expect(ast.alternatives[0].terms.at(-1)).toMatchObject({ type: 'backreference', ref: 1 });
  });
});
