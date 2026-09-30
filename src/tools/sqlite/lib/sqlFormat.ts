import { quoteIdent, sqlLiteral, toHex, type SqlValue } from './sqlBuild';

export function base64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** A cell as JSON sees it: BLOBs become base64 strings; big integers stay exact (see {@link toJsonText}). */
export type JsonCell = string | number | bigint | null;

/** Convert a cell to a JSON-friendly value (BLOBs become base64 strings). */
export function jsonValue(value: SqlValue): JsonCell {
  if (value instanceof Uint8Array) return base64(value);
  return value;
}

/**
 * `JSON.stringify` that writes BigInt values as exact JSON numbers
 * (JSON.stringify alone throws on BigInt, and Number() would round them).
 */
export function toJsonText(value: unknown, space?: number): string {
  const marker = `@@lk-bigint-${Math.random().toString(36).slice(2)}:`;
  const text = JSON.stringify(value, (_key, v: unknown) => (typeof v === 'bigint' ? `${marker}${v.toString()}` : v), space);
  return text.replace(new RegExp(`"${marker}(-?\\d+)"`, 'g'), '$1');
}

/** Plain text for a cell, as used in CSV/TSV/clipboard (BLOBs become 0x-prefixed hex). */
export function textValue(value: SqlValue): string {
  if (value === null) return '';
  if (value instanceof Uint8Array) return `0x${toHex(value)}`;
  return String(value);
}

function csvField(text: string): string {
  return /[",\r\n]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(columns: string[], rows: SqlValue[][]): string {
  const lines = [columns.map(csvField).join(',')];
  for (const row of rows) lines.push(row.map((v) => csvField(textValue(v))).join(','));
  return lines.join('\r\n') + '\r\n';
}

function tsvField(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\r?\n/g, '\\n');
}

export function rowToTsv(row: SqlValue[]): string {
  return row.map((v) => tsvField(textValue(v))).join('\t');
}

export function toTsv(columns: string[], rows: SqlValue[][]): string {
  return [columns.map(tsvField).join('\t'), ...rows.map(rowToTsv)].join('\n');
}

export function rowToObject(columns: string[], row: SqlValue[]): Record<string, JsonCell> {
  const obj: Record<string, JsonCell> = {};
  columns.forEach((c, i) => {
    // Duplicate column names (e.g. from joins) get a numeric suffix so no value is lost.
    let key = c;
    let n = 2;
    while (Object.prototype.hasOwnProperty.call(obj, key)) key = `${c}_${n++}`;
    obj[key] = jsonValue(row[i] ?? null);
  });
  return obj;
}

export function toJson(columns: string[], rows: SqlValue[][]): string {
  return toJsonText(
    rows.map((r) => rowToObject(columns, r)),
    2,
  );
}

/**
 * INSERT statements for a table, preceded by its CREATE statement.
 * `columns` must not include generated columns (SQLite refuses to insert into them).
 */
export function toSqlDump(table: string, createSql: string | null, columns: string[], rows: SqlValue[][]): string {
  const out: string[] = [];
  if (createSql) out.push(`${createSql.trim().replace(/;?$/, ';')}`);
  if (rows.length) {
    const cols = columns.map(quoteIdent).join(', ');
    out.push('BEGIN TRANSACTION;');
    for (const row of rows) {
      out.push(`INSERT INTO ${quoteIdent(table)} (${cols}) VALUES (${row.map(sqlLiteral).join(', ')});`);
    }
    out.push('COMMIT;');
  }
  return out.join('\n') + '\n';
}

export type CellKind = 'null' | 'integer' | 'real' | 'text' | 'blob';

export function cellKind(value: SqlValue): CellKind {
  if (value === null) return 'null';
  if (value instanceof Uint8Array) return 'blob';
  if (typeof value === 'bigint') return 'integer';
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'real';
  return 'text';
}

/** Short single-line preview for grid cells. */
export function cellPreview(value: SqlValue, max = 160): string {
  if (value === null) return 'NULL';
  if (value instanceof Uint8Array) return `BLOB · ${formatSize(value.length)}`;
  const text = String(value);
  const flat = text.length > max * 2 ? text.slice(0, max * 2) : text;
  const oneLine = flat.replace(/\s*\r?\n\s*/g, ' ↵ ');
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Classic hex dump (offset, 16 bytes, ASCII) of the first `max` bytes. */
export function hexDump(bytes: Uint8Array, max = 256): string {
  const lines: string[] = [];
  const len = Math.min(max, bytes.length);
  for (let off = 0; off < len; off += 16) {
    const slice = bytes.subarray(off, Math.min(off + 16, len));
    const hex = Array.from(slice, (b) => b.toString(16).padStart(2, '0')).join(' ');
    const ascii = Array.from(slice, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('');
    lines.push(`${off.toString(16).padStart(8, '0')}  ${hex.padEnd(47)}  ${ascii}`);
  }
  if (bytes.length > len) lines.push(`… ${bytes.length - len} more bytes`);
  return lines.join('\n');
}
