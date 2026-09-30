/** Small helpers around sql.js objects, shared by the worker and tests (no worker globals here). */
import type { Database, Statement } from 'sql.js';
import { normalizeInteger, type SqlValue } from './sqlBuild';

/**
 * The current row with exact integers: sql.js reads INTEGER columns as doubles
 * unless asked for BigInt, which rounds 64-bit values (ids, hashes, timestamps
 * in ns). Integers that fit in a double are turned back into numbers.
 */
export function readRow(stmt: Statement): SqlValue[] {
  // sql.js supports this config argument (since 1.8); its type definitions do not declare it.
  const row = (stmt as unknown as { get(params: null, config: { useBigInt: boolean }): SqlValue[] }).get(null, { useBigInt: true });
  for (let i = 0; i < row.length; i++) {
    const v = row[i];
    if (typeof v === 'bigint') row[i] = normalizeInteger(v);
  }
  return row;
}

/** sql.js binds a BigInt as text, which SQLite's affinity rules turn back into the exact integer. */
export function bindable(params: SqlValue[]): Array<string | number | Uint8Array | null> {
  return params.map((p) => (typeof p === 'bigint' ? p.toString() : p));
}

/**
 * Is an explicit transaction (BEGIN without COMMIT/ROLLBACK) open? sql.js has
 * no sqlite3_get_autocommit, but BEGIN fails inside a transaction and is a
 * harmless no-op pair with ROLLBACK outside one (also under query_only).
 */
export function inTransaction(db: Pick<Database, 'run'>): boolean {
  try {
    db.run('BEGIN');
  } catch {
    return true;
  }
  db.run('ROLLBACK');
  return false;
}

/**
 * Columns an INSERT can write, in table order: generated columns (hidden 2 =
 * virtual, 3 = stored) are computed by SQLite and refuse values, and hidden
 * virtual-table columns (1) are not part of `SELECT *`.
 */
export function insertableColumns(rows: Array<Record<string, unknown>>): string[] {
  return rows.filter((c) => Number(c.hidden) === 0).map((c) => String(c.name));
}
