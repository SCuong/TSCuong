import type { ReaderDocument } from './storage';
export type FileSort = 'added' | 'opened' | 'name' | 'size';
export type FileFilter = 'all' | 'favorites' | 'saved' | 'missing';
export function selectDocuments(documents: ReaderDocument[], query: string, filter: FileFilter, sort: FileSort) {
  return documents.filter((r) => r.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) &&
    (filter !== 'favorites' || r.favorite) && (filter !== 'saved' || r.cached) && (filter !== 'missing' || !r.cached))
    .sort((a, b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'size' ? b.size - a.size :
      sort === 'opened' ? b.lastOpened - a.lastOpened : (b.addedAt ?? b.lastOpened) - (a.addedAt ?? a.lastOpened));
}
export function formatSize(size: number) {
  return size < 1024 * 1024 ? (size / 1024).toFixed(0) + ' KB' : (size / 1024 / 1024).toFixed(1) + ' MB';
}
