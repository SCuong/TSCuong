/** Filtering and sorting of indexed files (pure, shared by the worker and tests). */

export type FileStatus = 'text' | 'binary' | 'too-large' | 'not-text' | 'empty' | 'error' | 'budget';

export interface FileMeta {
  id: number;
  /** Path relative to the indexed folder, "/"-separated. */
  path: string;
  name: string;
  ext: string;
  size: number;
  lastModified: number;
  status: FileStatus;
}

export interface SearchFilters {
  /** Lower-case extensions without dots; empty = all. "" stands for files without an extension. */
  exts: string[];
  minSize: number | null;
  maxSize: number | null;
  /** Inclusive range, epoch ms. */
  modifiedFrom: number | null;
  modifiedTo: number | null;
  pathContains: string;
}

export const EMPTY_FILTERS: SearchFilters = {
  exts: [],
  minSize: null,
  maxSize: null,
  modifiedFrom: null,
  modifiedTo: null,
  pathContains: '',
};

export type SortKey = 'relevance' | 'name' | 'path' | 'size' | 'modified';

export function hasActiveFilters(f: SearchFilters): boolean {
  return (
    f.exts.length > 0 || f.minSize !== null || f.maxSize !== null || f.modifiedFrom !== null || f.modifiedTo !== null || f.pathContains.trim() !== ''
  );
}

/** Build a predicate for the filters (pre-computing sets and lower-cased strings once). */
export function makeFilter(f: SearchFilters): (m: FileMeta) => boolean {
  const exts = f.exts.length ? new Set(f.exts) : null;
  const needle = f.pathContains.trim().toLowerCase().replace(/\\/g, '/');
  return (m) => {
    if (exts && !exts.has(m.ext)) return false;
    if (f.minSize !== null && m.size < f.minSize) return false;
    if (f.maxSize !== null && m.size > f.maxSize) return false;
    if (f.modifiedFrom !== null && m.lastModified < f.modifiedFrom) return false;
    if (f.modifiedTo !== null && m.lastModified > f.modifiedTo) return false;
    if (needle && !m.path.toLowerCase().includes(needle)) return false;
    return true;
  };
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function sortItems<T extends { meta: FileMeta; score: number }>(items: T[], sort: SortKey): T[] {
  const byName = (a: T, b: T) => collator.compare(a.meta.name, b.meta.name) || collator.compare(a.meta.path, b.meta.path);
  const cmp: Record<SortKey, (a: T, b: T) => number> = {
    relevance: (a, b) => b.score - a.score || byName(a, b),
    name: byName,
    path: (a, b) => collator.compare(a.meta.path, b.meta.path),
    size: (a, b) => b.meta.size - a.meta.size || byName(a, b),
    modified: (a, b) => b.meta.lastModified - a.meta.lastModified || byName(a, b),
  };
  return items.sort(cmp[sort]);
}

/**
 * Plain filename/path search: every word must occur in the path (case-insensitive).
 * Returns a score (0 = no match) that favours matches in the file name.
 */
export function scorePathMatch(meta: Pick<FileMeta, 'name' | 'path'>, words: string[]): number {
  if (!words.length) return 0;
  const name = meta.name.toLowerCase();
  const path = meta.path.toLowerCase();
  let score = 0;
  for (const w of words) {
    if (!path.includes(w)) return 0;
    if (name === w) score += 12;
    else if (name.startsWith(w)) score += 8;
    else if (name.includes(w)) score += 5;
    else score += 1;
  }
  // Shorter paths rank higher among equal matches.
  return score + 1 / (1 + path.length / 100);
}

/** Extensions and their counts, most common first. */
export function extensionCounts(metas: FileMeta[]): Array<{ ext: string; count: number }> {
  const counts = new Map<string, number>();
  for (const m of metas) counts.set(m.ext, (counts.get(m.ext) ?? 0) + 1);
  return [...counts.entries()].map(([ext, count]) => ({ ext, count })).sort((a, b) => b.count - a.count || a.ext.localeCompare(b.ext));
}

/** Parse "YYYY-MM-DD" from a date input as local time; `endOfDay` makes the range inclusive. */
export function parseDateInput(value: string, endOfDay = false): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}
