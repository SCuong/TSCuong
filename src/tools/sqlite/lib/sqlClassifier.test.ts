import { describe, expect, it } from 'vitest';
import {
  blockedInReadOnly,
  classifyScript,
  classifyStatement,
  errorLocation,
  lineColumn,
  splitStatements,
  tokenize,
  unquoteIdentifier,
  validateWhereClause,
} from './sqlClassifier';

const kinds = (sql: string) => classifyScript(sql).map((s) => s.kind);

describe('tokenize', () => {
  it('ignores comments and keeps strings intact', () => {
    const { tokens, unterminated } = tokenize("SELECT 'a;b' -- DROP TABLE x;\n/* DELETE */ FROM t");
    expect(unterminated).toBeNull();
    expect(tokens.map((t) => t.value)).toEqual(['SELECT', "'a;b'", 'FROM', 't']);
  });

  it('handles escaped quotes and all identifier quoting styles', () => {
    const { tokens } = tokenize(`SELECT 'it''s', "a""b", \`c\`, [d e]`);
    expect(tokens.filter((t) => t.type === 'string').map((t) => t.value)).toEqual(["'it''s'"]);
    expect(tokens.filter((t) => t.type === 'ident').map((t) => t.value)).toEqual(['"a""b"', '`c`', '[d e]']);
  });

  it('reports unterminated strings and comments', () => {
    expect(tokenize("SELECT 'abc").unterminated).toBe('string');
    expect(tokenize('SELECT 1 /* open').unterminated).toBe('comment');
    expect(tokenize('SELECT "x').unterminated).toBe('identifier');
  });

  it('lexes numbers, parameters and Unicode identifiers', () => {
    const { tokens } = tokenize('SELECT 1.5e-3, 0xFF, .5, ?1, :name, @p, $v FROM café_表');
    expect(tokens.filter((t) => t.type === 'number').map((t) => t.value)).toEqual(['1.5e-3', '0xFF', '.5']);
    expect(tokens.filter((t) => t.type === 'param').map((t) => t.value)).toEqual(['?1', ':name', '@p', '$v']);
    expect(tokens.at(-1)?.value).toBe('café_表');
  });

  it('returns nothing for empty input', () => {
    expect(tokenize('').tokens).toEqual([]);
    expect(splitStatements('   -- only a comment\n/* and this */')).toEqual([]);
  });
});

describe('splitStatements', () => {
  it('splits on top-level semicolons only', () => {
    const parts = splitStatements("SELECT ';'; SELECT \"a;b\" FROM t;;  SELECT 3");
    expect(parts.map((p) => p.text)).toEqual(["SELECT ';'", 'SELECT "a;b" FROM t', 'SELECT 3']);
  });

  it('keeps trigger bodies (with CASE … END) together', () => {
    const sql = `CREATE TRIGGER t AFTER INSERT ON a BEGIN
      UPDATE b SET x = CASE WHEN NEW.y > 0 THEN 1 ELSE 0 END;
      DELETE FROM c WHERE id = NEW.id;
    END; SELECT 1`;
    const parts = splitStatements(sql);
    expect(parts).toHaveLength(2);
    expect(parts[0].text.endsWith('END')).toBe(true);
    expect(parts[1].text).toBe('SELECT 1');
  });

  it('handles CREATE TEMP TRIGGER', () => {
    expect(splitStatements('CREATE TEMP TRIGGER t BEFORE DELETE ON a BEGIN SELECT 1; SELECT 2; END; SELECT 3')).toHaveLength(2);
  });

  it('records source offsets', () => {
    const sql = '  SELECT 1 ;\nSELECT 2';
    const [a, b] = splitStatements(sql);
    expect(sql.slice(a.start, a.end)).toBe('SELECT 1');
    expect(sql.slice(b.start, b.end)).toBe('SELECT 2');
  });
});

describe('classifyStatement', () => {
  it('classifies reads', () => {
    for (const sql of ['SELECT 1', 'select * from t', 'VALUES (1),(2)', 'EXPLAIN QUERY PLAN DELETE FROM t', 'WITH x AS (SELECT 1) SELECT * FROM x']) {
      expect(classifyStatement(sql)?.kind, sql).toBe('read');
    }
  });

  it('classifies writes', () => {
    for (const sql of [
      "INSERT INTO t VALUES (1)",
      'UPDATE t SET a = 1 WHERE id = 2',
      'DELETE FROM t WHERE id = 1',
      'REPLACE INTO t VALUES (1)',
      'CREATE TABLE x (id)',
      'DROP VIEW v',
      'ALTER TABLE t ADD COLUMN c',
      'VACUUM',
      "ATTACH DATABASE 'x.db' AS x",
      'DETACH x',
      'REINDEX',
      'ANALYZE',
    ]) {
      expect(classifyStatement(sql)?.kind, sql).toBe('write');
    }
  });

  it('detects writes hidden in CTEs', () => {
    const s = classifyStatement('WITH old AS (SELECT id FROM t WHERE x < 5) DELETE FROM t WHERE id IN (SELECT id FROM old)');
    expect(s?.kind).toBe('write');
    expect(s?.verb).toBe('WITH … DELETE');
    expect(classifyStatement('WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM c WHERE n<5) INSERT INTO t SELECT n FROM c')?.kind).toBe('write');
    // A column named "update" or a string containing DELETE does not make a read a write.
    expect(classifyStatement(`WITH a AS (SELECT 'DELETE' AS "update") SELECT * FROM a`)?.kind).toBe('read');
  });

  it('treats unknown statements conservatively', () => {
    expect(classifyStatement('SELEC 1')?.kind).toBe('write');
    expect(classifyStatement('(SELECT 1)')?.kind).toBe('write');
  });

  it('classifies PRAGMA reads and writes', () => {
    expect(classifyStatement('PRAGMA user_version')?.kind).toBe('read');
    expect(classifyStatement('PRAGMA main.page_size')?.kind).toBe('read');
    expect(classifyStatement('PRAGMA table_info(users)')?.kind).toBe('read');
    expect(classifyStatement('pragma index_list("t")')?.kind).toBe('read');
    expect(classifyStatement('PRAGMA user_version = 5')?.kind).toBe('write');
    expect(classifyStatement('PRAGMA query_only = 0')?.kind).toBe('write');
    expect(classifyStatement('PRAGMA main.journal_mode=WAL')?.kind).toBe('write');
    expect(classifyStatement('PRAGMA foreign_keys(OFF)')?.kind).toBe('write');
    expect(classifyStatement('PRAGMA optimize')?.kind).toBe('write');
    expect(classifyStatement('PRAGMA incremental_vacuum')?.kind).toBe('write');
  });

  it('classifies transaction control separately', () => {
    expect(kinds('BEGIN; SELECT 1; COMMIT; ROLLBACK; SAVEPOINT a; RELEASE a; END')).toEqual([
      'transaction',
      'read',
      'transaction',
      'transaction',
      'transaction',
      'transaction',
      'transaction',
    ]);
  });

  it('ignores keywords inside strings and comments', () => {
    expect(classifyStatement("SELECT 'DROP TABLE users; DELETE FROM x' AS s")?.kind).toBe('read');
    expect(classifyStatement('-- DELETE FROM t\nSELECT 1')?.kind).toBe('read');
    expect(classifyStatement('/* INSERT */ SELECT 1')?.kind).toBe('read');
  });

  it('returns null for an empty statement', () => {
    expect(classifyStatement('')).toBeNull();
    expect(classifyStatement(' ; -- x')).toBeNull();
  });
});

describe('destructive statements', () => {
  it('flags DROP and DELETE/UPDATE without WHERE', () => {
    expect(classifyStatement('DROP TABLE users')?.destructive).toBe(true);
    expect(classifyStatement('DROP INDEX IF EXISTS i')?.destructive).toBe(true);
    expect(classifyStatement('DELETE FROM users')?.destructive).toBe(true);
    expect(classifyStatement('DELETE FROM users RETURNING *')?.destructive).toBe(true);
    expect(classifyStatement('UPDATE users SET name = NULL')?.destructive).toBe(true);
    expect(classifyStatement('ALTER TABLE users DROP COLUMN email')?.destructive).toBe(true);
    expect(classifyStatement('WITH x AS (SELECT 1) DELETE FROM t')?.destructive).toBe(true);
  });

  it('does not flag scoped writes', () => {
    expect(classifyStatement('DELETE FROM users WHERE id = 3')?.destructive).toBe(false);
    expect(classifyStatement('UPDATE users SET a = (SELECT max(b) FROM c WHERE c.x = 1) WHERE id = 1')?.destructive).toBe(false);
    expect(classifyStatement('INSERT INTO t VALUES (1)')?.destructive).toBe(false);
    expect(classifyStatement('CREATE TABLE t (a)')?.destructive).toBe(false);
  });

  it('a WHERE only inside a subquery does not count', () => {
    expect(classifyStatement('UPDATE t SET a = (SELECT b FROM c WHERE c.id = 1)')?.destructive).toBe(true);
  });
});

describe('scripts', () => {
  it('handles multiple statements and lists the blocked ones', () => {
    const script = "SELECT 1; INSERT INTO t VALUES ('a;b'); -- DELETE FROM t;\nPRAGMA table_info(t); DROP TABLE t";
    const statements = classifyScript(script);
    expect(statements.map((s) => s.kind)).toEqual(['read', 'write', 'read', 'write']);
    expect(blockedInReadOnly(statements).map((s) => s.verb)).toEqual(['INSERT', 'DROP TABLE']);
  });

  it('copes with very long input', () => {
    const script = Array.from({ length: 5000 }, (_, i) => `SELECT ${i}`).join(';\n');
    expect(classifyScript(script)).toHaveLength(5000);
  });
});

describe('validateWhereClause', () => {
  it('accepts single expressions', () => {
    expect(validateWhereClause('')).toBeNull();
    expect(validateWhereClause(`"name" LIKE 'a%' AND id IN (SELECT id FROM x ORDER BY id LIMIT 3)`)).toBeNull();
    expect(validateWhereClause("note = 'x; y'")).toBeNull();
  });

  it('rejects multiple statements and trailing clauses', () => {
    expect(validateWhereClause('1=1; DROP TABLE t')).toMatch(/single expression/);
    expect(validateWhereClause("name = 'x")).toMatch(/unterminated/);
    expect(validateWhereClause('(a = 1')).toMatch(/unclosed/);
    expect(validateWhereClause('a = 1)')).toMatch(/unmatched/);
    expect(validateWhereClause('1=1 ORDER BY x')).toMatch(/ORDER/);
    expect(validateWhereClause('1=1 UNION SELECT 1')).toMatch(/UNION/);
    expect(validateWhereClause('1 /* x')).toMatch(/comment/);
  });
});

describe('errorLocation', () => {
  it('locates the token named by a syntax error when it is unambiguous', () => {
    const sql = 'SELECT id,\n  nme FORM big';
    expect(errorLocation(sql, 'near "big": syntax error')).toEqual({ start: sql.indexOf('big'), length: 3 });
    // A whole-token match: the x inside "max" is not a hit.
    expect(errorLocation('SELECT max(a) x x', 'near "x": syntax error')).toBeNull();
    expect(errorLocation("SELECT 'abc", 'unrecognized token: "\'abc"')).toEqual({ start: 7, length: 4 });
  });

  it('locates unknown columns, tables and functions by name', () => {
    expect(errorLocation('SELECT nme FROM big', 'no such column: nme')).toEqual({ start: 7, length: 3 });
    expect(errorLocation('SELECT b.nme FROM big b', 'no such column: b.nme')).toEqual({ start: 9, length: 3 });
    expect(errorLocation('SELECT * FROM "Nope"', 'no such table: Nope')).toEqual({ start: 14, length: 6 });
    expect(errorLocation('SELECT a, a FROM t', 'no such column: a')).toBeNull();
  });

  it('points at the end for incomplete input and gives up on other messages', () => {
    expect(errorLocation('SELECT (1', 'incomplete input')).toEqual({ start: 9, length: 0 });
    expect(errorLocation('DELETE FROM t', 'FOREIGN KEY constraint failed')).toBeNull();
  });

  it('turns offsets into 1-based line and column', () => {
    expect(lineColumn('SELECT 1;\nSELECT x FORM t', 20)).toEqual({ line: 2, column: 11 });
    expect(lineColumn('abc', 0)).toEqual({ line: 1, column: 1 });
  });
});

describe('unquoteIdentifier', () => {
  it('unquotes all styles', () => {
    expect(unquoteIdentifier('"a""b"')).toBe('a"b');
    expect(unquoteIdentifier('`x``y`')).toBe('x`y');
    expect(unquoteIdentifier('[a b]')).toBe('a b');
    expect(unquoteIdentifier('plain')).toBe('plain');
  });
});
