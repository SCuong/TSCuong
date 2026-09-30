import { format } from 'sql-formatter';
import { describe, expect, it } from 'vitest';
import { DIALECTS } from './dialects';
import { DEFAULT_FORMAT_SETTINGS, describeFormatError, formatSql, toFormatOptions, type SqlFormatSettings } from './sqlFormat';

const S = DEFAULT_FORMAT_SETTINGS;

function fmt(sql: string, settings: Partial<SqlFormatSettings> = {}) {
  const r = formatSql(format, sql, { ...S, ...settings });
  if (!r.ok) throw new Error(r.error.message);
  return r.value;
}

describe('formatSql', () => {
  it('formats with upper-case keywords and 2-space indentation by default', () => {
    expect(fmt('select a, b from t where x = 1 and y = 2')).toBe('SELECT\n  a,\n  b\nFROM\n  t\nWHERE\n  x = 1\n  AND y = 2\n');
  });

  it('supports lower case, 4 spaces and tabs', () => {
    expect(fmt('SELECT a FROM t', { keywordCase: 'lower', indent: '4' })).toBe('select\n    a\nfrom\n    t\n');
    expect(fmt('SELECT a FROM t', { indent: 'tab' })).toBe('SELECT\n\ta\nFROM\n\tt\n');
  });

  it('puts blank lines between statements', () => {
    expect(fmt('SELECT 1; SELECT 2;', { linesBetweenQueries: 2 })).toBe('SELECT\n  1;\n\n\nSELECT\n  2;\n');
    expect(fmt('SELECT 1; SELECT 2;', { linesBetweenQueries: 0 })).toBe('SELECT\n  1;\nSELECT\n  2;\n');
  });

  it('can put AND/OR at the end of lines, use dense operators and a semicolon line', () => {
    expect(fmt('SELECT a FROM t WHERE x = 1 AND y = 2;', { logicalOperatorNewline: 'after', denseOperators: true, newlineBeforeSemicolon: true })).toBe(
      'SELECT\n  a\nFROM\n  t\nWHERE\n  x=1 AND\n  y=2\n;\n',
    );
  });

  it('supports tabular indentation', () => {
    expect(fmt('SELECT a FROM t WHERE x = 1', { indentStyle: 'tabularLeft' })).toBe('SELECT    a\nFROM      t\nWHERE     x = 1\n');
  });

  it('keeps comments and strings', () => {
    expect(fmt("select 'it''s' as s -- note\nfrom t")).toBe("SELECT\n  'it''s' AS s -- note\nFROM\n  t\n");
  });

  it('formats dialect-specific syntax', () => {
    expect(fmt('select `a` from `t` limit 1', { dialect: 'mysql' })).toBe('SELECT\n  `a`\nFROM\n  `t`\nLIMIT\n  1\n');
    expect(fmt('select top 5 [a] from [t]', { dialect: 'transactsql' })).toBe('SELECT\n  TOP 5 [a]\nFROM\n  [t]\n');
    expect(fmt('select $1::int', { dialect: 'postgresql' })).toBe('SELECT\n  $1::int\n');
  });

  it('formats every dialect without throwing on simple SQL', () => {
    for (const d of DIALECTS) {
      const r = formatSql(format, 'SELECT a, COUNT(*) FROM t GROUP BY a;', { ...S, dialect: d.id });
      expect(r.ok, d.id).toBe(true);
    }
  });

  it('treats Jinja/dbt templates as placeholders when asked', () => {
    const sql = "select * from {{ ref('orders') }} where id = {{ var('id') }}";
    expect(formatSql(format, sql, S).ok).toBe(false);
    expect(fmt(sql, { templates: true })).toBe("SELECT\n  *\nFROM\n  {{ ref('orders') }}\nWHERE\n  id = {{ var('id') }}\n");
  });

  it('reports parse errors with a position and a readable message', () => {
    const r = formatSql(format, 'SELECT (a FROM t', S);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.line).toBe(1);
      expect(r.error.message).not.toMatch(/Instead, I was expecting/);
    }
  });

  it('suggests picking a dialect for the generic one', () => {
    const r = formatSql(format, "SELECT * FROM t WHERE x = 'unterminated", S);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatchObject({ line: 1, column: 27 });
      expect(r.error.message).toMatch(/Choosing the specific SQL dialect may fix this/);
    }
  });

  it('handles Unicode and a BOM', () => {
    expect(fmt('\uFEFFselect "名前", \'😀\' from t')).toBe('SELECT\n  "名前",\n  \'😀\'\nFROM\n  t\n');
  });

  it('formats long scripts', () => {
    const sql = Array.from({ length: 300 }, (_, i) => `insert into t (a, b) values (${i}, 'x${i}');`).join('\n');
    const out = fmt(sql);
    expect(out.match(/INSERT INTO/g)).toHaveLength(300);
  });
});

describe('toFormatOptions', () => {
  it('maps settings and clamps numbers', () => {
    const o = toFormatOptions({ ...S, dialect: 'postgresql', indent: '4', linesBetweenQueries: 99, expressionWidth: -5 });
    expect(o).toMatchObject({ language: 'postgresql', tabWidth: 4, useTabs: false, linesBetweenQueries: 5, expressionWidth: 10 });
    expect(o.paramTypes).toBeUndefined();
    expect(toFormatOptions({ ...S, linesBetweenQueries: Number.NaN }).linesBetweenQueries).toBe(1);
  });
});

describe('describeFormatError', () => {
  it('summarizes parser dumps', () => {
    expect(describeFormatError(new Error('Parse error at token: «EOF» at line 1 column 14\nUnexpected EOF token…'), 'postgresql')).toEqual({
      message: 'The SQL ends too early (an unclosed parenthesis or unfinished clause?)',
      line: 1,
      column: 14,
    });
    expect(describeFormatError(new Error('Parse error: Unexpected "{{ x }" at line 2 column 8.\nThis likely happens…'), 'mysql')).toEqual({
      message: 'Could not parse the SQL near “{{ x }”',
      line: 2,
      column: 8,
    });
    expect(describeFormatError('boom', 'sql')).toEqual({ message: 'boom', line: undefined, column: undefined });
  });
});
