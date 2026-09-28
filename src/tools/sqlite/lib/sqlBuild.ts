/** Helpers for building safe SQL: identifier quoting, literals and the data browser query. */

export type SqlValue = number | string | Uint8Array | null;

/** Quote an identifier for SQLite ("name" with embedded quotes doubled). */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** Quote a string literal ('it''s'). */
export function quoteString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function toHex(bytes: Uint8Array, max = bytes.length): string {
  let out = '';
  const len = Math.min(max, bytes.length);
  for (let i = 0; i < len; i++) out += bytes[i].toString(16).padStart(2, '0');
  return out;
}

/** A SQL literal for any SQLite value, suitable for INSERT statements in dumps. */
export function sqlLiteral(value: SqlValue | bigint | boolean | undefined): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'NULL';
    if (!Number.isFinite(value)) return value > 0 ? '9e999' : '-9e999';
    return String(value);
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value instanceof Uint8Array) return `X'${toHex(value).toUpperCase()}'`;
  return quoteString(value);
}

export type FilterOp = 'contains' | 'equals' | 'notEquals' | 'startsWith' | 'endsWith' | 'gt' | 'lt' | 'isNull' | 'notNull';

export const FILTER_OPS: Array<{ value: FilterOp; label: string; needsValue: boolean }> = [
  { value: 'contains', label: 'contains', needsValue: true },
  { value: 'equals', label: '=', needsValue: true },
  { value: 'notEquals', label: '≠', needsValue: true },
  { value: 'startsWith', label: 'starts with', needsValue: true },
  { value: 'endsWith', label: 'ends with', needsValue: true },
  { value: 'gt', label: '>', needsValue: true },
  { value: 'lt', label: '<', needsValue: true },
  { value: 'isNull', label: 'is NULL', needsValue: false },
  { value: 'notNull', label: 'is not NULL', needsValue: false },
];

export interface ColumnFilter {
  column: string;
  op: FilterOp;
  value: string;
}

export interface BrowseQuery {
  table: string;
  sort?: { column: string; dir: 'asc' | 'desc' } | null;
  filters?: ColumnFilter[];
  /** A raw WHERE expression (validated separately, see validateWhereClause). */
  where?: string;
  page: number;
  pageSize: number;
}

export interface BuiltQuery {
  sql: string;
  countSql: string;
  params: SqlValue[];
}

/** Escape LIKE wildcards so user text is matched literally (ESCAPE '\'). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Numbers typed into a filter compare numerically; everything else as text. */
function filterValue(raw: string): SqlValue {
  const trimmed = raw.trim();
  if (trimmed !== '' && /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(trimmed)) return Number(trimmed);
  return raw;
}

export function buildFilterClause(filter: ColumnFilter): { sql: string; params: SqlValue[] } | null {
  const col = quoteIdent(filter.column);
  switch (filter.op) {
    case 'isNull':
      return { sql: `${col} IS NULL`, params: [] };
    case 'notNull':
      return { sql: `${col} IS NOT NULL`, params: [] };
  }
  if (filter.value === '') return null;
  switch (filter.op) {
    case 'contains':
      return { sql: `CAST(${col} AS TEXT) LIKE ? ESCAPE '\\'`, params: [`%${escapeLike(filter.value)}%`] };
    case 'startsWith':
      return { sql: `CAST(${col} AS TEXT) LIKE ? ESCAPE '\\'`, params: [`${escapeLike(filter.value)}%`] };
    case 'endsWith':
      return { sql: `CAST(${col} AS TEXT) LIKE ? ESCAPE '\\'`, params: [`%${escapeLike(filter.value)}`] };
    case 'equals':
      return { sql: `${col} = ?`, params: [filterValue(filter.value)] };
    case 'notEquals':
      return { sql: `${col} IS NOT ?`, params: [filterValue(filter.value)] };
    case 'gt':
      return { sql: `${col} > ?`, params: [filterValue(filter.value)] };
    case 'lt':
      return { sql: `${col} < ?`, params: [filterValue(filter.value)] };
  }
}

/** Build the paginated, sorted, filtered SELECT used by the data browser. */
export function buildBrowseQuery(q: BrowseQuery): BuiltQuery {
  const parts: string[] = [];
  const params: SqlValue[] = [];
  for (const filter of q.filters ?? []) {
    const clause = buildFilterClause(filter);
    if (!clause) continue;
    parts.push(clause.sql);
    params.push(...clause.params);
  }
  if (q.where && q.where.trim()) parts.push(`(${q.where.trim()})`);
  const where = parts.length ? ` WHERE ${parts.join(' AND ')}` : '';
  const from = `FROM ${quoteIdent(q.table)}${where}`;
  const order = q.sort ? ` ORDER BY ${quoteIdent(q.sort.column)} ${q.sort.dir === 'desc' ? 'DESC' : 'ASC'}` : '';
  const pageSize = Math.max(1, Math.floor(q.pageSize));
  const page = Math.max(0, Math.floor(q.page));
  return {
    sql: `SELECT * ${from}${order} LIMIT ${pageSize} OFFSET ${page * pageSize}`,
    countSql: `SELECT count(*) ${from}`,
    params,
  };
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}
