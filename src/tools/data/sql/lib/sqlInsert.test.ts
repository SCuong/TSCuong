import { describe, expect, it } from 'vitest';
import {
  csvCell,
  datasetFromCsv,
  datasetFromJson,
  dateKind,
  generateInserts,
  inferColumnTypes,
  quoteIdentifier,
  splitQualifiedName,
  sqlTypeName,
  stringLiteral,
  valueLiteral,
  type Dataset,
  type InsertOptions,
} from './sqlInsert';

const O: InsertOptions = {
  table: 'users',
  dialect: 'postgresql',
  quoting: 'auto',
  batchSize: 1,
  createTable: false,
  includeColumns: true,
  transaction: false,
  detectDates: true,
};

function data(json: string): Dataset {
  const r = datasetFromJson(json);
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
}

function sql(json: string, options: Partial<InsertOptions> = {}): string {
  const r = generateInserts(data(json), { ...O, ...options });
  if (!r.ok) throw new Error(r.error);
  return r.sql;
}

describe('datasetFromJson', () => {
  it('reads an array of objects, keeping key order and exact numbers', () => {
    const d = data('[{"id":1,"price":1.50,"big":12345678901234567890,"ok":true,"tags":["a"],"meta":{"x":1.0},"none":null}]');
    expect(d.columns).toEqual(['id', 'price', 'big', 'ok', 'tags', 'meta', 'none']);
    expect(d.rows[0]).toEqual([
      { kind: 'number', text: '1' },
      { kind: 'number', text: '1.50' },
      { kind: 'number', text: '12345678901234567890' },
      { kind: 'bool', value: true },
      { kind: 'json', value: '["a"]' },
      { kind: 'json', value: '{"x":1.0}' },
      { kind: 'null' },
    ]);
  });

  it('unions keys across records and fills missing ones with NULL', () => {
    const d = data('[{"a":1},{"b":2},{"a":3,"c":4}]');
    expect(d.columns).toEqual(['a', 'b', 'c']);
    expect(d.rows[1]).toEqual([{ kind: 'null' }, { kind: 'number', text: '2' }, { kind: 'null' }]);
    expect(d.notes).toContain('3 records lack some keys; the missing values are NULL.');
  });

  it('finds records nested inside an object', () => {
    const d = data('{"meta":{"page":1},"data":{"items":[{"id":1},{"id":2}]}}');
    expect(d.rows).toHaveLength(2);
    expect(d.notes[0]).toBe('Using the 2 records found at $.data.items.');
  });

  it('treats a single object as one row', () => {
    expect(data('{"id":1,"name":"x"}').rows).toHaveLength(1);
  });

  it('names positional columns for arrays of arrays', () => {
    const d = data('[[1,"a"],[2,"b",true]]');
    expect(d.columns).toEqual(['column_1', 'column_2', 'column_3']);
    expect(d.rows[0][2]).toEqual({ kind: 'null' });
  });

  it('puts scalar items in a value column', () => {
    expect(data('["a","b"]').columns).toEqual(['value']);
  });

  it('renames empty keys and keeps __proto__', () => {
    const d = data('[{"":1,"__proto__":2}]');
    expect(d.columns).toEqual(['column_1', '__proto__']);
  });

  it('reports invalid JSON with a position and rejects bare scalars', () => {
    const bad = datasetFromJson('[{"a":1,}]');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error.line).toBe(1);
    expect(datasetFromJson('42').ok).toBe(false);
    expect(datasetFromJson('  ').ok).toBe(false);
  });

  it('accepts an empty array', () => {
    const r = datasetFromJson('[]');
    expect(r.ok && r.data.rows).toEqual([]);
  });
});

describe('datasetFromCsv', () => {
  it('reads a header row and detects types', () => {
    const r = datasetFromCsv('id,name,zip,active,score\n1,"Smith, J",01234,true,9.50\n2,,,FALSE,\n', { detectTypes: true, emptyAsNull: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.columns).toEqual(['id', 'name', 'zip', 'active', 'score']);
    expect(r.data.rows[0]).toEqual([
      { kind: 'number', text: '1' },
      { kind: 'string', value: 'Smith, J' },
      { kind: 'string', value: '01234' },
      { kind: 'bool', value: true },
      { kind: 'number', text: '9.50' },
    ]);
    expect(r.data.rows[1]).toEqual([{ kind: 'number', text: '2' }, { kind: 'null' }, { kind: 'null' }, { kind: 'bool', value: false }, { kind: 'null' }]);
  });

  it('keeps everything as text when detection is off', () => {
    const r = datasetFromCsv('a;b\n1;\n', { detectTypes: false, emptyAsNull: false });
    expect(r.ok && r.data.rows[0]).toEqual([{ kind: 'string', value: '1' }, { kind: 'string', value: '' }]);
  });

  it('names blank and duplicate headers', () => {
    const r = datasetFromCsv(',a,a\n1,2,3\n', { detectTypes: true, emptyAsNull: true });
    expect(r.ok && r.data.columns).toEqual(['column_1', 'a', 'a_2']);
  });
});

describe('csvCell', () => {
  it('detects numbers without leading zeros, booleans and NULL', () => {
    expect(csvCell('-12.5e3', true, true)).toEqual({ kind: 'number', text: '-12.5e3' });
    expect(csvCell('007', true, true)).toEqual({ kind: 'string', value: '007' });
    expect(csvCell('True', true, true)).toEqual({ kind: 'bool', value: true });
    expect(csvCell('NULL', true, true)).toEqual({ kind: 'null' });
    expect(csvCell('NULL', false, true)).toEqual({ kind: 'string', value: 'NULL' });
    expect(csvCell('', true, false)).toEqual({ kind: 'string', value: '' });
  });
});

describe('escaping', () => {
  it('doubles single quotes and keeps backslashes in standard SQL', () => {
    expect(stringLiteral("O'Brien \\ C:\\new", 'postgresql')).toBe("'O''Brien \\ C:\\new'");
    expect(stringLiteral("it's", 'ansi')).toBe("'it''s'");
    expect(stringLiteral('a\nb', 'sqlite')).toBe("'a\nb'");
  });

  it('escapes backslashes and control characters for MySQL', () => {
    expect(stringLiteral("O'Brien \\ C:\\new", 'mysql')).toBe("'O''Brien \\\\ C:\\\\new'");
    expect(stringLiteral('line1\nline2\r\u0000\u001a', 'mysql')).toBe("'line1\\nline2\\r\\0\\Z'");
  });

  it("uses N'' for non-ASCII text in SQL Server", () => {
    expect(stringLiteral('café 😀', 'sqlserver')).toBe("N'café 😀'");
    expect(stringLiteral('plain', 'sqlserver')).toBe("'plain'");
  });

  it('removes NUL characters where text cannot hold them', () => {
    const stats = { nulCharsRemoved: 0, emptyStrings: 0, longStrings: 0, convertedTimes: 0 };
    expect(stringLiteral('a\u0000b', 'postgresql', stats)).toBe("'ab'");
    expect(stats.nulCharsRemoved).toBe(1);
  });

  it('writes booleans per dialect', () => {
    const t = { kind: 'bool' as const, value: true };
    expect(valueLiteral(t, 'postgresql')).toBe('TRUE');
    expect(valueLiteral(t, 'mysql')).toBe('TRUE');
    expect(valueLiteral(t, 'sqlite')).toBe('1');
    expect(valueLiteral({ kind: 'bool', value: false }, 'sqlserver')).toBe('0');
    expect(valueLiteral(t, 'oracle')).toBe('1');
  });
});

describe('identifiers', () => {
  it('quotes with the dialect default or a chosen style', () => {
    expect(quoteIdentifier('first name', 'postgresql', 'auto')).toBe('"first name"');
    expect(quoteIdentifier('id', 'mysql', 'auto')).toBe('`id`');
    expect(quoteIdentifier('id', 'sqlserver', 'auto')).toBe('[id]');
    expect(quoteIdentifier('a"b', 'postgresql', 'double')).toBe('"a""b"');
    expect(quoteIdentifier('a`b', 'mysql', 'backtick')).toBe('`a``b`');
    expect(quoteIdentifier('a]b', 'sqlserver', 'bracket')).toBe('[a]]b]');
  });

  it('quotes only when needed in minimal mode', () => {
    expect(quoteIdentifier('user_id', 'postgresql', 'minimal')).toBe('user_id');
    expect(quoteIdentifier('order', 'postgresql', 'minimal')).toBe('"order"');
    expect(quoteIdentifier('userId', 'postgresql', 'minimal')).toBe('"userId"');
    expect(quoteIdentifier('userId', 'mysql', 'minimal')).toBe('userId');
    expect(quoteIdentifier('first name', 'mysql', 'minimal')).toBe('`first name`');
    expect(quoteIdentifier('名前', 'sqlite', 'minimal')).toBe('"名前"');
  });

  it('splits qualified table names', () => {
    expect(splitQualifiedName('public.users')).toEqual(['public', 'users']);
    expect(splitQualifiedName('"my schema"."a.b"')).toEqual(['my schema', 'a.b']);
    expect(splitQualifiedName('[dbo].[Order Details]')).toEqual(['dbo', 'Order Details']);
    expect(splitQualifiedName('`a``b`')).toEqual(['a`b']);
    for (const bad of ['', '  ', 'a.', '.a', 'a..b', '"open']) expect(splitQualifiedName(bad), bad).toBeNull();
  });
});

describe('type inference', () => {
  it('infers numeric, boolean, date and text types', () => {
    const d = data(
      '[{"i":1,"b":3000000000,"d":1.5,"f":1e3,"t":true,"day":"2024-01-31","ts":"2024-01-31T10:00:00","tz":"2024-01-31T10:00:00Z","s":"hello","j":{"a":1},"n":null},' +
        '{"i":-2,"b":1,"d":22.25,"f":2,"t":false,"day":"2024-02-29","ts":"2024-01-31 10:00:00.5","tz":"2024-01-31T10:00:00+05:30","s":"hi","j":[1],"n":null}]',
    );
    const kinds = inferColumnTypes(d, true).map((t) => t.kind);
    expect(kinds).toEqual(['integer', 'bigint', 'decimal', 'float', 'boolean', 'date', 'timestamp', 'timestamptz', 'string', 'json', 'unknown']);
  });

  it('widens mixed columns', () => {
    const d = data('[{"a":1,"b":"2024-01-01","c":1,"d":{"x":1}},{"a":2.5,"b":"2024-01-01T00:00:00Z","c":"x","d":"text"}]');
    expect(inferColumnTypes(d, true).map((t) => t.kind)).toEqual(['decimal', 'timestamptz', 'string', 'string']);
  });

  it('can ignore dates', () => {
    expect(inferColumnTypes(data('[{"d":"2024-01-01"}]'), false)[0].kind).toBe('string');
  });

  it('names types per dialect', () => {
    const [id, price, name, when] = inferColumnTypes(data('[{"id":1,"price":12.50,"name":"abc","when":"2024-01-01T10:00:00Z"}]'), true);
    expect(sqlTypeName(id, 'oracle')).toBe('NUMBER(10)');
    expect(sqlTypeName(price, 'postgresql')).toBe('NUMERIC(4, 2)');
    expect(sqlTypeName(price, 'sqlite')).toBe('REAL');
    expect(sqlTypeName(name, 'mysql')).toBe('VARCHAR(16)');
    expect(sqlTypeName(name, 'sqlserver')).toBe('NVARCHAR(16)');
    expect(sqlTypeName(name, 'oracle')).toBe('VARCHAR2(16 CHAR)');
    expect(sqlTypeName(when, 'sqlserver')).toBe('DATETIMEOFFSET');
    expect(sqlTypeName(when, 'postgresql')).toBe('TIMESTAMPTZ');
  });

  it('uses large text types for long strings', () => {
    const [t] = inferColumnTypes(data(JSON.stringify([{ s: 'x'.repeat(5000) }])), true);
    expect(sqlTypeName(t, 'sqlserver')).toBe('NVARCHAR(MAX)');
    expect(sqlTypeName(t, 'oracle')).toBe('CLOB');
    expect(sqlTypeName(t, 'mysql')).toBe('VARCHAR(5000)');
  });

  it('checks dates strictly', () => {
    expect(dateKind('2023-02-29')).toBeNull();
    expect(dateKind('2024-02-29')).toBe('date');
    expect(dateKind('2024-01-01T24:00:00')).toBeNull();
    expect(dateKind('2024-01-01T10:00')).toBeNull();
    expect(dateKind('2024-01-01T10:00:00+0530')).toBe('timestamptz');
  });
});

describe('generateInserts', () => {
  const JSON_ROWS = '[{"id":1,"name":"O\'Brien","active":true},{"id":2,"name":"Zoë","active":false},{"id":3,"name":null,"active":true}]';

  it('writes one statement per row by default', () => {
    expect(sql(JSON_ROWS)).toBe(
      'INSERT INTO "users" ("id", "name", "active") VALUES (1, \'O\'\'Brien\', TRUE);\n' +
        'INSERT INTO "users" ("id", "name", "active") VALUES (2, \'Zoë\', FALSE);\n' +
        'INSERT INTO "users" ("id", "name", "active") VALUES (3, NULL, TRUE);\n',
    );
  });

  it('batches rows into multi-row VALUES', () => {
    expect(sql(JSON_ROWS, { batchSize: 2, dialect: 'mysql' })).toBe(
      "INSERT INTO `users` (`id`, `name`, `active`) VALUES\n  (1, 'O''Brien', TRUE),\n  (2, 'Zoë', FALSE);\n" +
        'INSERT INTO `users` (`id`, `name`, `active`) VALUES (3, NULL, TRUE);\n',
    );
  });

  it('uses INSERT ALL for Oracle batches', () => {
    expect(sql('[{"a":1},{"a":2}]', { dialect: 'oracle', batchSize: 10 })).toBe(
      'INSERT ALL\n  INTO "users" ("a") VALUES (1)\n  INTO "users" ("a") VALUES (2)\nSELECT 1 FROM DUAL;\n',
    );
  });

  it('limits SQL Server batches to 1,000 rows', () => {
    const rows = JSON.stringify(Array.from({ length: 1500 }, (_, i) => ({ i })));
    const r = generateInserts(data(rows), { ...O, dialect: 'sqlserver', batchSize: 5000 });
    expect(r.ok && r.statements).toBe(2);
    expect(r.ok && r.warnings[0]).toMatch(/at most 1,000 rows/);
  });

  it('adds CREATE TABLE and a transaction', () => {
    expect(sql('[{"id":1,"name":"a","at":"2024-05-01"}]', { createTable: true, transaction: true })).toBe(
      'BEGIN;\n\nCREATE TABLE "users" (\n  "id" INTEGER,\n  "name" TEXT,\n  "at" DATE\n);\n\n' +
        'INSERT INTO "users" ("id", "name", "at") VALUES (1, \'a\', \'2024-05-01\');\n\nCOMMIT;\n',
    );
    expect(sql('[{"a":1}]', { dialect: 'sqlserver', transaction: true })).toBe(
      'BEGIN TRANSACTION;\n\nINSERT INTO [users] ([a]) VALUES (1);\n\nCOMMIT TRANSACTION;\n',
    );
    expect(sql('[{"a":1}]', { dialect: 'oracle', transaction: true })).toBe('INSERT INTO "users" ("a") VALUES (1);\n\nCOMMIT;\n');
  });

  it('writes typed date literals for Oracle and standard SQL', () => {
    const rows = '[{"d":"2024-05-01","t":"2024-05-01T10:20:30.5","z":"2024-05-01T10:20:30Z"}]';
    expect(sql(rows, { dialect: 'oracle' })).toBe(
      'INSERT INTO "users" ("d", "t", "z") VALUES (DATE \'2024-05-01\', TIMESTAMP \'2024-05-01 10:20:30.5\', TIMESTAMP \'2024-05-01 10:20:30 +00:00\');\n',
    );
    expect(sql(rows, { dialect: 'ansi' })).toContain("TIMESTAMP '2024-05-01 10:20:30+00:00'");
  });

  it('converts offset timestamps to UTC for MySQL', () => {
    const r = generateInserts(data('[{"z":"2024-05-01T10:20:30+02:00"}]'), { ...O, dialect: 'mysql' });
    expect(r.ok && r.sql).toBe("INSERT INTO `users` (`z`) VALUES ('2024-05-01 08:20:30');\n");
    expect(r.ok && r.warnings).toContain('Timestamps with a UTC offset were converted to UTC, because MySQL DATETIME has no time zone.');
  });

  it('writes nested values as JSON text', () => {
    expect(sql('[{"meta":{"k":"it\'s","n":[1,2.0]}}]')).toBe('INSERT INTO "users" ("meta") VALUES (\'{"k":"it\'\'s","n":[1,2.0]}\');\n');
  });

  it('keeps big and precise numbers exactly', () => {
    expect(sql('[{"n":12345678901234567890123,"d":0.10000000000000000001}]')).toBe(
      'INSERT INTO "users" ("n", "d") VALUES (12345678901234567890123, 0.10000000000000000001);\n',
    );
  });

  it('quotes schema-qualified names and supports minimal quoting', () => {
    expect(sql('[{"id":1,"Order":2}]', { table: 'app.Orders', quoting: 'minimal' })).toBe('INSERT INTO app."Orders" (id, "Order") VALUES (1, 2);\n');
  });

  it('can omit the column list', () => {
    const r = generateInserts(data('[{"a":1}]'), { ...O, includeColumns: false });
    expect(r.ok && r.sql).toBe('INSERT INTO "users" VALUES (1);\n');
    expect(r.ok && r.warnings[0]).toMatch(/same order/);
  });

  it('warns about Oracle empty strings and long literals', () => {
    const r = generateInserts(data(JSON.stringify([{ a: '', b: 'é'.repeat(2500) }])), { ...O, dialect: 'oracle' });
    expect(r.ok && r.warnings).toEqual([
      'Oracle stores empty strings as NULL.',
      '1 string is longer than 4,000 bytes, the limit for an Oracle string literal (ORA-01704). Load it with a bind variable or TO_CLOB pieces instead.',
    ]);
  });

  it('rejects a missing or malformed table name', () => {
    expect(generateInserts(data('[{"a":1}]'), { ...O, table: ' ' })).toEqual({ ok: false, error: 'Enter a table name.' });
    expect(generateInserts(data('[{"a":1}]'), { ...O, table: 'a..b' }).ok).toBe(false);
  });

  it('generates from CSV end to end', () => {
    const d = datasetFromCsv('id,name\n1,"a ""quoted"" name"\n2,\\\n', { detectTypes: true, emptyAsNull: true });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    const r = generateInserts(d.data, { ...O, dialect: 'mysql', batchSize: 100 });
    expect(r.ok && r.sql).toBe('INSERT INTO `users` (`id`, `name`) VALUES\n  (1, \'a "quoted" name\'),\n  (2, \'\\\\\');\n');
  });

  it('handles many rows', () => {
    const rows = JSON.stringify(Array.from({ length: 20000 }, (_, i) => ({ id: i, name: `n${i}` })));
    const r = generateInserts(data(rows), { ...O, batchSize: 500 });
    expect(r.ok && r.statements).toBe(40);
    expect(r.ok && r.rows).toBe(20000);
  });
});
