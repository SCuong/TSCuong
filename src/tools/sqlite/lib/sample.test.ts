import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { SqlJsStatic } from 'sql.js';
import { buildSampleSql } from './sample';
import { buildBrowseQuery } from './sqlBuild';
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
    stmt.bind(q.params);
    stmt.step();
    // "_" is escaped, so it matches literally (no email contains an underscore).
    expect(stmt.get()[0]).toBe(0);
    stmt.free();

    // read-only enforcement at the engine level
    db.run('PRAGMA query_only = 1');
    expect(() => db.run('DELETE FROM customers')).toThrow(/readonly/i);
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
