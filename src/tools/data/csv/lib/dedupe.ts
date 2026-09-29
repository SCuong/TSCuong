import type { Table } from './csv';

export interface DedupeOptions {
  /** Column indices that form the key. Empty = whole row. */
  columns?: number[];
  keep?: 'first' | 'last';
  ignoreCase?: boolean;
  trim?: boolean;
  /** Collapse runs of internal whitespace when comparing. */
  collapseWhitespace?: boolean;
}

export interface DedupeResult {
  table: Table;
  /** Rows that were removed, in original order. */
  removed: Table;
  removedCount: number;
  /** Number of distinct keys that occurred more than once. */
  duplicateGroups: number;
}

export function rowKey(row: string[], options: DedupeOptions): string {
  const { columns = [], ignoreCase = false, trim = false, collapseWhitespace = false } = options;
  const cells = columns.length ? columns.map((c) => row[c] ?? '') : row;
  const normalized = cells.map((cell) => {
    let v = cell;
    if (trim) v = v.trim();
    if (collapseWhitespace) v = v.replace(/\s+/g, ' ');
    if (ignoreCase) v = v.toLocaleLowerCase();
    return v;
  });
  return JSON.stringify(normalized);
}

/** Remove duplicate rows, keeping either the first or the last occurrence of each key (original order preserved). */
export function dedupe(table: Table, options: DedupeOptions = {}): DedupeResult {
  const keep = options.keep ?? 'first';
  const keys = table.rows.map((r) => rowKey(r, options));
  const counts = new Map<string, number>();
  for (const k of keys) counts.set(k, (counts.get(k) ?? 0) + 1);
  const chosen = new Map<string, number>();
  if (keep === 'first') {
    keys.forEach((k, i) => {
      if (!chosen.has(k)) chosen.set(k, i);
    });
  } else {
    keys.forEach((k, i) => chosen.set(k, i));
  }
  const kept: string[][] = [];
  const removed: string[][] = [];
  keys.forEach((k, i) => (chosen.get(k) === i ? kept : removed).push(table.rows[i]));
  let duplicateGroups = 0;
  for (const c of counts.values()) if (c > 1) duplicateGroups++;
  return {
    table: { headers: table.headers, rows: kept },
    removed: { headers: table.headers, rows: removed },
    removedCount: removed.length,
    duplicateGroups,
  };
}
