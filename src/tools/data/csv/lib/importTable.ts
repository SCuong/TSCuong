import { parseCsv, type Table } from './csv';
import { parseMarkdownTable, type Align } from './markdownTable';

export interface ImportedTable {
  table: Table;
  align: Align[];
  format: 'markdown' | 'csv';
  /** Delimiter used for CSV input. */
  delimiter?: string;
}

/**
 * Read pasted text as a table: a Markdown (GFM) table if one is present,
 * otherwise CSV/TSV with an auto-detected delimiter. Returns null for blank input.
 */
export function importTable(text: string, header = true): ImportedTable | null {
  if (!text.trim()) return null;
  const md = parseMarkdownTable(text);
  if (md) return { table: md.table, align: md.align, format: 'markdown' };
  const parsed = parseCsv(text, { header });
  if (!parsed.table.headers.length) return null;
  return { table: parsed.table, align: parsed.table.headers.map(() => 'none'), format: 'csv', delimiter: parsed.delimiter };
}

/** A blank table of the given size with generated header names. */
export function blankTable(cols: number, rows: number): Table {
  return {
    headers: Array.from({ length: cols }, (_, i) => `Header ${i + 1}`),
    rows: Array.from({ length: rows }, () => Array.from({ length: cols }, () => '')),
  };
}

/** Make every row exactly as wide as the header (defensive for persisted state). */
export function normalizeTable(table: Table): Table {
  const width = table.headers.length;
  let changed = false;
  const rows = table.rows.map((r) => {
    if (r.length === width) return r;
    changed = true;
    const next = r.slice(0, width);
    while (next.length < width) next.push('');
    return next;
  });
  return changed ? { headers: table.headers, rows } : table;
}
