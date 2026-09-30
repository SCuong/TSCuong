import { parseCsv, uniqueHeaders } from '@/tools/data/csv/lib/csv';
import { parseJson, stripBom } from '@/tools/json/lib/json';
import { t } from '@/lib/i18n';

/** Target databases for generated INSERT statements (MariaDB uses the MySQL rules). */
export type InsertDialect = 'ansi' | 'postgresql' | 'mysql' | 'sqlite' | 'sqlserver' | 'oracle';

/** 'auto' uses the dialect's usual quote; 'minimal' quotes only names that need it. */
export type IdentifierQuoting = 'auto' | 'double' | 'backtick' | 'bracket' | 'minimal';

export const INSERT_DIALECTS: Array<{ value: InsertDialect; label: string }> = [
  { value: 'postgresql', label: t('PostgreSQL') },
  { value: 'mysql', label: t('MySQL / MariaDB') },
  { value: 'sqlite', label: t('SQLite') },
  { value: 'sqlserver', label: t('SQL Server') },
  { value: 'oracle', label: t('Oracle') },
  { value: 'ansi', label: t('Standard SQL') },
];

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

export type SqlValue =
  | { kind: 'null' }
  | { kind: 'bool'; value: boolean }
  /** A numeric literal exactly as written in the source. */
  | { kind: 'number'; text: string }
  | { kind: 'string'; value: string }
  /** A nested object or array, serialized as compact JSON text. */
  | { kind: 'json'; value: string };

export interface Dataset {
  columns: string[];
  rows: SqlValue[][];
  notes: string[];
}

const NULL: SqlValue = { kind: 'null' };

/** A JSON number carrying its source text, so 1.50 and 12345678901234567890 are written exactly. */
class RawNumber {
  readonly text: string;
  constructor(text: string) {
    this.text = text;
  }
}

interface ReviverContext {
  source?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof RawNumber);
}

/** Compact JSON text that writes RawNumbers verbatim. */
function toJsonText(v: unknown): string {
  if (v instanceof RawNumber) return v.text;
  if (Array.isArray(v)) return `[${v.map(toJsonText).join(',')}]`;
  if (isRecord(v)) return `{${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}:${toJsonText(x)}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}

function toSqlValue(v: unknown): SqlValue {
  if (v === null || v === undefined) return NULL;
  if (v instanceof RawNumber) return { kind: 'number', text: v.text };
  if (typeof v === 'boolean') return { kind: 'bool', value: v };
  if (typeof v === 'string') return { kind: 'string', value: v };
  return { kind: 'json', value: toJsonText(v) };
}

/** Find the largest array of objects inside an object (e.g. `{ "data": { "items": [...] } }`). */
function locateRecords(value: Record<string, unknown>): { rows: unknown[]; path: string } | null {
  let best: { rows: unknown[]; path: string } | null = null;
  const visit = (node: Record<string, unknown>, path: string, depth: number) => {
    for (const [k, v] of Object.entries(node)) {
      const p = /^[A-Za-z_$][\w$]*$/.test(k) ? `${path}.${k}` : `${path}[${JSON.stringify(k)}]`;
      if (Array.isArray(v) && v.length > 0 && v.every(isRecord)) {
        if (!best || v.length > best.rows.length) best = { rows: v, path: p };
      } else if (isRecord(v) && depth < 3) {
        visit(v, p, depth + 1);
      }
    }
  };
  visit(value, '$', 0);
  return best;
}

export type DatasetResult = { ok: true; data: Dataset } | { ok: false; error: { message: string; line?: number; column?: number } };

function nameColumns(raw: string[], notes: string[]): string[] {
  let renamed = 0;
  const named = raw.map((c) => {
    if (c.trim()) return c;
    renamed++;
    return '';
  });
  if (renamed) notes.push(`${renamed} empty column name${renamed === 1 ? ' was' : 's were'} replaced with column_N.`);
  return uniqueHeaders(named);
}

/** Read records from JSON: an array of objects, one object, or an object that contains an array of objects. */
export function datasetFromJson(input: string): DatasetResult {
  const text = stripBom(input);
  if (!text.trim()) return { ok: false, error: { message: 'Input is empty' } };
  let value: unknown;
  let lossy = false;
  try {
    value = JSON.parse(text, function (this: unknown, _key: string, v: unknown, context?: ReviverContext) {
      if (typeof v !== 'number') return v;
      if (context?.source !== undefined) return new RawNumber(context.source);
      if (Number.isInteger(v) && !Number.isSafeInteger(v)) lossy = true;
      return new RawNumber(String(v));
    } as (key: string, value: unknown) => unknown);
  } catch {
    const parsed = parseJson(text);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    return { ok: false, error: { message: 'Invalid JSON' } };
  }
  const notes: string[] = [];
  if (lossy) notes.push('Some integers are larger than 2^53. This browser cannot read them exactly, so their last digits may have changed.');

  let records: unknown[];
  if (Array.isArray(value)) {
    records = value;
  } else if (isRecord(value)) {
    const found = locateRecords(value);
    if (found) {
      records = found.rows;
      notes.push(`Using the ${found.rows.length.toLocaleString('en-US')} records found at ${found.path}.`);
    } else {
      records = [value];
    }
  } else {
    return { ok: false, error: { message: 'Expected a JSON array of objects (or an object), not a single value.' } };
  }
  if (records.length === 0) return { ok: true, data: { columns: [], rows: [], notes: [...notes, 'The array is empty, so there is nothing to insert.'] } };

  // Arrays of arrays become positional columns.
  if (records.every(Array.isArray)) {
    const width = Math.max(...(records as unknown[][]).map((r) => r.length));
    const columns = Array.from({ length: width }, (_, i) => `column_${i + 1}`);
    notes.push('The records are arrays, so columns were named column_1, column_2, …');
    const rows = (records as unknown[][]).map((r) => columns.map((_, i) => toSqlValue(r[i])));
    return { ok: true, data: { columns, rows, notes } };
  }

  const index = new Map<string, number>();
  let scalars = 0;
  for (const r of records) {
    if (isRecord(r)) {
      for (const k of Object.keys(r)) if (!index.has(k)) index.set(k, index.size);
    } else {
      scalars++;
    }
  }
  if (scalars && !index.has('value')) index.set('value', index.size);
  const keys = [...index.keys()];
  let incomplete = 0;
  const rows = records.map((r) => {
    if (!isRecord(r)) return keys.map((k) => (k === 'value' ? toSqlValue(r) : NULL));
    let missing = false;
    const row = keys.map((k) => {
      if (!Object.hasOwn(r, k)) {
        missing = true;
        return NULL;
      }
      return toSqlValue(r[k]);
    });
    if (missing) incomplete++;
    return row;
  });
  if (scalars) notes.push(`${scalars.toLocaleString('en-US')} non-object item${scalars === 1 ? ' was' : 's were'} placed in a "value" column.`);
  if (incomplete) notes.push(`${incomplete.toLocaleString('en-US')} record${incomplete === 1 ? ' lacks' : 's lack'} some keys; the missing values are NULL.`);
  return { ok: true, data: { columns: nameColumns(keys, notes), rows, notes } };
}

const CSV_NUMBER = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** Interpret a CSV cell. Numbers keep their exact text; leading zeros (ZIP codes, IDs) stay strings. */
export function csvCell(cell: string, detectTypes: boolean, emptyAsNull: boolean): SqlValue {
  if (cell === '') return emptyAsNull ? NULL : { kind: 'string', value: '' };
  if (detectTypes) {
    if (CSV_NUMBER.test(cell)) return { kind: 'number', text: cell };
    const lower = cell.toLowerCase();
    if (lower === 'true' || lower === 'false') return { kind: 'bool', value: lower === 'true' };
    if (cell === 'NULL' || cell === 'null') return NULL;
  }
  return { kind: 'string', value: cell };
}

export interface CsvDatasetOptions {
  /** Empty = auto-detect. */
  delimiter?: string;
  detectTypes: boolean;
  emptyAsNull: boolean;
}

export function datasetFromCsv(input: string, options: CsvDatasetOptions): DatasetResult {
  if (!stripBom(input).trim()) return { ok: false, error: { message: 'Input is empty' } };
  const parsed = parseCsv(input, { delimiter: options.delimiter ?? '', header: true });
  const notes: string[] = [];
  for (const issue of parsed.issues.slice(0, 3)) notes.push(issue.row ? `Row ${issue.row}: ${issue.message}` : issue.message);
  if (parsed.raggedRows) {
    notes.push(
      `${parsed.raggedRows.toLocaleString('en-US')} row${parsed.raggedRows === 1 ? ' has' : 's have'} a different number of cells than the widest row; missing cells are treated as empty.`,
    );
  }
  const columns = nameColumns(parsed.table.headers, notes);
  const rows = parsed.table.rows.map((r) => r.map((cell) => csvCell(cell, options.detectTypes, options.emptyAsNull)));
  if (!rows.length) notes.push('The CSV has a header row but no data rows.');
  return { ok: true, data: { columns, rows, notes } };
}

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

const RESERVED = new Set(
  (
    'ACCESS ADD ALL ALTER AND ANY AS ASC AUDIT BEGIN BETWEEN BY CASCADE CASE CAST CHECK CLUSTER COLLATE COLUMN COMMENT COMMIT ' +
    'COMPRESS CONNECT CONSTRAINT CREATE CROSS CURRENT CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP CURRENT_USER CURSOR DATABASE ' +
    'DATE DECIMAL DEFAULT DELETE DESC DISTINCT DOUBLE DROP ELSE END ESCAPE EXCEPT EXCLUSIVE EXEC EXECUTE EXISTS FALSE FETCH FILE ' +
    'FLOAT FOR FOREIGN FROM FULL FUNCTION GRANT GROUP HAVING IDENTIFIED IDENTITY IF IMMEDIATE IN INCREMENT INDEX INITIAL INNER ' +
    'INSERT INTEGER INTERSECT INTERVAL INTO IS JOIN KEY LEFT LEVEL LIKE LIMIT LOCK LONG MAXEXTENTS MERGE MINUS MODE MODIFY NATURAL ' +
    'NOAUDIT NOCOMPRESS NOT NOWAIT NULL NUMBER OF OFF OFFLINE OFFSET ON ONLINE OPTION OR ORDER OUTER OVER PCTFREE PERCENT PRIMARY ' +
    'PRIOR PRIVILEGES PROCEDURE PUBLIC RANGE RAW READ REFERENCES RENAME RESOURCE RETURN REVOKE RIGHT ROLLBACK ROW ROWID ROWNUM ' +
    'ROWS SCHEMA SELECT SESSION SET SHARE SIZE SMALLINT SOME START SUCCESSFUL SYNONYM SYSDATE TABLE THEN TO TOP TRANSACTION TRIGGER ' +
    'TRUE TRUNCATE UID UNION UNIQUE UPDATE USE USER USING VALIDATE VALUES VARCHAR VARCHAR2 VIEW WHEN WHENEVER WHERE WHILE WINDOW WITH'
  ).split(' '),
);

const DEFAULT_QUOTE: Record<InsertDialect, 'double' | 'backtick' | 'bracket'> = {
  ansi: 'double',
  postgresql: 'double',
  mysql: 'backtick',
  sqlite: 'double',
  sqlserver: 'bracket',
  oracle: 'double',
};

export function defaultQuoting(dialect: InsertDialect): 'double' | 'backtick' | 'bracket' {
  return DEFAULT_QUOTE[dialect];
}

function wrap(name: string, style: 'double' | 'backtick' | 'bracket'): string {
  if (style === 'backtick') return `\`${name.replace(/`/g, '``')}\``;
  if (style === 'bracket') return `[${name.replace(/]/g, ']]')}]`;
  return `"${name.replace(/"/g, '""')}"`;
}

/** Quote one identifier for a dialect. */
export function quoteIdentifier(name: string, dialect: InsertDialect, quoting: IdentifierQuoting): string {
  if (quoting === 'double' || quoting === 'backtick' || quoting === 'bracket') return wrap(name, quoting);
  const style = DEFAULT_QUOTE[dialect];
  if (quoting === 'auto') return wrap(name, style);
  const simple = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !RESERVED.has(name.toUpperCase());
  // PostgreSQL folds unquoted names to lower case, so mixed-case names need quotes to survive.
  const caseSafe = dialect !== 'postgresql' || name === name.toLowerCase();
  return simple && caseSafe ? name : wrap(name, style);
}

/** Split "schema.table" (parts may already be quoted) into names. */
export function splitQualifiedName(input: string): string[] | null {
  const parts: string[] = [];
  let i = 0;
  const s = input.trim();
  if (!s) return null;
  while (i < s.length) {
    const ch = s[i];
    let part: string;
    if (ch === '"' || ch === '`' || ch === '[') {
      const close = ch === '[' ? ']' : ch;
      let j = i + 1;
      part = '';
      for (;;) {
        if (j >= s.length) return null;
        if (s[j] === close) {
          if (s[j + 1] === close) {
            part += close;
            j += 2;
            continue;
          }
          break;
        }
        part += s[j++];
      }
      i = j + 1;
    } else {
      let j = i;
      while (j < s.length && s[j] !== '.') j++;
      part = s.slice(i, j).trim();
      i = j;
    }
    if (!part) return null;
    parts.push(part);
    if (i < s.length) {
      if (s[i] !== '.') return null;
      i++;
      if (i >= s.length) return null;
    }
  }
  return parts;
}

// ---------------------------------------------------------------------------
// Type inference
// ---------------------------------------------------------------------------

export type ColumnKind = 'unknown' | 'boolean' | 'integer' | 'bigint' | 'decimal' | 'float' | 'date' | 'timestamp' | 'timestamptz' | 'string' | 'json';

export interface ColumnType {
  kind: ColumnKind;
  /** Longest string, in characters. */
  maxLength: number;
  /** For decimals: digits before and after the point. */
  intDigits: number;
  scale: number;
  /** Largest integer magnitude, in digits. */
  digits: number;
  nullable: boolean;
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})?$/;

function validYmd(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1) return false;
  const days = [31, (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return d <= days[m - 1];
}

/** 'date', 'timestamp', 'timestamptz' or null for an ISO 8601 date/time string. */
export function dateKind(value: string): 'date' | 'timestamp' | 'timestamptz' | null {
  let m = ISO_DATE.exec(value);
  if (m) return validYmd(+m[1], +m[2], +m[3]) ? 'date' : null;
  m = ISO_TIMESTAMP.exec(value);
  if (!m || !validYmd(+m[1], +m[2], +m[3]) || +m[4] > 23 || +m[5] > 59 || +m[6] > 59) return null;
  if (m[8] && m[8] !== 'Z' && (+m[8].slice(1, 3) > 23 || +m[8].slice(-2) > 59)) return null;
  return m[8] ? 'timestamptz' : 'timestamp';
}

const INT32 = 2147483647n;
const INT64 = 9223372036854775807n;

function numberKind(text: string): { kind: 'integer' | 'bigint' | 'decimal' | 'float'; intDigits: number; scale: number } {
  if (/[eE]/.test(text)) return { kind: 'float', intDigits: 0, scale: 0 };
  const unsigned = text.replace(/^[-+]/, '');
  const [intPart, frac = ''] = unsigned.split('.');
  const intDigits = intPart.replace(/^0+(?=\d)/, '').length;
  if (!frac) {
    const abs = BigInt(unsigned);
    return { kind: abs <= INT32 ? 'integer' : abs <= INT64 ? 'bigint' : 'decimal', intDigits, scale: 0 };
  }
  return { kind: 'decimal', intDigits, scale: frac.length };
}

const NUMERIC_ORDER: ColumnKind[] = ['integer', 'bigint', 'decimal', 'float'];
const TIME_ORDER: ColumnKind[] = ['date', 'timestamp', 'timestamptz'];

function mergeKinds(a: ColumnKind, b: ColumnKind): ColumnKind {
  if (a === 'unknown') return b;
  if (b === 'unknown' || a === b) return a;
  if (NUMERIC_ORDER.includes(a) && NUMERIC_ORDER.includes(b)) return NUMERIC_ORDER[Math.max(NUMERIC_ORDER.indexOf(a), NUMERIC_ORDER.indexOf(b))];
  if (TIME_ORDER.includes(a) && TIME_ORDER.includes(b)) return TIME_ORDER[Math.max(TIME_ORDER.indexOf(a), TIME_ORDER.indexOf(b))];
  return 'string';
}

/** Infer one SQL type per column from all values. */
export function inferColumnTypes(data: Dataset, detectDates: boolean): ColumnType[] {
  return data.columns.map((_, c) => {
    const t: ColumnType = { kind: 'unknown', maxLength: 0, intDigits: 0, scale: 0, digits: 0, nullable: false };
    for (const row of data.rows) {
      const v = row[c] ?? NULL;
      let kind: ColumnKind;
      switch (v.kind) {
        case 'null':
          t.nullable = true;
          continue;
        case 'bool':
          kind = 'boolean';
          t.maxLength = Math.max(t.maxLength, 5);
          break;
        case 'number': {
          const n = numberKind(v.text);
          kind = n.kind;
          t.intDigits = Math.max(t.intDigits, n.intDigits);
          t.scale = Math.max(t.scale, n.scale);
          t.maxLength = Math.max(t.maxLength, v.text.length);
          break;
        }
        case 'string':
          kind = (detectDates && dateKind(v.value)) || 'string';
          t.maxLength = Math.max(t.maxLength, [...v.value].length);
          break;
        case 'json':
          kind = 'json';
          t.maxLength = Math.max(t.maxLength, [...v.value].length);
          break;
      }
      // Mixed JSON and plain values are stored as text.
      t.kind = t.kind === 'json' || kind === 'json' ? (t.kind === 'unknown' || t.kind === kind ? kind : 'string') : mergeKinds(t.kind, kind);
    }
    t.digits = t.intDigits + t.scale;
    return t;
  });
}

function textLength(n: number): number {
  const sizes = [16, 32, 64, 128, 255, 512, 1024, 2048, 4000];
  return sizes.find((s) => s >= n) ?? n;
}

/** Column type name in a dialect's vocabulary. */
export function sqlTypeName(t: ColumnType, dialect: InsertDialect): string {
  const len = textLength(Math.max(1, t.maxLength));
  const decimal = (name: string, max: number) => {
    const p = Math.max(1, t.intDigits + t.scale);
    return p > max ? null : `${name}(${p}, ${t.scale})`;
  };
  switch (t.kind) {
    case 'boolean':
      return { ansi: 'BOOLEAN', postgresql: 'BOOLEAN', mysql: 'BOOLEAN', sqlite: 'INTEGER', sqlserver: 'BIT', oracle: 'NUMBER(1)' }[dialect];
    case 'integer':
      return { ansi: 'INTEGER', postgresql: 'INTEGER', mysql: 'INT', sqlite: 'INTEGER', sqlserver: 'INT', oracle: 'NUMBER(10)' }[dialect];
    case 'bigint':
      return { ansi: 'BIGINT', postgresql: 'BIGINT', mysql: 'BIGINT', sqlite: 'INTEGER', sqlserver: 'BIGINT', oracle: 'NUMBER(19)' }[dialect];
    case 'decimal': {
      if (dialect === 'sqlite') return 'REAL';
      const named =
        dialect === 'postgresql' ? decimal('NUMERIC', 1000) : dialect === 'mysql' ? decimal('DECIMAL', 65) : dialect === 'oracle' ? decimal('NUMBER', 38) : decimal('DECIMAL', 38);
      if (named) return named;
      return sqlTypeName({ ...t, kind: 'float' }, dialect);
    }
    case 'float':
      return { ansi: 'DOUBLE PRECISION', postgresql: 'DOUBLE PRECISION', mysql: 'DOUBLE', sqlite: 'REAL', sqlserver: 'FLOAT', oracle: 'BINARY_DOUBLE' }[dialect];
    case 'date':
      return dialect === 'sqlite' ? 'TEXT' : 'DATE';
    case 'timestamp':
      return { ansi: 'TIMESTAMP', postgresql: 'TIMESTAMP', mysql: 'DATETIME', sqlite: 'TEXT', sqlserver: 'DATETIME2', oracle: 'TIMESTAMP' }[dialect];
    case 'timestamptz':
      return {
        ansi: 'TIMESTAMP WITH TIME ZONE',
        postgresql: 'TIMESTAMPTZ',
        mysql: 'DATETIME',
        sqlite: 'TEXT',
        sqlserver: 'DATETIMEOFFSET',
        oracle: 'TIMESTAMP WITH TIME ZONE',
      }[dialect];
    case 'json':
      return { ansi: 'CLOB', postgresql: 'JSONB', mysql: 'JSON', sqlite: 'TEXT', sqlserver: 'NVARCHAR(MAX)', oracle: 'CLOB' }[dialect];
    case 'unknown':
    case 'string':
    default:
      switch (dialect) {
        case 'postgresql':
        case 'sqlite':
          return 'TEXT';
        case 'mysql':
          return t.maxLength > 16383 ? 'LONGTEXT' : `VARCHAR(${len})`;
        case 'sqlserver':
          return t.maxLength > 4000 ? 'NVARCHAR(MAX)' : `NVARCHAR(${len})`;
        case 'oracle':
          return t.maxLength > 4000 ? 'CLOB' : `VARCHAR2(${len} CHAR)`;
        default:
          return t.maxLength > 4000 ? 'CLOB' : `VARCHAR(${len})`;
      }
  }
}

// ---------------------------------------------------------------------------
// Literals
// ---------------------------------------------------------------------------

export interface LiteralStats {
  nulCharsRemoved: number;
  emptyStrings: number;
  longStrings: number;
  convertedTimes: number;
}

function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

// eslint-disable-next-line no-control-regex
const NUL = /\u0000/g;
// eslint-disable-next-line no-control-regex
const MYSQL_SPECIAL = /[\\'\u0000\n\r\u001a]/g;
const MYSQL_ESCAPES: Record<string, string> = { '\\': '\\\\', "'": "''", '\u0000': '\\0', '\n': '\\n', '\r': '\\r', '\u001a': '\\Z' };

/** A string literal escaped for the dialect. */
export function stringLiteral(value: string, dialect: InsertDialect, stats?: LiteralStats): string {
  let v = value;
  if (dialect !== 'mysql' && v.includes('\u0000')) {
    const cleaned = v.replace(NUL, '');
    if (stats) stats.nulCharsRemoved += v.length - cleaned.length;
    v = cleaned;
  }
  if (stats) {
    if (v === '') stats.emptyStrings++;
    if (dialect === 'oracle' && utf8Length(v) > 4000) stats.longStrings++;
  }
  // MySQL (without NO_BACKSLASH_ESCAPES) reads backslash sequences inside strings.
  if (dialect === 'mysql') return `'${v.replace(MYSQL_SPECIAL, (c) => MYSQL_ESCAPES[c])}'`;
  const quoted = `'${v.replace(/'/g, "''")}'`;
  // SQL Server needs N'' to keep characters outside the database code page.
  if (dialect === 'sqlserver' && /[\u0080-￿]/.test(v)) return `N${quoted}`;
  return quoted;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** "2024-05-01T10:20:30+02:00" → "2024-05-01 08:20:30" (UTC), for MySQL DATETIME. */
function toUtcDateTime(value: string): string | null {
  const normalized = value.replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const ms = Date.parse(normalized);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  const base = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`;
  const frac = /\.(\d+)/.exec(value)?.[1];
  return frac ? `${base}.${frac.slice(0, 6)}` : base;
}

function timeLiteral(value: string, kind: 'date' | 'timestamp' | 'timestamptz', dialect: InsertDialect, stats?: LiteralStats): string {
  if (kind === 'date') return dialect === 'oracle' || dialect === 'ansi' ? `DATE '${value}'` : `'${value}'`;
  // Offsets are written as ±HH:MM, which every database accepts.
  const v = value.replace(/([+-]\d{2}):?(\d{2})$/, '$1:$2');
  if (dialect === 'oracle' || dialect === 'ansi') {
    // Typed literals avoid depending on session date formats (Oracle NLS_DATE_FORMAT).
    let ts = v.replace('T', ' ');
    if (kind === 'timestamptz') ts = ts.replace(/Z$/, '+00:00').replace(/([+-]\d{2}:\d{2})$/, dialect === 'oracle' ? ' $1' : '$1');
    return `TIMESTAMP '${ts}'`;
  }
  if (dialect === 'mysql') {
    if (kind === 'timestamptz') {
      const utc = toUtcDateTime(v);
      if (utc) {
        if (stats) stats.convertedTimes++;
        return `'${utc}'`;
      }
    }
    return `'${v.replace('T', ' ')}'`;
  }
  return `'${v}'`;
}

export function valueLiteral(v: SqlValue, dialect: InsertDialect, column?: ColumnType, stats?: LiteralStats): string {
  switch (v.kind) {
    case 'null':
      return 'NULL';
    case 'bool':
      return dialect === 'sqlite' || dialect === 'sqlserver' || dialect === 'oracle' ? (v.value ? '1' : '0') : v.value ? 'TRUE' : 'FALSE';
    case 'number':
      return v.text;
    case 'json':
      return stringLiteral(v.value, dialect, stats);
    case 'string': {
      const kind = column?.kind;
      if ((kind === 'date' || kind === 'timestamp' || kind === 'timestamptz') && dateKind(v.value)) {
        return timeLiteral(v.value, kind, dialect, stats);
      }
      return stringLiteral(v.value, dialect, stats);
    }
  }
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

export interface InsertOptions {
  table: string;
  dialect: InsertDialect;
  quoting: IdentifierQuoting;
  /** Rows per INSERT statement (1 = one statement per row). */
  batchSize: number;
  createTable: boolean;
  /** List the column names in each INSERT. */
  includeColumns: boolean;
  transaction: boolean;
  /** Recognize ISO 8601 dates and timestamps (DATE/TIMESTAMP columns and literals). */
  detectDates: boolean;
}

export type InsertResult =
  | { ok: true; sql: string; statements: number; rows: number; types: ColumnType[]; warnings: string[] }
  | { ok: false; error: string };

const MAX_SQLSERVER_ROWS = 1000;

export function generateInserts(data: Dataset, options: InsertOptions): InsertResult {
  const nameParts = splitQualifiedName(options.table);
  if (!nameParts) return { ok: false, error: options.table.trim() ? `"${options.table}" is not a valid table name.` : 'Enter a table name.' };
  if (!data.columns.length) return { ok: false, error: 'There are no columns to insert.' };
  const { dialect } = options;
  const warnings: string[] = [];
  const table = nameParts.map((p) => quoteIdentifier(p, dialect, options.quoting)).join('.');
  const columns = data.columns.map((c) => quoteIdentifier(c, dialect, options.quoting));
  const types = inferColumnTypes(data, options.detectDates);

  let batch = Math.max(1, Math.floor(Number.isFinite(options.batchSize) ? options.batchSize : 1));
  if (dialect === 'sqlserver' && batch > MAX_SQLSERVER_ROWS) {
    batch = MAX_SQLSERVER_ROWS;
    warnings.push('SQL Server accepts at most 1,000 rows per INSERT … VALUES, so batches were limited to 1,000 rows.');
  }

  const out: string[] = [];
  if (options.transaction) {
    const begin = { ansi: 'START TRANSACTION;', postgresql: 'BEGIN;', mysql: 'START TRANSACTION;', sqlite: 'BEGIN TRANSACTION;', sqlserver: 'BEGIN TRANSACTION;', oracle: '' }[dialect];
    if (begin) out.push(begin, '');
  }
  if (options.createTable) {
    const defs = columns.map((c, i) => `  ${c} ${sqlTypeName(types[i], dialect)}`);
    out.push(`CREATE TABLE ${table} (\n${defs.join(',\n')}\n);`, '');
  }

  const stats: LiteralStats = { nulCharsRemoved: 0, emptyStrings: 0, longStrings: 0, convertedTimes: 0 };
  const colList = options.includeColumns ? ` (${columns.join(', ')})` : '';
  const tuple = (row: SqlValue[]) => `(${data.columns.map((_, i) => valueLiteral(row[i] ?? NULL, dialect, types[i], stats)).join(', ')})`;
  let statements = 0;
  for (let start = 0; start < data.rows.length; start += batch) {
    const chunk = data.rows.slice(start, start + batch);
    statements++;
    if (chunk.length === 1) {
      out.push(`INSERT INTO ${table}${colList} VALUES ${tuple(chunk[0])};`);
    } else if (dialect === 'oracle') {
      // Oracle (before 23ai) has no multi-row VALUES; INSERT ALL inserts several rows in one statement.
      out.push(`INSERT ALL\n${chunk.map((r) => `  INTO ${table}${colList} VALUES ${tuple(r)}`).join('\n')}\nSELECT 1 FROM DUAL;`);
    } else {
      out.push(`INSERT INTO ${table}${colList} VALUES\n${chunk.map((r) => `  ${tuple(r)}`).join(',\n')};`);
    }
  }
  if (options.transaction) {
    out.push('', dialect === 'sqlserver' ? 'COMMIT TRANSACTION;' : 'COMMIT;');
  }

  if (stats.nulCharsRemoved) {
    warnings.push(`${stats.nulCharsRemoved.toLocaleString('en-US')} NUL character${stats.nulCharsRemoved === 1 ? ' was' : 's were'} removed from strings, because this database cannot store them in text.`);
  }
  if (dialect === 'oracle' && stats.emptyStrings) warnings.push('Oracle stores empty strings as NULL.');
  if (stats.longStrings) {
    warnings.push(`${stats.longStrings.toLocaleString('en-US')} string${stats.longStrings === 1 ? ' is' : 's are'} longer than 4,000 bytes, the limit for an Oracle string literal (ORA-01704). Load ${stats.longStrings === 1 ? 'it' : 'them'} with a bind variable or TO_CLOB pieces instead.`);
  }
  if (stats.convertedTimes) warnings.push('Timestamps with a UTC offset were converted to UTC, because MySQL DATETIME has no time zone.');
  if (!options.includeColumns && !options.createTable) warnings.push('Without a column list, values must be in the same order as the table’s columns.');
  const sql = out.join('\n').replace(/\n{3,}/g, '\n\n');
  return { ok: true, sql: sql ? `${sql}\n` : '', statements, rows: data.rows.length, types, warnings };
}
