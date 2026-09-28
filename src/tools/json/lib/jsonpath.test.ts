import { describe, expect, it } from 'vitest';
import { JSONPATH_EXAMPLES, runJsonPath } from './jsonpath';

const DOC = {
  store: {
    book: [
      { category: 'reference', author: 'Nigel Rees', title: 'Sayings of the Century', price: 8.95, tags: ['a'] },
      { category: 'fiction', author: 'Herman Melville', title: 'Moby Dick', isbn: '0-553-21311-3', price: 8.99, tags: [] },
      { category: 'fiction', author: 'J. R. R. Tolkien', title: 'The Lord of the Rings', price: 22.99, tags: ['x', 'y'] },
    ],
    bicycle: { color: 'red', price: 399 },
    'odd key': { 'é': '😀' },
  },
};

describe('runJsonPath', () => {
  it('returns values with normalized and pretty paths', () => {
    const r = runJsonPath('$.store.book[*].author', DOC);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.matches.map((m) => m.value)).toEqual(['Nigel Rees', 'Herman Melville', 'J. R. R. Tolkien']);
    expect(r.matches[0].path).toBe("$['store']['book'][0]['author']");
    expect(r.matches[0].pretty).toBe('$.store.book[0].author');
    expect(r.matches[0].pointer).toBe('/store/book/0/author');
  });
  it('supports filters and functions', () => {
    const cheap = runJsonPath('$..book[?@.price < 10].title', DOC);
    expect(cheap.ok && cheap.matches.map((m) => m.value)).toEqual(['Sayings of the Century', 'Moby Dick']);
    const len = runJsonPath('$..book[?length(@.tags) > 1].title', DOC);
    expect(len.ok && len.matches.map((m) => m.value)).toEqual(['The Lord of the Rings']);
  });
  it('handles Unicode keys', () => {
    const r = runJsonPath("$.store['odd key']['é']", DOC);
    expect(r.ok && r.matches[0].value).toBe('😀');
  });
  it('reports syntax errors with a position', () => {
    const r = runJsonPath('$.store.book[?@.price <]', DOC);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.message).not.toMatch(/\(.*:\d+\)$/);
    expect(r.index).not.toBeNull();
  });
  it('requires a root', () => {
    const r = runJsonPath('store.book', DOC);
    expect(r.ok).toBe(false);
    expect(runJsonPath('  ', DOC).ok).toBe(false);
  });
  it('returns an empty list for no matches', () => {
    const r = runJsonPath('$.nope', DOC);
    expect(r).toEqual({ ok: true, matches: [], truncated: false });
  });
  it('caps huge result sets', () => {
    const big = Array.from({ length: 10_000 }, (_, i) => i);
    const r = runJsonPath('$[*]', big, 100);
    expect(r.ok && r.matches.length).toBe(100);
    expect(r.ok && r.truncated).toBe(true);
  });
  it('every cheat-sheet example is valid', () => {
    for (const ex of JSONPATH_EXAMPLES) {
      const r = runJsonPath(ex.expr, DOC);
      expect(r.ok, `${ex.expr}: ${r.ok ? '' : r.message}`).toBe(true);
    }
  });
});
