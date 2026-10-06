import { describe, expect, it } from 'vitest';
import { selectDocuments, formatSize } from './libraryModel';
import type { ReaderDocument } from './storage';
const files: ReaderDocument[] = [
  { id: 'a', name: 'Alpha.pdf', size: 100, pages: 2, addedAt: 10, lastOpened: 100, page: 1, offset: 0, favorite: true, bookmarks: [], cached: true },
  { id: 'b', name: 'Beta.pdf', size: 200, pages: 3, addedAt: 20, lastOpened: 30, page: 1, offset: 0, favorite: false, bookmarks: [], cached: false },
];
describe('PDF file management', () => {
  it('keeps addition order independent of opening and never mutates source records', () => {
    expect(selectDocuments(files, '', 'all', 'added').map((r) => r.id)).toEqual(['b', 'a']);
    expect(selectDocuments(files, '', 'all', 'opened').map((r) => r.id)).toEqual(['a', 'b']);
    expect(files.map((r) => r.id)).toEqual(['a', 'b']);
  });
  it('searches filenames with case and whitespace normalization', () => {
    expect(selectDocuments(files, ' ALPHA ', 'all', 'name').map((r) => r.id)).toEqual(['a']);
    expect(selectDocuments(files, 'missing', 'all', 'name')).toEqual([]);
  });
  it('combines favorites, availability and search without leaking other files', () => {
    expect(selectDocuments(files, '', 'favorites', 'name').map((r) => r.id)).toEqual(['a']);
    expect(selectDocuments(files, '', 'saved', 'name').map((r) => r.id)).toEqual(['a']);
    expect(selectDocuments(files, '', 'missing', 'name').map((r) => r.id)).toEqual(['b']);
    expect(selectDocuments(files, 'Beta', 'favorites', 'name')).toEqual([]);
  });
  it('sorts by names and descending size', () => {
    expect(selectDocuments([...files].reverse(), '', 'all', 'name').map((r) => r.id)).toEqual(['a', 'b']);
    expect(selectDocuments(files, '', 'all', 'size').map((r) => r.id)).toEqual(['b', 'a']);
  });
  it('supports metadata migrated from earlier reader versions', () => {
    expect(selectDocuments([{ ...files[0], addedAt: undefined }, files[1]], '', 'all', 'added')[0].id).toBe('a');
    expect(formatSize(1536)).toBe('2 KB'); expect(formatSize(1.5 * 1048576)).toBe('1.5 MB');
  });
});
