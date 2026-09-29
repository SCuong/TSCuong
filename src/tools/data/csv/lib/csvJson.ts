import { defaultColumnName, uniqueHeaders, type Table } from './csv';

// ---------------------------------------------------------------------------
// CSV → JSON
// ---------------------------------------------------------------------------

const JSON_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

/**
 * Convert a cell to a JSON value: numbers (only if they round-trip exactly and
 * have no leading zeros, so ZIP codes and IDs stay strings), true/false, null.
 * Empty cells become null.
 */
export function inferValue(cell: string): string | number | boolean | null {
  if (cell === '') return null;
  if (JSON_NUMBER.test(cell)) {
    const n = Number(cell);
    if (Number.isFinite(n)) {
      if (/^-?\d+$/.test(cell)) return Number.isSafeInteger(n) ? n : cell;
      return n;
    }
    return cell;
  }
  if (cell === 'true' || cell === 'TRUE' || cell === 'True') return true;
  if (cell === 'false' || cell === 'FALSE' || cell === 'False') return false;
  if (cell === 'null' || cell === 'NULL') return null;
  return cell;
}

export type CsvJsonShape = 'objects' | 'arrays' | 'columns';

export interface CsvToJsonOptions {
  shape?: CsvJsonShape;
  /** Convert numbers, booleans and empty cells (→ null). */
  typed?: boolean;
  /** Build nested objects from dotted headers like `address.city` (objects shape only). */
  nest?: boolean;
  separator?: string;
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/**
 * Objects built from user-supplied column names have no prototype, so names
 * like `__proto__` or `constructor` are ordinary keys (no prototype pollution).
 */
function emptyObject(): Record<string, Json> {
  return Object.create(null) as Record<string, Json>;
}

function isPlainObject(v: unknown): v is Record<string, Json> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Set `value` at a dotted path inside `target`. Numeric segments create arrays.
 * Returns false (and changes nothing) if the path collides with an existing scalar.
 */
function setPath(target: Record<string, Json>, segments: string[], value: Json): boolean {
  let node: Record<string, Json> | Json[] = target;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const last = i === segments.length - 1;
    if (Array.isArray(node) && !/^\d+$/.test(seg)) return false;
    const key: string | number = Array.isArray(node) ? Number(seg) : seg;
    const current: Json | undefined = (node as Record<string | number, Json>)[key];
    if (last) {
      if (current !== undefined) return false;
      (node as Record<string | number, Json>)[key] = value;
      return true;
    }
    const wantArray = /^\d+$/.test(segments[i + 1]) && Number(segments[i + 1]) < 10_000;
    if (current === undefined) {
      const child: Record<string, Json> | Json[] = wantArray ? [] : emptyObject();
      (node as Record<string | number, Json>)[key] = child;
      node = child;
    } else if (Array.isArray(current) ? wantArray : isPlainObject(current) && !wantArray) {
      node = current as Record<string, Json> | Json[];
    } else {
      return false;
    }
  }
  return true;
}

function rowObject(headers: string[], row: string[], options: CsvToJsonOptions): Record<string, Json> {
  const { typed = true, nest = false, separator = '.' } = options;
  const out = emptyObject();
  headers.forEach((h, i) => {
    const raw = row[i] ?? '';
    const value = typed ? inferValue(raw) : raw;
    if (nest && separator && h.includes(separator)) {
      const segments = h.split(separator);
      if (segments.every((s) => s !== '') && setPath(out, segments, value)) return;
    }
    // A flat column can collide with the root of a nested one ("a" and "a.b"): keep both.
    let key = h;
    for (let n = 2; Object.hasOwn(out, key); n++) key = `${h}_${n}`;
    out[key] = value;
  });
  // Sparse arrays from nesting (e.g. only tags.2 set) → fill holes with null.
  const fill = (v: Json): Json => {
    if (Array.isArray(v)) return Array.from(v, (x) => (x === undefined ? null : fill(x)));
    if (isPlainObject(v)) for (const k of Object.keys(v)) v[k] = fill(v[k]);
    return v;
  };
  return fill(out) as Record<string, Json>;
}

export function tableToJsonValue(table: Table, options: CsvToJsonOptions = {}): Json {
  const { shape = 'objects', typed = true } = options;
  const headers = uniqueHeaders(table.headers);
  const cell = (v: string): Json => (typed ? inferValue(v) : v);
  if (shape === 'arrays') {
    return [table.headers.slice(), ...table.rows.map((r) => r.map(cell))];
  }
  if (shape === 'columns') {
    const out = emptyObject();
    headers.forEach((h, i) => {
      out[h] = table.rows.map((r) => cell(r[i] ?? ''));
    });
    return out;
  }
  return table.rows.map((r) => rowObject(headers, r, options));
}

export type JsonIndent = '2' | '4' | 'tab' | 'min';

export function stringify(value: unknown, indent: JsonIndent = '2'): string {
  return JSON.stringify(value, null, indent === 'min' ? undefined : indent === 'tab' ? '\t' : Number(indent));
}

// ---------------------------------------------------------------------------
// JSON → CSV
// ---------------------------------------------------------------------------

export type ArrayMode = 'json' | 'join' | 'index';

export interface JsonToTableOptions {
  /** Flatten nested objects into `parent.child` columns (otherwise they are JSON strings). */
  flatten?: boolean;
  arrays?: ArrayMode;
  separator?: string;
  joinWith?: string;
  /** For arrays of arrays: use the first inner array as the header. */
  firstRowHeader?: boolean;
  /** Safety limit on columns created by flattening. */
  maxColumns?: number;
}

export interface JsonToTableResult {
  table: Table;
  /** Where the rows came from, e.g. `$` or `$.data.items`. */
  source: string;
  notes: string[];
}

function primitiveToCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'bigint') return String(v);
  return JSON.stringify(v);
}

function flattenInto(
  out: Map<string, string>,
  value: unknown,
  prefix: string,
  options: Required<Pick<JsonToTableOptions, 'flatten' | 'arrays' | 'separator' | 'joinWith'>>,
) {
  const key = (k: string) => (prefix ? `${prefix}${options.separator}${k}` : k);
  if (Array.isArray(value)) {
    if (options.arrays === 'index' && value.length > 0) {
      value.forEach((item, i) => flattenInto(out, item, key(String(i)), options));
      return;
    }
    if (options.arrays === 'join' && value.every((v) => v === null || typeof v !== 'object')) {
      out.set(prefix || 'value', value.map(primitiveToCell).join(options.joinWith));
      return;
    }
    out.set(prefix || 'value', JSON.stringify(value));
    return;
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (prefix && (!options.flatten || keys.length === 0)) {
      out.set(prefix, JSON.stringify(value));
      return;
    }
    for (const k of keys) flattenInto(out, value[k], key(k), { ...options, flatten: options.flatten });
    return;
  }
  out.set(prefix || 'value', primitiveToCell(value));
}

/** Find the most likely array of records inside a JSON document. */
export function locateRecords(value: unknown): { rows: unknown[]; path: string } | null {
  if (Array.isArray(value)) return { rows: value, path: '$' };
  if (!isPlainObject(value)) return null;
  let best: { rows: unknown[]; path: string } | null = null;
  const visit = (node: Record<string, unknown>, path: string, depth: number) => {
    for (const [k, v] of Object.entries(node)) {
      const p = /^[A-Za-z_$][\w$]*$/.test(k) ? `${path}.${k}` : `${path}[${JSON.stringify(k)}]`;
      if (Array.isArray(v) && v.length > 0 && v.every(isPlainObject)) {
        if (!best || v.length > best.rows.length) best = { rows: v, path: p };
      } else if (isPlainObject(v) && depth < 3) {
        visit(v, p, depth + 1);
      }
    }
  };
  visit(value, '$', 0);
  return best;
}

/** Convert parsed JSON into a table. */
export function jsonToTable(value: unknown, options: JsonToTableOptions = {}): JsonToTableResult {
  const opts = {
    flatten: options.flatten ?? true,
    arrays: options.arrays ?? 'json',
    separator: options.separator || '.',
    joinWith: options.joinWith ?? '; ',
  };
  const maxColumns = options.maxColumns ?? 5000;
  const notes: string[] = [];
  let rows: unknown[];
  let source = '$';
  if (Array.isArray(value)) {
    rows = value;
  } else if (isPlainObject(value)) {
    const found = locateRecords(value);
    if (found && found.path !== '$') {
      rows = found.rows;
      source = found.path;
      notes.push(`Using the ${found.rows.length} records found at ${found.path}.`);
    } else {
      rows = [value];
    }
  } else {
    throw new Error('Expected a JSON array or object, not a single value.');
  }

  if (rows.length === 0) return { table: { headers: [], rows: [] }, source, notes: ['The array is empty.'] };

  // Array of arrays → rows as-is.
  if (rows.every(Array.isArray)) {
    const arrays = rows as unknown[][];
    const cells = arrays.map((r) => r.map(primitiveToCell));
    const width = Math.max(0, ...cells.map((r) => r.length));
    const pad = (r: string[]) => (r.length < width ? [...r, ...Array(width - r.length).fill('')] : r);
    if (options.firstRowHeader) {
      const [head, ...rest] = cells;
      const headers = pad(head).map((h, i) => h || defaultColumnName(i));
      return { table: { headers, rows: rest.map(pad) }, source, notes };
    }
    return { table: { headers: Array.from({ length: width }, (_, i) => defaultColumnName(i)), rows: cells.map(pad) }, source, notes };
  }

  const headerIndex = new Map<string, number>();
  const flatRows: Map<string, string>[] = [];
  let mixed = 0;
  for (const item of rows) {
    const flat = new Map<string, string>();
    if (isPlainObject(item)) {
      flattenInto(flat, item, '', opts);
    } else {
      mixed++;
      flattenInto(flat, item, 'value', opts);
    }
    for (const k of flat.keys()) {
      if (!headerIndex.has(k)) {
        if (headerIndex.size >= maxColumns) {
          throw new Error(
            `Flattening produces more than ${maxColumns.toLocaleString()} columns. Turn off flattening or use JSON for arrays.`,
          );
        }
        headerIndex.set(k, headerIndex.size);
      }
    }
    flatRows.push(flat);
  }
  if (mixed && mixed < rows.length) notes.push(`${mixed} non-object item${mixed === 1 ? ' was' : 's were'} placed in a “value” column.`);
  const headers = [...headerIndex.keys()];
  const tableRows = flatRows.map((flat) => headers.map((h) => flat.get(h) ?? ''));
  return { table: { headers, rows: tableRows }, source, notes };
}
