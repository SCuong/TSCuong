import { describe, expect, it } from 'vitest';
import { buildPageIndex, findMatches, itemsInRange, snippet } from './search';

const index = buildPageIndex([
  { str: 'Hello ' },
  { str: 'World', hasEOL: true },
  { str: 'hello again, WORLD' },
  { str: '' },
  { str: 'Ünïcødé 🎉' },
]);

describe('viewer search', () => {
  it('builds a lowercased index with item offsets', () => {
    expect(index.text).toBe('hello world\nhello again, world' + 'ünïcødé 🎉');
    expect(index.starts).toEqual([0, 6, 12, 30, 30]);
  });

  it('finds case-insensitive matches, spanning items and line breaks', () => {
    expect(findMatches(index, 'WORLD')).toEqual([
      { start: 6, end: 11 },
      { start: 25, end: 30 },
    ]);
    expect(findMatches(index, 'world hello')).toEqual([{ start: 6, end: 17 }]);
    expect(findMatches(index, 'ünïcødé')).toHaveLength(1);
    expect(findMatches(index, '🎉')).toHaveLength(1);
  });

  it('treats regex characters literally and ignores empty queries', () => {
    expect(findMatches(buildPageIndex([{ str: 'a.b (c) a*b' }]), 'a.b')).toEqual([{ start: 0, end: 3 }]);
    expect(findMatches(buildPageIndex([{ str: 'a.b (c)' }]), '(c)')).toHaveLength(1);
    expect(findMatches(index, '   ')).toEqual([]);
  });

  it('maps matches back to items', () => {
    expect(itemsInRange(index, 6, 17)).toEqual([1, 2]);
    expect(itemsInRange(index, 0, 3)).toEqual([0]);
  });

  it('creates snippets', () => {
    const s = snippet(index, 12, 17, 5);
    expect(s).toBe('…orld hello agai…');
  });

  it('handles an empty page', () => {
    const empty = buildPageIndex([]);
    expect(findMatches(empty, 'x')).toEqual([]);
    expect(itemsInRange(empty, 0, 1)).toEqual([]);
  });
});
