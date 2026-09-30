import { describe, expect, it } from 'vitest';
import { base64, cellKind, cellPreview, hexDump, rowToObject, rowToTsv, textValue, toCsv, toJson, toJsonText, toSqlDump, toTsv } from './sqlFormat';
import { addToHistory, parseHistory } from './history';
import { formatSqliteVersionNumber, isWalMode, missingBytes, parseSqliteHeader } from './sqliteHeader';

describe('export formats', () => {
  const columns = ['id', 'name', 'data'];
  const rows = [
    [1, 'Ann, "A"', null],
    [2, 'Émile 🎉\nline2', new Uint8Array([1, 2, 255])],
  ];

  it('writes CSV with quoting and hex blobs', () => {
    expect(toCsv(columns, rows)).toBe('id,name,data\r\n1,"Ann, ""A""",\r\n2,"Émile 🎉\nline2",0x0102ff\r\n');
    expect(toCsv(['a'], [])).toBe('a\r\n');
  });

  it('writes JSON with base64 blobs and de-duplicated keys', () => {
    expect(JSON.parse(toJson(columns, rows))).toEqual([
      { id: 1, name: 'Ann, "A"', data: null },
      { id: 2, name: 'Émile 🎉\nline2', data: 'AQL/' },
    ]);
    expect(rowToObject(['a', 'a', 'a'], [1, 2, 3])).toEqual({ a: 1, a_2: 2, a_3: 3 });
  });

  it('writes TSV with escaped control characters', () => {
    expect(rowToTsv(['a\tb', 'c\nd', null, 3])).toBe('a\\tb\tc\\nd\t\t3');
    expect(toTsv(['x'], [['y']])).toBe('x\ny');
  });

  it('writes a SQL dump that can be replayed', () => {
    const dump = toSqlDump('t"x', 'CREATE TABLE "t""x" (id, name, data)', columns, rows);
    expect(dump).toBe(
      [
        'CREATE TABLE "t""x" (id, name, data);',
        'BEGIN TRANSACTION;',
        `INSERT INTO "t""x" ("id", "name", "data") VALUES (1, 'Ann, "A"', NULL);`,
        `INSERT INTO "t""x" ("id", "name", "data") VALUES (2, 'Émile 🎉\nline2', X'0102FF');`,
        'COMMIT;',
        '',
      ].join('\n'),
    );
    expect(toSqlDump('t', null, ['a'], [])).toBe('\n');
  });

  it('encodes large blobs as base64 without stack overflow', () => {
    const big = new Uint8Array(200_000).fill(65);
    expect(base64(big).length).toBe(Math.ceil(200_000 / 3) * 4);
  });

  it('keeps 64-bit integers exact in CSV, JSON, TSV and SQL dumps', () => {
    const max = 9223372036854775807n;
    const min = -9223372036854775808n;
    const cols = ['id', 'big'];
    const data = [
      [1, max],
      [2, min],
    ];
    expect(toCsv(cols, data)).toBe('id,big\r\n1,9223372036854775807\r\n2,-9223372036854775808\r\n');
    expect(toJson(cols, data)).toBe(
      '[\n  {\n    "id": 1,\n    "big": 9223372036854775807\n  },\n  {\n    "id": 2,\n    "big": -9223372036854775808\n  }\n]',
    );
    expect(rowToTsv([max])).toBe('9223372036854775807');
    expect(toSqlDump('t', null, cols, data)).toContain('VALUES (1, 9223372036854775807);');
    expect(cellKind(max)).toBe('integer');
    expect(cellPreview(max)).toBe('9223372036854775807');
  });

  it('writes exact JSON for nested BigInts without touching look-alike strings', () => {
    expect(toJsonText({ a: [1n, 12345678901234567890n], s: '12345678901234567890' })).toBe('{"a":[1,12345678901234567890],"s":"12345678901234567890"}');
    expect(toJsonText({ a: 'x' }, 2)).toBe('{\n  "a": "x"\n}');
  });
});

describe('cell helpers', () => {
  it('detects kinds', () => {
    expect(cellKind(null)).toBe('null');
    expect(cellKind(3)).toBe('integer');
    expect(cellKind(3.5)).toBe('real');
    expect(cellKind('x')).toBe('text');
    expect(cellKind(new Uint8Array(1))).toBe('blob');
  });

  it('previews long and multi-line text', () => {
    expect(cellPreview('a\nb')).toBe('a ↵ b');
    const long = 'x'.repeat(1000);
    expect(cellPreview(long, 10)).toBe('xxxxxxxxxx…');
    expect(cellPreview(null)).toBe('NULL');
    expect(cellPreview(new Uint8Array(2048))).toBe('BLOB · 2.0 KB');
    expect(textValue(null)).toBe('');
  });

  it('hex dumps with offsets and ASCII', () => {
    const dump = hexDump(new TextEncoder().encode('SQLite format 3\0abc'));
    expect(dump.split('\n')[0]).toBe('00000000  53 51 4c 69 74 65 20 66 6f 72 6d 61 74 20 33 00  SQLite format 3.');
    expect(dump.split('\n')[1]).toMatch(/^00000010 {2}61 62 63\s+abc$/);
    expect(hexDump(new Uint8Array(300), 32).split('\n').at(-1)).toBe('… 268 more bytes');
  });
});

describe('sqlite header', () => {
  function header(overrides: (b: Uint8Array, v: DataView) => void = () => {}) {
    const bytes = new Uint8Array(4096);
    bytes.set(new TextEncoder().encode('SQLite format 3\0'));
    const view = new DataView(bytes.buffer);
    view.setUint16(16, 4096);
    view.setUint32(28, 7);
    view.setUint32(56, 1);
    view.setInt32(60, 12);
    view.setUint32(96, 3045001);
    overrides(bytes, view);
    return bytes;
  }

  it('parses a valid header', () => {
    const res = parseSqliteHeader(header());
    expect(res).toEqual({
      ok: true,
      header: expect.objectContaining({ pageSize: 4096, pageCount: 7, encoding: 'UTF-8', userVersion: 12, sqliteVersionNumber: 3045001 }),
    });
    expect(formatSqliteVersionNumber(3045001)).toBe('3.45.1');
  });

  it('handles 64 KiB pages (stored as 1)', () => {
    const res = parseSqliteHeader(header((_, v) => v.setUint16(16, 1)));
    expect(res.ok && res.header.pageSize).toBe(65536);
  });

  it('detects WAL mode and truncated files from the header', () => {
    const plain = parseSqliteHeader(header((b) => b.set([1, 1], 18)));
    expect(plain.ok && isWalMode(plain.header)).toBe(false);
    const wal = parseSqliteHeader(header((b) => b.set([2, 2], 18)));
    expect(wal.ok && isWalMode(wal.header)).toBe(true);
    // 7 pages of 4 KiB are described; the in-header size counts once version-valid-for equals the change counter.
    const valid = header((_, v) => {
      v.setUint32(24, 5);
      v.setUint32(92, 5);
    });
    const res = parseSqliteHeader(valid, 4096 * 3);
    expect(res.ok && res.header.sizeValid).toBe(true);
    expect(res.ok && missingBytes(res.header, 4096 * 3)).toBe(4096 * 4);
    expect(res.ok && missingBytes(res.header, 4096 * 7)).toBe(0);
    // A stale in-header size (older writers) is ignored.
    const stale = parseSqliteHeader(header((_, v) => v.setUint32(24, 9)), 4096);
    expect(stale.ok && missingBytes(stale.header, 4096)).toBe(0);
  });

  it('rejects empty, short, foreign and corrupt files', () => {
    expect(parseSqliteHeader(new Uint8Array(0))).toEqual({ ok: false, error: 'The file is empty.' });
    expect(parseSqliteHeader(new Uint8Array(50)).ok).toBe(false);
    const pdf = new Uint8Array(200);
    pdf.set(new TextEncoder().encode('%PDF-1.7'));
    expect(parseSqliteHeader(pdf)).toMatchObject({ ok: false, error: expect.stringMatching(/not a SQLite database/) });
    const script = new TextEncoder().encode('CREATE TABLE t (a);' + ' '.repeat(100));
    expect(parseSqliteHeader(script)).toMatchObject({ ok: false, error: expect.stringMatching(/SQL text script/) });
    expect(parseSqliteHeader(header((_, v) => v.setUint16(16, 1000))).ok).toBe(false);
  });
});

describe('query history', () => {
  it('keeps the newest 50, moving repeated queries to the top', () => {
    let list = parseHistory(null);
    for (let i = 0; i < 60; i++) list = addToHistory(list, { sql: `SELECT ${i}`, at: i, ok: true, ms: 1 });
    expect(list).toHaveLength(50);
    expect(list[0].sql).toBe('SELECT 59');
    list = addToHistory(list, { sql: '  SELECT 30 ', at: 100, ok: false, ms: 2 });
    expect(list[0]).toEqual({ sql: 'SELECT 30', at: 100, ok: false, ms: 2 });
    expect(list.filter((e) => e.sql === 'SELECT 30')).toHaveLength(1);
    expect(addToHistory(list, { sql: '   ', at: 1, ok: true, ms: 0 })).toBe(list);
  });

  it('parses stored history defensively', () => {
    expect(parseHistory('not json')).toEqual([]);
    expect(parseHistory('{"a":1}')).toEqual([]);
    expect(parseHistory('[{"sql":"SELECT 1","at":5},{"bad":true}]')).toEqual([{ sql: 'SELECT 1', at: 5, ok: true, ms: 0 }]);
  });
});
