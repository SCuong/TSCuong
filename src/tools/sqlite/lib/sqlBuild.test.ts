import { describe, expect, it } from 'vitest';
import { buildBrowseQuery, buildFilterClause, escapeLike, pageCount, quoteIdent, quoteString, sqlLiteral } from './sqlBuild';

describe('quoting', () => {
  it('quotes identifiers safely', () => {
    expect(quoteIdent('users')).toBe('"users"');
    expect(quoteIdent('we"ird')).toBe('"we""ird"');
    expect(quoteIdent('x"; DROP TABLE t; --')).toBe('"x""; DROP TABLE t; --"');
    expect(quoteIdent('')).toBe('""');
    expect(quoteIdent('表 🎉')).toBe('"表 🎉"');
  });

  it('quotes strings', () => {
    expect(quoteString("it's")).toBe("'it''s'");
  });

  it('formats literals for every SQLite type', () => {
    expect(sqlLiteral(null)).toBe('NULL');
    expect(sqlLiteral(42)).toBe('42');
    expect(sqlLiteral(-1.5)).toBe('-1.5');
    expect(sqlLiteral(Number.NaN)).toBe('NULL');
    expect(sqlLiteral(Infinity)).toBe('9e999');
    expect(sqlLiteral("O'Brien")).toBe("'O''Brien'");
    expect(sqlLiteral(new Uint8Array([0, 255, 16]))).toBe("X'00FF10'");
    expect(sqlLiteral(10n)).toBe('10');
  });
});

describe('filters', () => {
  it('escapes LIKE wildcards', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });

  it('parameterizes values and quotes identifiers', () => {
    expect(buildFilterClause({ column: 'na"me', op: 'contains', value: "a'%" })).toEqual({
      sql: `CAST("na""me" AS TEXT) LIKE ? ESCAPE '\\'`,
      params: ["%a'\\%%"],
    });
    expect(buildFilterClause({ column: 'n', op: 'equals', value: '10' })).toEqual({ sql: '"n" = ?', params: [10] });
    expect(buildFilterClause({ column: 'n', op: 'equals', value: '10a' })).toEqual({ sql: '"n" = ?', params: ['10a'] });
    expect(buildFilterClause({ column: 'n', op: 'gt', value: '-2.5' })).toEqual({ sql: '"n" > ?', params: [-2.5] });
    expect(buildFilterClause({ column: 'n', op: 'notEquals', value: 'x' })).toEqual({ sql: '"n" IS NOT ?', params: ['x'] });
    expect(buildFilterClause({ column: 'n', op: 'startsWith', value: 'ab' })?.params).toEqual(['ab%']);
    expect(buildFilterClause({ column: 'n', op: 'endsWith', value: 'ab' })?.params).toEqual(['%ab']);
    expect(buildFilterClause({ column: 'n', op: 'isNull', value: '' })).toEqual({ sql: '"n" IS NULL', params: [] });
    expect(buildFilterClause({ column: 'n', op: 'notNull', value: 'ignored' })).toEqual({ sql: '"n" IS NOT NULL', params: [] });
  });

  it('skips empty value filters', () => {
    expect(buildFilterClause({ column: 'n', op: 'contains', value: '' })).toBeNull();
  });
});

describe('buildBrowseQuery', () => {
  it('builds a plain paginated query', () => {
    expect(buildBrowseQuery({ table: 'users', page: 0, pageSize: 50 })).toEqual({
      sql: 'SELECT * FROM "users" LIMIT 50 OFFSET 0',
      countSql: 'SELECT count(*) FROM "users"',
      params: [],
    });
  });

  it('adds sorting, filters and custom where', () => {
    const q = buildBrowseQuery({
      table: 'my "table"',
      page: 2,
      pageSize: 100,
      sort: { column: 'created at', dir: 'desc' },
      filters: [
        { column: 'name', op: 'contains', value: 'ann' },
        { column: 'age', op: 'gt', value: '30' },
        { column: 'x', op: 'contains', value: '' },
      ],
      where: ' status = 1 OR status = 2 ',
    });
    expect(q.sql).toBe(
      `SELECT * FROM "my ""table""" WHERE CAST("name" AS TEXT) LIKE ? ESCAPE '\\' AND "age" > ? AND (status = 1 OR status = 2) ORDER BY "created at" DESC LIMIT 100 OFFSET 200`,
    );
    expect(q.countSql).toBe(
      `SELECT count(*) FROM "my ""table""" WHERE CAST("name" AS TEXT) LIKE ? ESCAPE '\\' AND "age" > ? AND (status = 1 OR status = 2)`,
    );
    expect(q.params).toEqual(['%ann%', 30]);
  });

  it('sanitizes page numbers', () => {
    expect(buildBrowseQuery({ table: 't', page: -3, pageSize: 0.5 }).sql).toBe('SELECT * FROM "t" LIMIT 1 OFFSET 0');
  });

  it('computes page counts', () => {
    expect(pageCount(0, 50)).toBe(1);
    expect(pageCount(50, 50)).toBe(1);
    expect(pageCount(51, 50)).toBe(2);
    expect(pageCount(1_000_000, 500)).toBe(2000);
  });
});
