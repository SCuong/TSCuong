import { describe, expect, it } from 'vitest';
import { DIALECTS, type SqlDialect } from './dialects';
import { minifySql, tokenizeSql, type SqlMinifyOptions } from './sqlMinify';

function min(sql: string, dialect: SqlDialect = 'sql', extra: Partial<SqlMinifyOptions> = {}): string {
  const r = minifySql(sql, { dialect, ...extra });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

describe('minifySql: whitespace and comments', () => {
  it('collapses whitespace and drops spaces next to punctuation and operators', () => {
    expect(min('SELECT  a,\n  b\nFROM   t\nWHERE x = 1\n  AND y <> 2;\n')).toBe('SELECT a,b FROM t WHERE x=1 AND y<>2;');
  });

  it('removes line and block comments and counts them', () => {
    const r = minifySql('SELECT a -- first\nFROM t /* block\n comment */ WHERE b = 2', { dialect: 'sql' });
    expect(r).toEqual({ ok: true, value: 'SELECT a FROM t WHERE b=2', commentsRemoved: 2, hintsKept: 0 });
  });

  it('treats a removed comment as whitespace', () => {
    expect(min('SELECT/*x*/a/*y*/FROM/**/t')).toBe('SELECT a FROM t');
  });

  it('never creates "--" or "/*" from separate operators', () => {
    expect(min('SELECT a - -b, c - /* x */ - d, 4 / /* x */ 2 FROM t')).toBe('SELECT a- -b,c- -d,4/2 FROM t');
    expect(min('SELECT 1 / * FROM t')).toBe('SELECT 1/ *FROM t');
  });

  it('keeps words and quoted tokens apart', () => {
    expect(min("SELECT 'a' 'b', \"x\" \"y\", N 'z'")).toBe("SELECT 'a' 'b',\"x\" \"y\",N 'z'");
  });

  it('keeps separate multi-character operators apart', () => {
    expect(min('SELECT a < = b, c | | d, x : : int, y < -1')).toBe('SELECT a< =b,c| |d,x : : int,y< -1');
    expect(min('SELECT a<=b, c||d, x::int')).toBe('SELECT a<=b,c||d,x::int');
  });

  it('keeps parameters intact', () => {
    expect(min('WHERE a = :name AND b = @p AND c = ? AND d = $1 AND e = ? 1')).toBe('WHERE a=:name AND b=@p AND c=? AND d=$1 AND e=? 1');
  });

  it('does not turn "U & \'x\'" into a Unicode string literal', () => {
    expect(min("SELECT U & 'x', a & b", 'postgresql')).toBe("SELECT U& 'x',a&b");
  });

  it('collapses Unicode whitespace and handles Unicode names', () => {
    expect(min("SELECT\u00a0\"名前\",  'café 😀'\u3000FROM t WHERE naïve = 1")).toBe("SELECT \"名前\",'café 😀' FROM t WHERE naïve=1");
  });

  it('returns an empty string for blank or comment-only input', () => {
    expect(min('')).toBe('');
    expect(min('  \n -- nothing\n /* here */ ')).toBe('');
  });

  it('strips a BOM', () => {
    expect(min('\uFEFFSELECT 1')).toBe('SELECT 1');
  });

  it('is idempotent', () => {
    const sql = "SELECT a, b -- c\nFROM t WHERE x = 'y  z' AND n BETWEEN 1 AND 2 ORDER BY a DESC;";
    const once = min(sql);
    expect(min(once)).toBe(once);
  });

  it('handles large scripts', () => {
    const sql = Array.from({ length: 20000 }, (_, i) => `INSERT INTO t (id, name)\n  VALUES (${i}, 'name ${i}'); -- row ${i}`).join('\n');
    const out = min(sql, 'postgresql');
    expect(out.startsWith("INSERT INTO t(id,name)VALUES(0,'name 0');")).toBe(true);
    expect(out.split(';').length).toBe(20001);
  });
});

describe('minifySql: strings and identifiers are preserved', () => {
  it('keeps spacing and comment markers inside strings', () => {
    expect(min("SELECT 'a  b', 'it''s   ok', '-- no', '/* no */'")).toBe("SELECT 'a  b','it''s   ok','-- no','/* no */'");
  });

  it('keeps quoted identifiers', () => {
    expect(min('SELECT "my  col" FROM "My ""Quoted"" Table"')).toBe('SELECT "my  col" FROM "My ""Quoted"" Table"');
    expect(min('SELECT `a  b` FROM `t`', 'mysql')).toBe('SELECT `a  b` FROM `t`');
  });

  it('treats backslashes per dialect', () => {
    // PostgreSQL standard strings: a backslash is an ordinary character.
    expect(min("SELECT 'C:\\',   '  x  '", 'postgresql')).toBe("SELECT 'C:\\','  x  '");
    // MySQL: a backslash escapes the quote.
    expect(min("SELECT 'it\\'s   here',   \"dq \\\"x\\\"  y\"", 'mysql')).toBe("SELECT 'it\\'s   here',\"dq \\\"x\\\"  y\"");
    // PostgreSQL E'' strings use backslash escapes.
    expect(min("SELECT E'it\\'s   x',   'y'", 'postgresql')).toBe("SELECT E'it\\'s   x','y'");
  });

  it('lets the backslash rule be overridden', () => {
    expect(min("SELECT 'a\\'  b'", 'sql', { backslashEscapes: true })).toBe("SELECT 'a\\'  b'");
    expect(min("SELECT 'C:\\', 'x'", 'mysql', { backslashEscapes: false })).toBe("SELECT 'C:\\','x'");
  });

  it('keeps dollar-quoted bodies verbatim', () => {
    const fn = 'CREATE FUNCTION f() RETURNS int AS $$\n  SELECT  1; -- inner comment\n$$ LANGUAGE sql;';
    expect(min(fn, 'postgresql')).toBe('CREATE FUNCTION f()RETURNS int AS $$\n  SELECT  1; -- inner comment\n$$ LANGUAGE sql;');
    const tagged = 'DO $body$\nBEGIN\n  RAISE NOTICE \'$$ inside  %\', 1;\nEND\n$body$;';
    expect(min(tagged, 'postgresql')).toBe(tagged.replace('DO $body$', 'DO $body$'));
    expect(min('SELECT $1, $2, a$b$c FROM t', 'postgresql')).toBe('SELECT $1,$2,a$b$c FROM t');
  });

  it('handles nested block comments where the dialect supports them', () => {
    expect(min('SELECT 1 /* outer /* inner */ still */ + 2', 'postgresql')).toBe('SELECT 1+2');
    expect(min('SELECT 1 /* a /* b */ + 2', 'mysql')).toBe('SELECT 1+2');
  });

  it('keeps T-SQL bracketed identifiers but not PostgreSQL arrays', () => {
    expect(min('SELECT [my col], [a]]b] FROM [dbo].[t]', 'transactsql')).toBe('SELECT [my col],[a]]b] FROM [dbo].[t]');
    expect(min("SELECT ARRAY[1, 2][1], ARRAY['a]  b']", 'postgresql')).toBe("SELECT ARRAY[1,2][1],ARRAY['a]  b']");
  });

  it("keeps Oracle q'[…]' strings", () => {
    expect(min("SELECT q'[it's  here]', Q'{a  b}', nq'!x  y!' FROM dual", 'plsql')).toBe("SELECT q'[it's  here]',Q'{a  b}',nq'!x  y!' FROM dual");
  });

  it('keeps BigQuery triple-quoted strings', () => {
    expect(min('SELECT """a\n  "b" """, \'\'\'x  \'y\' \'\'\' # c\nFROM t', 'bigquery')).toBe('SELECT """a\n  "b" """,\'\'\'x  \'y\' \'\'\' FROM t');
  });

  it('keeps Snowflake $$ bodies and ClickHouse heredocs', () => {
    expect(min("SELECT $$a  'b'$$, $1 // comment\nFROM t", 'snowflake')).toBe("SELECT $$a  'b'$$,$1 FROM t");
    expect(min('SELECT $doc$x  y$doc$', 'clickhouse')).toBe('SELECT $doc$x  y$doc$');
  });
});

describe('minifySql: dialect comment rules', () => {
  it('handles MySQL # comments and the "-- " rule', () => {
    expect(min('SELECT 1 # comment\n, 2', 'mysql')).toBe('SELECT 1,2');
    expect(min('SELECT 5--1', 'mysql')).toBe('SELECT 5--1');
    expect(min('SELECT 5 -- c\n+ 1', 'mysql')).toBe('SELECT 5+1');
    expect(min('SELECT 5--1', 'postgresql')).toBe('SELECT 5');
  });

  it('does not treat # as a comment in PostgreSQL or T-SQL', () => {
    expect(min('SELECT 5 # 3', 'postgresql')).toBe('SELECT 5 # 3');
    expect(min('SELECT * FROM #temp', 'transactsql')).toBe('SELECT*FROM #temp');
  });
});

describe('minifySql: hints and client commands', () => {
  it('keeps optimizer hints and executable comments with spaces around them', () => {
    expect(min('SELECT /*+ INDEX(t idx) */ a FROM t')).toBe('SELECT /*+ INDEX(t idx) */ a FROM t');
    expect(min('/*!40101 SET NAMES utf8 */;\n/*M! SET x=1 */;', 'mysql')).toBe('/*!40101 SET NAMES utf8 */;/*M! SET x=1 */;');
    expect(min('SELECT a --+ ordered\nFROM t', 'plsql')).toBe('SELECT a --+ ordered\nFROM t');
  });

  it('removes hints when asked', () => {
    const r = minifySql('SELECT /*+ INDEX(t idx) */ a FROM t', { dialect: 'sql', keepHints: false });
    expect(r).toMatchObject({ ok: true, value: 'SELECT a FROM t', commentsRemoved: 1 });
  });

  it('keeps T-SQL GO batch separators on their own lines', () => {
    expect(min('SELECT 1\nGO\nSELECT  2\n  go 5  \nPRINT 1', 'transactsql')).toBe('SELECT 1\nGO\nSELECT 2\ngo 5\nPRINT 1');
    expect(min('SELECT 1 AS go', 'transactsql')).toBe('SELECT 1 AS go');
  });

  it('keeps Oracle "/" terminators on their own lines', () => {
    expect(min('BEGIN\n  NULL;\nEND;\n/\nSELECT 1 FROM dual;', 'plsql')).toBe('BEGIN NULL;END;\n/\nSELECT 1 FROM dual;');
  });

  it('keeps MySQL DELIMITER commands on their own lines', () => {
    const sql = 'DELIMITER //\nCREATE PROCEDURE p()\nBEGIN\n  SELECT 1;\nEND //\nDELIMITER ;\nCALL p();';
    expect(min(sql, 'mysql')).toBe('DELIMITER //\nCREATE PROCEDURE p()BEGIN SELECT 1;END//\nDELIMITER ;\nCALL p();');
  });

  it('keeps psql meta-commands on their own lines', () => {
    expect(min('\\connect mydb\nSELECT 1;\n  \\set x 1\nSELECT :x;', 'postgresql')).toBe('\\connect mydb\nSELECT 1;\n\\set x 1\nSELECT :x;');
  });
});

describe('minifySql: errors', () => {
  it('reports unterminated strings with a position', () => {
    const r = minifySql("SELECT 1,\n  'abc", { dialect: 'sql' });
    expect(r).toEqual({ ok: false, error: { message: 'Unterminated string literal, starting at line 2, column 3', line: 2, column: 3 } });
  });

  it('reports unterminated comments, identifiers and dollar quotes', () => {
    expect(minifySql('SELECT 1 /* x', { dialect: 'sql' })).toMatchObject({ ok: false, error: { line: 1, column: 10 } });
    expect(minifySql('SELECT "abc', { dialect: 'sql' })).toMatchObject({ ok: false, error: { message: expect.stringMatching(/quoted identifier/) } });
    expect(minifySql('SELECT $$ x', { dialect: 'postgresql' })).toMatchObject({ ok: false, error: { message: expect.stringMatching(/dollar-quoted/) } });
    expect(minifySql('SELECT [x', { dialect: 'transactsql' })).toMatchObject({ ok: false, error: { message: expect.stringMatching(/bracketed/) } });
  });

  it('treats an apostrophe inside a PostgreSQL standard string correctly', () => {
    // With backslash escapes on, this would swallow the rest of the query.
    expect(minifySql("SELECT 'a\\', 'b'", { dialect: 'postgresql' })).toMatchObject({ ok: true, value: "SELECT 'a\\','b'" });
  });
});

describe('tokenizeSql', () => {
  it('produces tokens that concatenate back to the input', () => {
    const sql = "SELECT a.b, 'x' || \"y\" -- c\nFROM t /* d */ WHERE $1 = @v; GO";
    for (const d of DIALECTS) {
      const tokens = tokenizeSql(sql, d.lex);
      expect(tokens.map((t) => t.text).join(''), d.id).toBe(sql);
    }
  });

  it('classifies tokens', () => {
    const kinds = tokenizeSql("SELECT 'x', \"y\" -- c", DIALECTS[0].lex).map((t) => t.kind);
    expect(kinds).toEqual(['word', 'space', 'string', 'punct', 'space', 'identifier', 'space', 'comment']);
  });
});
