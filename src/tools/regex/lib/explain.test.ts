import { describe, expect, it } from 'vitest';
import { describeCodePoint, explainPattern, quantifierPhrase, type ExplainNode } from './explain';

const texts = (nodes: ExplainNode[]): string[] => nodes.map((n) => n.text);

describe('explainPattern', () => {
  it('explains an empty pattern as no tokens', () => {
    expect(explainPattern('', '').nodes).toEqual([]);
  });

  it('merges consecutive literal characters into one text token', () => {
    const { nodes } = explainPattern('hello', '');
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ raw: 'hello', kind: 'literal', start: 0, end: 5 });
    expect(nodes[0].text).toBe('The text "hello"');
  });

  it('does not merge a quantified character into the preceding text', () => {
    const { nodes } = explainPattern('abc+', '');
    expect(nodes.map((n) => n.raw)).toEqual(['ab', 'c+']);
    expect(nodes[1].text).toBe('Character "c", 1 or more times, as many as possible (greedy)');
  });

  it('mentions case-insensitivity for literals with the i flag', () => {
    expect(explainPattern('abc', 'i').nodes[0].text).toContain('any letter case');
  });

  it('explains anchors according to the m flag', () => {
    expect(texts(explainPattern('^$', '').nodes)).toEqual(['Start of the text', 'End of the text']);
    expect(texts(explainPattern('^$', 'm').nodes)).toEqual(['Start of a line', 'End of a line']);
  });

  it('explains the dot according to the s flag', () => {
    expect(explainPattern('.', '').nodes[0].text).toContain('except line breaks');
    expect(explainPattern('.', 's').nodes[0].text).toContain('including line breaks');
  });

  it('explains groups, named groups and back-references', () => {
    const { nodes, groups } = explainPattern('(?<word>\\w+) \\k<word> (x)\\2', '');
    expect(groups.map((g) => g.name)).toEqual(['word', undefined]);
    expect(nodes[0].text).toContain('Named capture group "word" (#1)');
    expect(nodes[0].children?.[0].text).toContain('word character');
    const refs = nodes.filter((n) => n.kind === 'reference').map((n) => n.text);
    expect(refs).toEqual(['The same text that was captured by the group named "word" (#1)', 'The same text that was captured by group #2']);
  });

  it('lists alternatives as separate nodes', () => {
    const { nodes } = explainPattern('cat|dog|', '');
    expect(nodes).toHaveLength(3);
    expect(nodes[0].text).toBe('Alternative 1 of 3');
    expect(nodes[0].children?.[0].text).toBe('The text "cat"');
    expect(nodes[2].text).toContain('empty string');
  });

  it('explains classes with their items', () => {
    const [node] = explainPattern('[^a-f\\d_]', '').nodes;
    expect(node.text).toBe('One character NOT in the set');
    expect(texts(node.children!)).toEqual(['Range "a" to "f"', 'A digit (0-9)', 'Character "_"']);
  });

  it('explains v-mode set operations and strings', () => {
    expect(explainPattern('[\\w--\\d]', 'v').nodes[0].text).toContain('excluding');
    expect(explainPattern('[\\p{L}&&\\p{ASCII}]', 'v').nodes[0].text).toContain('in all of these sets');
    expect(explainPattern('[\\q{ab|c}]', 'v').nodes[0].children?.[0].text).toBe('One of the strings "ab", "c"');
  });

  it('explains Unicode properties', () => {
    expect(explainPattern('\\p{Lu}', 'u').nodes[0].text).toBe('A Unicode uppercase letter');
    expect(explainPattern('\\P{Script=Greek}', 'u').nodes[0].text).toBe('Any character that is not a character in the Greek script');
    expect(explainPattern('\\p{Emoji}', 'u').nodes[0].text).toBe('An emoji character');
    expect(explainPattern('\\p{ASCII}', 'u').nodes[0].text).toBe('An ASCII character');
  });

  it('explains lookarounds', () => {
    const { nodes } = explainPattern('a(?=b)(?<!c)', '');
    expect(nodes[1].text).toContain('only if followed by');
    expect(nodes[2].text).toContain('only if NOT preceded by');
  });

  it('tracks inline modifier flags', () => {
    const [node] = explainPattern('(?s:.)', '').nodes;
    expect(node.text).toContain('turn on s');
    expect(node.children?.[0].text).toContain('including line breaks');
  });

  it('explains quantified groups', () => {
    const [node] = explainPattern('(?:ab){2,3}?', '').nodes;
    expect(node.raw).toBe('(?:ab){2,3}?');
    expect(node.text).toBe('Non-capturing group, between 2 and 3 times, as few as possible (lazy)');
  });

  it('explains Unicode and emoji literals with the u flag', () => {
    const { nodes } = explainPattern('é😀', 'u');
    expect(nodes[0].text).toBe('The text "é😀"');
    expect(explainPattern('\\u{1F600}', 'u').nodes[0].text).toContain('U+1F600');
  });

  it('describes control characters instead of printing them', () => {
    expect(explainPattern('\\t\\n', '').nodes[0].text).toBe('The characters tab, line feed (newline)');
  });

  it('warns about nested unbounded quantifiers', () => {
    expect(explainPattern('(a+)+$', '').warnings).toHaveLength(1);
    expect(explainPattern('(?:\\w+\\s?)*', '').warnings).toHaveLength(1);
    expect(explainPattern('(ab)+', '').warnings).toHaveLength(0);
    expect(explainPattern('(a{1,3}){2}', '').warnings).toHaveLength(0);
    expect(explainPattern('(?:\\.[\\w-]+)+', '').warnings).toHaveLength(0);
    expect(explainPattern('(\\d+,)*', '').warnings).toHaveLength(0);
  });

  it('keeps source positions for every top-level node', () => {
    const pattern = '^\\d{3}-[a-z]+(?:x|y)$';
    const { nodes } = explainPattern(pattern, '');
    for (const n of nodes) expect(pattern.slice(n.start, n.end)).toBe(n.raw);
  });
});

describe('helpers', () => {
  it('phrases quantifiers', () => {
    expect(quantifierPhrase(0, 1, true)).toBe('optional (0 or 1 time), as many as possible (greedy)');
    expect(quantifierPhrase(3, 3, true)).toBe('exactly 3 times');
    expect(quantifierPhrase(1, 1, false)).toBe('exactly 1 time');
    expect(quantifierPhrase(2, Infinity, false)).toBe('2 or more times, as few as possible (lazy)');
  });

  it('describes code points', () => {
    expect(describeCodePoint(97)).toBe('"a"');
    expect(describeCodePoint(32)).toBe('space');
    expect(describeCodePoint(0xe9)).toBe('"é" (U+00E9)');
    expect(describeCodePoint(1)).toBe('control character U+0001');
    expect(describeCodePoint(0xd83d)).toBe('lone surrogate U+D83D');
  });
});
