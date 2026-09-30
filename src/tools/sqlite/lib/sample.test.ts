import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { SqlJsStatic } from 'sql.js';
import { bindable, inTransaction, insertableColumns, readRow } from './engine';
import { buildSampleSql } from './sample';
import { buildBrowseQuery, type SqlValue } from './sqlBuild';
import { classifyScript } from './sqlClassifier';
import { toSqlDump } from './sqlFormat';

const require = createRequire(import.meta.url);

async function engine(): Promise<SqlJsStatic> {
  const init = require('sql.js/dist/sql-wasm.js') as (config?: object) => Promise<SqlJsStatic>;
  const wasm = require.resolve('sql.js/dist/sql-wasm.wasm');
  return init({ locateFile: () => wasm });
}

describe('sample database', () => {
  it('builds deterministically and runs in real SQLite', async () => {
    const sql = buildSampleSql();
    expect(buildSampleSql()).toBe(sql);
    // Every statement is recognised by the classifier (writes, since it builds the DB).
    const statements = classifyScript(sql);
    expect(statements.every((s) => s.kind === 'write')).toBe(true);

    const SQL = await engine();
    const db = new SQL.Database();
    db.exec(sql);
    const count = (q: string) => Number(db.exec(q)[0].values[0][0]);
    expect(count('SELECT count(*) FROM customers')).toBe(48);
    expect(count('SELECT count(*) FROM products')).toBe(20);
    expect(count('SELECT count(*) FROM orders')).toBe(320);
    expect(count('SELECT count(*) FROM order_items')).toBeGreaterThan(300);
    expect(count("SELECT count(*) FROM sqlite_master WHERE type = 'view'")).toBe(1);
    expect(count("SELECT count(*) FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL")).toBe(4);
    expect(count("SELECT count(*) FROM sqlite_master WHERE type = 'trigger'")).toBe(1);
    expect(count('SELECT count(*) FROM pragma_foreign_key_check')).toBe(0);
    expect(count('PRAGMA user_version')).toBe(3);
    expect(count('SELECT count(*) FROM products WHERE thumbnail IS NOT NULL')).toBe(5);

    // The trigger decrements stock.
    const before = count('SELECT stock FROM products WHERE id = 2');
    db.run('INSERT INTO orders (customer_id, ordered_at) VALUES (1, ?)', ['2024-01-01']);
    db.run('INSERT INTO order_items VALUES (last_insert_rowid(), 2, 3, 2900)');
    expect(count('SELECT stock FROM products WHERE id = 2')).toBe(before - 3);

    // The data-browser query runs with bound parameters.
    const q = buildBrowseQuery({
      table: 'customers',
      page: 0,
      pageSize: 5,
      sort: { column: 'name', dir: 'asc' },
      filters: [{ column: 'email', op: 'contains', value: '_' }],
    });
    const stmt = db.prepare(q.countSql);
    stmt.bind(q.params as Array<string | number | Uint8Array | null>);
    stmt.step();
    // "_" is escaped, so it matches literally (no email contains an underscore).
    expect(stmt.get()[0]).toBe(0);
    stmt.free();

    // read-only enforcement at the engine level
    db.run('PRAGMA query_only = 1');
    expect(() => db.run('DELETE FROM customers')).toThrow(/readonly/i);
    db.close();
  });

  it('reads 64-bit integers exactly and binds filter values with the column affinity', async () => {
    const SQL = await engine();
    const db = new SQL.Database();
    db.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY, big INTEGER, zip TEXT, loose);
      INSERT INTO t VALUES (1, 9223372036854775807, '007', 7), (2, 9007199254740993, '10001', '007'), (3, 42, '42', 1.5);`);
    const rows: SqlValue[][] = [];
    const read = db.prepare('SELECT big FROM t ORDER BY id');
    while (read.step()) rows.push(readRow(read));
    read.free();
    expect(rows.flat()).toEqual([9223372036854775807n, 9007199254740993n, 42]);

    const matches = (column: string, op: 'equals' | 'gt', value: string) => {
      const q = buildBrowseQuery({ table: 't', page: 0, pageSize: 10, filters: [{ column, op, value }] });
      const stmt = db.prepare(`SELECT id FROM (${q.sql})`);
      stmt.bind(bindable(q.params));
      const ids: SqlValue[] = [];
      while (stmt.step()) ids.push(readRow(stmt)[0]);
      stmt.free();
      return ids;
    };
    expect(matches('zip', 'equals', '007')).toEqual([1]);
    expect(matches('big', 'equals', '9223372036854775807')).toEqual([1]);
    expect(matches('big', 'equals', '9007199254740993')).toEqual([2]);
    expect(matches('loose', 'equals', '7')).toEqual([1]);
    expect(matches('loose', 'equals', '007')).toEqual([2]);
    expect(matches('big', 'gt', '100')).toEqual([1, 2]);
    // Exact literals in dumps round-trip.
    const dump = toSqlDump('t', 'CREATE TABLE t (id INTEGER PRIMARY KEY, big INTEGER, zip TEXT, loose)', ['id', 'big'], [[1, 9223372036854775807n]]);
    const copy = new SQL.Database();
    copy.exec(dump);
    const back = copy.prepare('SELECT big, typeof(big) FROM t');
    back.step();
    expect(readRow(back)).toEqual([9223372036854775807n, 'integer']);
    back.free();
    copy.close();
    db.close();
  });

  it('detects an open transaction without disturbing it', async () => {
    const SQL = await engine();
    const db = new SQL.Database();
    db.run('CREATE TABLE t (a)');
    expect(inTransaction(db)).toBe(false);
    db.run('BEGIN');
    db.run('INSERT INTO t VALUES (1)');
    expect(inTransaction(db)).toBe(true);
    // The probe did not end or roll back the transaction.
    expect(db.exec('SELECT count(*) FROM t')[0].values[0][0]).toBe(1);
    db.run('COMMIT');
    expect(inTransaction(db)).toBe(false);
    db.run('PRAGMA query_only = 1');
    expect(inTransaction(db)).toBe(false);
    db.close();
  });

  it('dumps tables with generated columns so that they restore', async () => {
    const SQL = await engine();
    const db = new SQL.Database();
    const create = 'CREATE TABLE g (a INTEGER, b INTEGER GENERATED ALWAYS AS (a * 2) STORED, c GENERATED ALWAYS AS (a + 1) VIRTUAL)';
    db.exec(`${create}; INSERT INTO g (a) VALUES (1), (2);`);
    const info = db.exec("SELECT name, hidden FROM pragma_table_xinfo('g')")[0].values.map(([name, hidden]) => ({ name, hidden }));
    const cols = insertableColumns(info);
    expect(cols).toEqual(['a']);
    const data = db.exec('SELECT a FROM g')[0].values as SqlValue[][];
    const copy = new SQL.Database();
    copy.exec(toSqlDump('g', create, cols, data));
    expect(copy.exec('SELECT a, b, c FROM g')[0].values).toEqual([
      [1, 2, 2],
      [2, 4, 3],
    ]);
    copy.close();
    db.close();
  });

  it('produces SQL dumps that restore the same rows', async () => {
    const SQL = await engine();
    const src = new SQL.Database();
    src.exec(`CREATE TABLE "we""ird" (id INTEGER PRIMARY KEY, t TEXT, r REAL, b BLOB);
      INSERT INTO "we""ird" VALUES (1, 'it''s 🎉', 1.5, x'00ff'), (2, NULL, -2, NULL);`);
    const res = src.exec('SELECT * FROM "we""ird"')[0];
    const create = String(src.exec("SELECT sql FROM sqlite_master WHERE name = 'we\"ird'")[0].values[0][0]);
    const dump = toSqlDump('we"ird', create, res.columns, res.values);
    const dst = new SQL.Database();
    dst.exec(dump);
    expect(dst.exec('SELECT * FROM "we""ird"')[0].values).toEqual(res.values);
  });
});
