import {
  COMPANY_NOUNS,
  COMPANY_PREFIXES,
  COMPANY_SUFFIXES,
  EMAIL_DOMAINS,
  FIRST_NAMES,
  JOB_AREAS,
  JOB_LEVELS,
  JOB_ROLES,
  LAST_NAMES,
  MOCK_WORDS,
  PLACES,
  STREET_NAMES,
  STREET_SUFFIXES,
  TLDS_FOR_URLS,
} from './mockData';

// ---------------------------------------------------------------------------
// Seedable PRNG: cyrb128 string hash -> sfc32
// ---------------------------------------------------------------------------

/** 128-bit string hash (cyrb128), used to turn any seed text into PRNG state. */
export function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** Small fast counter PRNG (sfc32). Returns uint32 values. */
export function sfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
}

export class SeededRandom {
  private readonly next: () => number;

  constructor(seed: string) {
    const [a, b, c, d] = cyrb128(seed);
    this.next = sfc32(a, b, c, d);
    // Discard the first outputs to mix the state (recommended for sfc32).
    for (let i = 0; i < 15; i++) this.next();
  }

  uint32(): number {
    return this.next();
  }

  /** Float in [0, 1) with 53 bits. */
  float(): number {
    const hi = this.next() >>> 5;
    const lo = this.next() >>> 6;
    return (hi * 67108864 + lo) / 9007199254740992;
  }

  /** Integer in [min, max] inclusive. */
  int(min: number, max: number): number {
    return min + Math.floor(this.float() * (max - min + 1));
  }

  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.float() * list.length)];
  }

  bool(probability = 0.5): boolean {
    return this.float() < probability;
  }
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export type FieldType =
  | 'autoIncrement'
  | 'firstName'
  | 'lastName'
  | 'fullName'
  | 'email'
  | 'username'
  | 'phone'
  | 'street'
  | 'city'
  | 'country'
  | 'zip'
  | 'company'
  | 'jobTitle'
  | 'uuid'
  | 'integer'
  | 'float'
  | 'boolean'
  | 'date'
  | 'enum'
  | 'words'
  | 'sentence'
  | 'url'
  | 'ipv4'
  | 'ipv6'
  | 'hexColor';

export type DateFormat = 'date' | 'datetime' | 'unix' | 'unixMs';

export interface FieldOptions {
  min?: number;
  max?: number;
  decimals?: number;
  /** Percent chance (0–100) of `true`. */
  probability?: number;
  from?: string;
  to?: string;
  dateFormat?: DateFormat;
  /** Comma separated values for enum fields. */
  values?: string;
  /** Word count for `words`. */
  count?: number;
  start?: number;
  step?: number;
  /** Percent chance (0–100) that the value is null/empty. */
  blank?: number;
}

export interface MockField {
  id: string;
  name: string;
  type: FieldType;
  options: FieldOptions;
}

export const FIELD_TYPES: Array<{ type: FieldType; label: string; group: string }> = [
  { type: 'autoIncrement', label: 'Auto-increment ID', group: 'Identifiers' },
  { type: 'uuid', label: 'UUID v4', group: 'Identifiers' },
  { type: 'firstName', label: 'First name', group: 'Person' },
  { type: 'lastName', label: 'Last name', group: 'Person' },
  { type: 'fullName', label: 'Full name', group: 'Person' },
  { type: 'email', label: 'Email', group: 'Person' },
  { type: 'username', label: 'Username', group: 'Person' },
  { type: 'phone', label: 'Phone (fictional 555)', group: 'Person' },
  { type: 'jobTitle', label: 'Job title', group: 'Person' },
  { type: 'company', label: 'Company', group: 'Person' },
  { type: 'street', label: 'Street address', group: 'Location' },
  { type: 'city', label: 'City', group: 'Location' },
  { type: 'country', label: 'Country', group: 'Location' },
  { type: 'zip', label: 'Zip / postal code', group: 'Location' },
  { type: 'integer', label: 'Integer range', group: 'Numbers & values' },
  { type: 'float', label: 'Decimal range', group: 'Numbers & values' },
  { type: 'boolean', label: 'Boolean', group: 'Numbers & values' },
  { type: 'date', label: 'Date range', group: 'Numbers & values' },
  { type: 'enum', label: 'One of a list', group: 'Numbers & values' },
  { type: 'words', label: 'Words', group: 'Text' },
  { type: 'sentence', label: 'Sentence', group: 'Text' },
  { type: 'url', label: 'URL', group: 'Internet' },
  { type: 'ipv4', label: 'IPv4 address', group: 'Internet' },
  { type: 'ipv6', label: 'IPv6 address', group: 'Internet' },
  { type: 'hexColor', label: 'Hex color', group: 'Internet' },
];

export function defaultOptions(type: FieldType): FieldOptions {
  switch (type) {
    case 'autoIncrement':
      return { start: 1, step: 1 };
    case 'integer':
      return { min: 1, max: 100 };
    case 'float':
      return { min: 0, max: 1000, decimals: 2 };
    case 'boolean':
      return { probability: 50 };
    case 'date':
      return { from: '2020-01-01', to: '2025-12-31', dateFormat: 'date' };
    case 'enum':
      return { values: 'active, pending, suspended' };
    case 'words':
      return { count: 3 };
    default:
      return {};
  }
}

export const MAX_ROWS = 10_000;

export type Value = string | number | boolean | null;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseDay(s: string | undefined): number | null {
  if (!s || !DATE_RE.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isNaN(t) ? null : t;
}

export function enumValues(values: string | undefined): string[] {
  return (values ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Returns a list of human-readable problems (empty when the schema is valid). */
export function validateSchema(fields: MockField[]): string[] {
  const errors: string[] = [];
  if (fields.length === 0) errors.push('Add at least one field.');
  const seen = new Set<string>();
  fields.forEach((f, i) => {
    const label = f.name.trim() ? `"${f.name.trim()}"` : `Field ${i + 1}`;
    const name = f.name.trim();
    if (!name) errors.push(`Field ${i + 1} needs a name.`);
    else if (seen.has(name)) errors.push(`The field name ${label} is used more than once.`);
    seen.add(name);
    const o = f.options;
    if (o.blank !== undefined && (o.blank < 0 || o.blank > 100)) errors.push(`${label}: blank % must be between 0 and 100.`);
    switch (f.type) {
      case 'integer':
      case 'float':
        if (typeof o.min !== 'number' || typeof o.max !== 'number') errors.push(`${label}: set both a minimum and a maximum.`);
        else if (o.min > o.max) errors.push(`${label}: the minimum is greater than the maximum.`);
        else if (f.type === 'integer' && (!Number.isSafeInteger(o.min) || !Number.isSafeInteger(o.max)))
          errors.push(`${label}: integer bounds must be whole numbers.`);
        if (f.type === 'float' && (typeof o.decimals !== 'number' || o.decimals < 0 || o.decimals > 10 || !Number.isInteger(o.decimals)))
          errors.push(`${label}: decimals must be a whole number from 0 to 10.`);
        break;
      case 'boolean':
        if (typeof o.probability !== 'number' || o.probability < 0 || o.probability > 100)
          errors.push(`${label}: the chance of true must be between 0 and 100%.`);
        break;
      case 'date': {
        const from = parseDay(o.from);
        const to = parseDay(o.to);
        if (from === null || to === null) errors.push(`${label}: pick both a start and an end date.`);
        else if (from > to) errors.push(`${label}: the start date is after the end date.`);
        break;
      }
      case 'enum':
        if (enumValues(o.values).length === 0) errors.push(`${label}: list at least one value, separated by commas.`);
        break;
      case 'words':
        if (typeof o.count !== 'number' || o.count < 1 || o.count > 50 || !Number.isInteger(o.count))
          errors.push(`${label}: word count must be from 1 to 50.`);
        break;
      case 'autoIncrement':
        if (typeof o.start !== 'number' || !Number.isSafeInteger(o.start)) errors.push(`${label}: the start must be a whole number.`);
        if (typeof o.step !== 'number' || !Number.isSafeInteger(o.step) || o.step === 0) errors.push(`${label}: the step must be a non-zero whole number.`);
        break;
    }
  });
  return errors;
}

// ---------------------------------------------------------------------------
// Row generation
// ---------------------------------------------------------------------------

interface RowContext {
  person?: { first: string; last: string; n: number };
  place?: [string, string];
}

function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function person(rng: SeededRandom, ctx: RowContext) {
  if (!ctx.person) ctx.person = { first: rng.pick(FIRST_NAMES), last: rng.pick(LAST_NAMES), n: rng.int(1, 99) };
  return ctx.person;
}

function place(rng: SeededRandom, ctx: RowContext) {
  if (!ctx.place) ctx.place = rng.pick(PLACES);
  return ctx.place;
}

function hex(rng: SeededRandom, digits: number): string {
  let s = '';
  for (let i = 0; i < digits; i++) s += (rng.uint32() & 15).toString(16);
  return s;
}

function sentence(rng: SeededRandom): string {
  const n = rng.int(5, 12);
  const words: string[] = [];
  for (let i = 0; i < n; i++) words.push(rng.pick(MOCK_WORDS));
  const s = words.join(' ');
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function value(field: MockField, index: number, rng: SeededRandom, ctx: RowContext): Value {
  const o = field.options;
  switch (field.type) {
    case 'autoIncrement':
      return (o.start ?? 1) + index * (o.step ?? 1);
    case 'firstName':
      return person(rng, ctx).first;
    case 'lastName':
      return person(rng, ctx).last;
    case 'fullName': {
      const p = person(rng, ctx);
      return `${p.first} ${p.last}`;
    }
    case 'email': {
      const p = person(rng, ctx);
      const style = rng.int(0, 2);
      const local = style === 0 ? `${slug(p.first)}.${slug(p.last)}` : style === 1 ? `${slug(p.first).charAt(0)}${slug(p.last)}${p.n}` : `${slug(p.first)}${p.n}`;
      return `${local}@${rng.pick(EMAIL_DOMAINS)}`;
    }
    case 'username': {
      const p = person(rng, ctx);
      const style = rng.int(0, 2);
      return style === 0 ? `${slug(p.first)}_${slug(p.last)}` : style === 1 ? `${slug(p.first)}${p.n}` : `${slug(p.last)}.${slug(p.first).charAt(0)}${p.n}`;
    }
    case 'phone':
      // 555-0100 … 555-0199 is reserved for fictional use.
      return `+1 (${rng.int(201, 989)}) 555-01${pad(rng.int(0, 99), 2)}`;
    case 'street':
      return `${rng.int(1, 9999)} ${rng.pick(STREET_NAMES)} ${rng.pick(STREET_SUFFIXES)}`;
    case 'city':
      return place(rng, ctx)[0];
    case 'country':
      return place(rng, ctx)[1];
    case 'zip':
      return pad(rng.int(1000, 99999), 5);
    case 'company': {
      const style = rng.int(0, 2);
      if (style === 0) return `${rng.pick(COMPANY_PREFIXES)}${rng.pick(COMPANY_NOUNS).toLowerCase()} ${rng.pick(COMPANY_SUFFIXES)}`;
      if (style === 1) return `${rng.pick(COMPANY_PREFIXES)} ${rng.pick(COMPANY_NOUNS)} ${rng.pick(COMPANY_SUFFIXES)}`;
      return `${rng.pick(LAST_NAMES)} & ${rng.pick(LAST_NAMES)} ${rng.pick(COMPANY_SUFFIXES)}`;
    }
    case 'jobTitle':
      return [rng.pick(JOB_LEVELS), rng.pick(JOB_AREAS), rng.pick(JOB_ROLES)].filter(Boolean).join(' ');
    case 'uuid': {
      const h = hex(rng, 32).split('');
      h[12] = '4';
      h[16] = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
      const s = h.join('');
      return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
    }
    case 'integer':
      return rng.int(o.min ?? 0, o.max ?? 100);
    case 'float': {
      const min = o.min ?? 0;
      const max = o.max ?? 1;
      const d = o.decimals ?? 2;
      const factor = 10 ** d;
      // Uniform over the representable grid in [min, max].
      const lo = Math.ceil(min * factor);
      const hi = Math.floor(max * factor);
      if (hi < lo) return Number(min.toFixed(d));
      return Number((rng.int(lo, hi) / factor).toFixed(d));
    }
    case 'boolean':
      return rng.bool((o.probability ?? 50) / 100);
    case 'date': {
      const from = parseDay(o.from) ?? 0;
      const to = (parseDay(o.to) ?? from) + 86_399_999;
      const t = from + Math.floor(rng.float() * (to - from + 1));
      switch (o.dateFormat ?? 'date') {
        case 'datetime':
          return new Date(t).toISOString();
        case 'unix':
          return Math.floor(t / 1000);
        case 'unixMs':
          return t;
        default:
          return new Date(t).toISOString().slice(0, 10);
      }
    }
    case 'enum':
      return rng.pick(enumValues(o.values));
    case 'words': {
      const n = o.count ?? 3;
      const out: string[] = [];
      for (let i = 0; i < n; i++) out.push(rng.pick(MOCK_WORDS));
      return out.join(' ');
    }
    case 'sentence':
      return sentence(rng);
    case 'url': {
      const path = [rng.pick(MOCK_WORDS), rng.pick(MOCK_WORDS)].join('-');
      return `https://${rng.bool(0.5) ? 'www.' : ''}${rng.pick(TLDS_FOR_URLS)}/${rng.pick(MOCK_WORDS)}/${path}`;
    }
    case 'ipv4':
      return `${rng.int(1, 223)}.${rng.int(0, 255)}.${rng.int(0, 255)}.${rng.int(1, 254)}`;
    case 'ipv6': {
      const groups: string[] = [];
      for (let i = 0; i < 8; i++) groups.push((rng.uint32() & 0xffff).toString(16));
      return groups.join(':');
    }
    case 'hexColor':
      return `#${hex(rng, 6)}`;
  }
}

export type Row = Record<string, Value>;

/** Stateful generator: call `next()` repeatedly; the same seed and schema always yield the same rows. */
export function createRowGenerator(fields: MockField[], seed: string) {
  const rng = new SeededRandom(seed);
  const names = fields.map((f) => f.name.trim());
  let index = 0;
  return {
    next(): Row {
      const ctx: RowContext = {};
      const row: Row = {};
      for (let i = 0; i < fields.length; i++) {
        const f = fields[i];
        const blank = f.options.blank ?? 0;
        // Always draw the value so a blank % change doesn't shift the rest of the stream.
        const v = value(f, index, rng, ctx);
        const roll = rng.float() * 100;
        row[names[i]] = roll < blank ? null : v;
      }
      index++;
      return row;
    },
  };
}

export function generateRows(fields: MockField[], seed: string, count: number): Row[] {
  const gen = createRowGenerator(fields, seed);
  return Array.from({ length: count }, () => gen.next());
}

// ---------------------------------------------------------------------------
// Output formats
// ---------------------------------------------------------------------------

export type OutputFormat = 'json' | 'csv' | 'sql' | 'ndjson';

export function toJson(rows: Row[]): string {
  return JSON.stringify(rows, null, 2);
}

export function toNdjson(rows: Row[]): string {
  return rows.map((r) => JSON.stringify(r)).join('\n');
}

/** RFC 4180 field escaping: quote when the value has a delimiter, quote, line break or edge whitespace. */
export function csvCell(v: Value): string {
  if (v === null) return '';
  const s = String(v);
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns: string[], rows: Row[]): string {
  const lines = [columns.map(csvCell).join(',')];
  for (const r of rows) lines.push(columns.map((c) => csvCell(r[c] ?? null)).join(','));
  return lines.join('\r\n');
}

/**
 * SQL flavours with different quoting rules. ANSI double-quoted identifiers are a syntax error in MySQL's
 * default mode, which also treats "\" as an escape inside strings; SQL Server has no TRUE/FALSE literals
 * and needs N'…' for text outside ASCII.
 */
export type SqlDialect = 'ansi' | 'mysql' | 'sqlserver';

export const SQL_DIALECTS: Array<{ value: SqlDialect; label: string }> = [
  { value: 'ansi', label: 'PostgreSQL / SQLite' },
  { value: 'mysql', label: 'MySQL / MariaDB' },
  { value: 'sqlserver', label: 'SQL Server' },
];

/** Quote an SQL identifier for the dialect (embedded quote characters doubled). `schema.table` quotes each part. */
export function sqlIdent(name: string, dialect: SqlDialect = 'ansi'): string {
  return name
    .split('.')
    .map((part) =>
      dialect === 'mysql' ? `\`${part.replace(/`/g, '``')}\`` : dialect === 'sqlserver' ? `[${part.replace(/]/g, ']]')}]` : `"${part.replace(/"/g, '""')}"`,
    )
    .join('.');
}

export function sqlLiteral(v: Value, dialect: SqlDialect = 'ansi'): string {
  if (v === null) return 'NULL';
  if (typeof v === 'boolean') return dialect === 'sqlserver' ? (v ? '1' : '0') : v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  const quoted = v.replace(/'/g, "''");
  if (dialect === 'mysql') return `'${quoted.replace(/\\/g, '\\\\')}'`;
  // eslint-disable-next-line no-control-regex
  if (dialect === 'sqlserver' && /[^\x00-\x7f]/.test(v)) return `N'${quoted}'`;
  return `'${quoted}'`;
}

export function toSql(table: string, columns: string[], rows: Row[], dialect: SqlDialect = 'ansi'): string {
  const head = `INSERT INTO ${sqlIdent(table.trim() || 'mock_data', dialect)} (${columns.map((c) => sqlIdent(c, dialect)).join(', ')}) VALUES `;
  return rows.map((r) => `${head}(${columns.map((c) => sqlLiteral(r[c] ?? null, dialect)).join(', ')});`).join('\n');
}

export function formatRows(format: OutputFormat, columns: string[], rows: Row[], table: string, dialect: SqlDialect = 'ansi'): string {
  switch (format) {
    case 'json':
      return toJson(rows);
    case 'ndjson':
      return toNdjson(rows);
    case 'csv':
      return toCsv(columns, rows);
    case 'sql':
      return toSql(table, columns, rows, dialect);
  }
}

export const FORMAT_META: Record<OutputFormat, { ext: string; mime: string; label: string }> = {
  json: { ext: 'json', mime: 'application/json', label: 'JSON' },
  csv: { ext: 'csv', mime: 'text/csv', label: 'CSV' },
  sql: { ext: 'sql', mime: 'application/sql', label: 'SQL' },
  ndjson: { ext: 'ndjson', mime: 'application/x-ndjson', label: 'NDJSON' },
};
