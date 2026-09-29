import { describe, expect, it } from 'vitest';
import { chunkPages, formatPageList, parsePageRange, parseRangeGroups } from './ranges';

function pages(input: string, total: number, unique = true) {
  const r = parsePageRange(input, total, { unique });
  if (!r.ok) throw new Error(r.error);
  return r.pages;
}

function error(input: string, total: number) {
  const r = parsePageRange(input, total);
  if (r.ok) throw new Error(`expected an error for ${input}`);
  return r.error;
}

describe('parsePageRange', () => {
  it('parses single pages and ranges', () => {
    expect(pages('1', 10)).toEqual([1]);
    expect(pages('1-3', 10)).toEqual([1, 2, 3]);
    expect(pages('1-3, 5, 8-', 10)).toEqual([1, 2, 3, 5, 8, 9, 10]);
    expect(pages('-3', 10)).toEqual([1, 2, 3]);
  });

  it('accepts keywords', () => {
    expect(pages('all', 4)).toEqual([1, 2, 3, 4]);
    expect(pages('odd', 5)).toEqual([1, 3, 5]);
    expect(pages('even', 5)).toEqual([2, 4]);
    expect(pages('last', 7)).toEqual([7]);
    expect(pages('5-last', 7)).toEqual([5, 6, 7]);
    expect(pages('first, last', 7)).toEqual([1, 7]);
    expect(pages('ODD', 3)).toEqual([1, 3]);
  });

  it('handles descending ranges', () => {
    expect(pages('5-3', 10)).toEqual([5, 4, 3]);
    expect(pages('last-8', 10)).toEqual([10, 9, 8]);
  });

  it('tolerates whitespace, dashes and separators', () => {
    expect(pages('  1 - 3 ;  5 ', 10)).toEqual([1, 2, 3, 5]);
    expect(pages('1–3', 10)).toEqual([1, 2, 3]);
    expect(pages('1—2', 10)).toEqual([1, 2]);
    expect(pages('2 to 4', 10)).toEqual([2, 3, 4]);
    expect(pages('1 3 5', 10)).toEqual([1, 3, 5]);
    expect(pages('1,,2,', 10)).toEqual([1, 2]);
  });

  it('accepts pasted Unicode hyphens and full-width input', () => {
    expect(pages('1‐3', 10)).toEqual([1, 2, 3]); // U+2010 hyphen (word processors)
    expect(pages('2‑4', 10)).toEqual([2, 3, 4]); // U+2011 non-breaking hyphen
    expect(pages('５－７，９', 10)).toEqual([5, 6, 7, 9]); // full-width digits, hyphen and comma
    expect(pages('1−2', 10)).toEqual([1, 2]); // U+2212 minus sign
  });

  it('removes duplicates by default but can keep them', () => {
    expect(pages('1-3, 2, 1', 10)).toEqual([1, 2, 3]);
    expect(pages('1, 1, 2', 10, false)).toEqual([1, 1, 2]);
    expect(pages('odd, all', 4)).toEqual([1, 3, 2, 4]);
  });

  it('rejects out-of-range pages with a clear message', () => {
    expect(error('12', 10)).toMatch(/Page 12 does not exist: the document has 10 pages/);
    expect(error('0', 10)).toMatch(/start at 1/);
    expect(error('3-20', 10)).toMatch(/Page 20/);
    expect(error('2', 1)).toMatch(/1 page\./);
  });

  it('rejects invalid tokens', () => {
    expect(error('abc', 10)).toMatch(/"abc" is not a page number/);
    expect(error('1-2-3', 10)).toMatch(/not a valid range/);
    expect(error('-', 10)).toMatch(/not a valid range/);
    expect(error('1.5', 10)).toMatch(/not a page number/);
    expect(error('📄', 10)).toMatch(/not a page number/);
  });

  it('reports empty input and empty documents', () => {
    expect(error('', 10)).toMatch(/Enter the pages/);
    expect(error('   ', 10)).toMatch(/Enter the pages/);
    expect(error(',,', 10)).toMatch(/no pages/);
    expect(error('even', 1)).toMatch(/no pages/);
    expect(parsePageRange('1', 0).ok).toBe(false);
  });

  it('handles large documents quickly', () => {
    const r = parsePageRange('1-100000, odd', 100000);
    expect(r.ok && r.pages.length).toBe(100000);
  });
});

describe('parseRangeGroups', () => {
  it('turns each comma-separated item into a group', () => {
    const r = parseRangeGroups('1-3, 4-6, 7-', 8);
    expect(r).toEqual({ ok: true, groups: [[1, 2, 3], [4, 5, 6], [7, 8]] });
  });

  it('supports keywords per group', () => {
    const r = parseRangeGroups('odd; even', 4);
    expect(r).toEqual({ ok: true, groups: [[1, 3], [2, 4]] });
  });

  it('rejects whitespace-separated items and invalid pages', () => {
    expect(parseRangeGroups('1 2', 4).ok).toBe(false);
    expect(parseRangeGroups('1-9', 4).ok).toBe(false);
    expect(parseRangeGroups('', 4).ok).toBe(false);
  });
});

describe('chunkPages', () => {
  it('splits every N pages', () => {
    expect(chunkPages(7, 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    expect(chunkPages(2, 5)).toEqual([[1, 2]]);
    expect(chunkPages(3, 1)).toEqual([[1], [2], [3]]);
  });
  it('returns nothing for invalid sizes', () => {
    expect(chunkPages(5, 0)).toEqual([]);
    expect(chunkPages(5, 1.5)).toEqual([]);
    expect(chunkPages(0, 2)).toEqual([]);
  });
});

describe('formatPageList', () => {
  it('compresses consecutive runs', () => {
    expect(formatPageList([1, 2, 3, 5, 7, 8])).toBe('1-3, 5, 7-8');
    expect(formatPageList([])).toBe('');
    expect(formatPageList([4])).toBe('4');
    expect(formatPageList([3, 2, 1])).toBe('3, 2, 1');
  });
  it('round-trips through the parser', () => {
    const list = [1, 2, 3, 9, 10, 20];
    expect(pages(formatPageList(list), 20)).toEqual(list);
  });
});
