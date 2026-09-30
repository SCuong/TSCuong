import { defaultColumnName, type Table } from './csv';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const NUM = /^\s*[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?\s*$/;
/** 1,234,567.89 — thousands separators as spreadsheets and English locales write them. */
const GROUPED = /^\s*[+-]?\d{1,3}(,\d{3})+(\.\d+)?\s*$/;

/** The numeric value of a cell such as "42", "-1.5e3" or "1,234.50"; NaN for anything else. */
export function cellNumber(value: string): number {
  if (NUM.test(value)) return Number(value);
  if (GROUPED.test(value)) return Number(value.replace(/,/g, ''));
  return NaN;
}

/** Compare two cell strings: numbers numerically, empty cells last, text with natural ordering. */
export function compareCells(a: string, b: string): number {
  const ea = a === '';
  const eb = b === '';
  if (ea || eb) return ea === eb ? 0 : ea ? 1 : -1;
  const x = cellNumber(a);
  const y = cellNumber(b);
  if (!Number.isNaN(x) && !Number.isNaN(y)) return x < y ? -1 : x > y ? 1 : 0;
  return collator.compare(a, b);
}

export interface SortState {
  column: number;
  dir: 'asc' | 'desc';
}

export interface ViewOptions {
  filter?: string;
  /** -1 or undefined = all columns. */
  filterColumn?: number;
  caseSensitive?: boolean;
  sort?: SortState | null;
}

/**
 * Indices of rows to show, after filtering and a stable sort. Empty cells
 * always sort last, regardless of direction.
 */
export function viewIndices(table: Table, options: ViewOptions = {}): number[] {
  const { filter = '', filterColumn = -1, caseSensitive = false, sort } = options;
  let indices: number[] = [];
  const needle = caseSensitive ? filter : filter.toLowerCase();
  if (!needle) {
    indices = Array.from({ length: table.rows.length }, (_, i) => i);
  } else {
    for (let i = 0; i < table.rows.length; i++) {
      const row = table.rows[i];
      const hit =
        filterColumn >= 0
          ? contains(row[filterColumn] ?? '', needle, caseSensitive)
          : row.some((cell) => contains(cell, needle, caseSensitive));
      if (hit) indices.push(i);
    }
  }
  if (sort && sort.column >= 0 && sort.column < table.headers.length) {
    const col = sort.column;
    const sign = sort.dir === 'asc' ? 1 : -1;
    // Keys are computed once per row (not on every comparison): large tables sort several times faster.
    const n = indices.length;
    const values = new Array<string>(n);
    const numbers = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      const v = table.rows[indices[k]][col] ?? '';
      values[k] = v;
      numbers[k] = v === '' ? NaN : cellNumber(v);
    }
    const order = Array.from({ length: n }, (_, k) => k);
    order.sort((p, q) => {
      const a = values[p];
      const b = values[q];
      const ea = a === '';
      const eb = b === '';
      // Empty cells always sort last, regardless of direction; ties keep row order.
      if (ea || eb) return ea === eb ? p - q : ea ? 1 : -1;
      const x = numbers[p];
      const y = numbers[q];
      const d = !Number.isNaN(x) && !Number.isNaN(y) ? (x < y ? -1 : x > y ? 1 : 0) : collator.compare(a, b);
      return d * sign || p - q;
    });
    indices = order.map((k) => indices[k]);
  }
  return indices;
}

function contains(cell: string, needle: string, caseSensitive: boolean): boolean {
  return (caseSensitive ? cell : cell.toLowerCase()).includes(needle);
}

export function pickRows(table: Table, indices: number[]): Table {
  return { headers: table.headers, rows: indices.map((i) => table.rows[i]) };
}

export function setCell(table: Table, row: number, col: number, value: string): Table {
  if (table.rows[row]?.[col] === value) return table;
  const rows = table.rows.slice();
  const next = rows[row].slice();
  next[col] = value;
  rows[row] = next;
  return { headers: table.headers, rows };
}

export function renameColumn(table: Table, col: number, name: string): Table {
  const headers = table.headers.slice();
  headers[col] = name;
  return { headers, rows: table.rows };
}

export function insertRow(table: Table, at: number): Table {
  const rows = table.rows.slice();
  rows.splice(
    Math.max(0, Math.min(at, rows.length)),
    0,
    table.headers.map(() => ''),
  );
  return { headers: table.headers, rows };
}

export function deleteRows(table: Table, indices: number[]): Table {
  const drop = new Set(indices);
  return { headers: table.headers, rows: table.rows.filter((_, i) => !drop.has(i)) };
}

export function insertColumn(table: Table, at: number, name?: string): Table {
  const pos = Math.max(0, Math.min(at, table.headers.length));
  const headers = table.headers.slice();
  headers.splice(pos, 0, name ?? nextColumnName(table.headers));
  const rows = table.rows.map((r) => {
    const next = r.slice();
    next.splice(pos, 0, '');
    return next;
  });
  return { headers, rows };
}

export function deleteColumn(table: Table, col: number): Table {
  const headers = table.headers.filter((_, i) => i !== col);
  const rows = table.rows.map((r) => r.filter((_, i) => i !== col));
  return { headers, rows };
}

export function moveColumn(table: Table, from: number, to: number): Table {
  if (from === to || to < 0 || to >= table.headers.length) return table;
  const move = <T>(arr: T[]) => {
    const next = arr.slice();
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  };
  return { headers: move(table.headers), rows: table.rows.map(move) };
}

function nextColumnName(headers: string[]): string {
  const taken = new Set(headers);
  let i = headers.length;
  while (taken.has(defaultColumnName(i))) i++;
  return defaultColumnName(i);
}

/** Use the first data row as the header row. */
export function promoteHeader(table: Table): Table {
  if (!table.rows.length) return table;
  return { headers: table.rows[0].slice(), rows: table.rows.slice(1) };
}

/** Turn the header row back into the first data row and generate column names. */
export function demoteHeader(table: Table): Table {
  return { headers: table.headers.map((_, i) => defaultColumnName(i)), rows: [table.headers.slice(), ...table.rows] };
}

/** Remove columns at the end whose header is generated/empty and every cell is empty. */
export function trimEmptyTrailingColumns(table: Table): Table {
  let width = table.headers.length;
  while (width > 0) {
    const col = width - 1;
    const header = table.headers[col];
    const emptyHeader = !header || header === defaultColumnName(col);
    if (!emptyHeader || table.rows.some((r) => (r[col] ?? '') !== '')) break;
    width--;
  }
  if (width === table.headers.length) return table;
  return { headers: table.headers.slice(0, width), rows: table.rows.map((r) => r.slice(0, width)) };
}
