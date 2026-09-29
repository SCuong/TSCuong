import { describe, expect, it } from 'vitest';
import { inferValue, jsonToTable, locateRecords, stringify, tableToJsonValue } from './csvJson';
import { parseCsv, writeCsv } from './csv';

describe('inferValue', () => {
  it('converts numbers, booleans, null and empty cells', () => {
    expect(inferValue('42')).toBe(42);
    expect(inferValue('-3.5')).toBe(-3.5);
    expect(inferValue('1e3')).toBe(1000);
    expect(inferValue('true')).toBe(true);
    expect(inferValue('FALSE')).toBe(false);
    expect(inferValue('null')).toBeNull();
    expect(inferValue('')).toBeNull();
  });
  it('keeps values that would lose information as strings', () => {
    expect(inferValue('007')).toBe('007');
    expect(inferValue('12345678901234567890')).toBe('12345678901234567890');
    expect(inferValue('1e999')).toBe('1e999');
    expect(inferValue('1,000')).toBe('1,000');
    expect(inferValue(' 5')).toBe(' 5');
    expect(inferValue('yes')).toBe('yes');
  });
});

describe('tableToJsonValue', () => {
  const table = {
    headers: ['id', 'name', 'active'],
    rows: [
      ['1', 'Ada', 'true'],
      ['2', 'Zoë 👩‍💻', ''],
    ],
  };

  it('builds an array of typed objects', () => {
    expect(tableToJsonValue(table)).toEqual([
      { id: 1, name: 'Ada', active: true },
      { id: 2, name: 'Zoë 👩‍💻', active: null },
    ]);
  });

  it('keeps strings when typing is off', () => {
    expect(tableToJsonValue(table, { typed: false })).toEqual([
      { id: '1', name: 'Ada', active: 'true' },
      { id: '2', name: 'Zoë 👩‍💻', active: '' },
    ]);
  });

  it('builds arrays and columns shapes', () => {
    expect(tableToJsonValue(table, { shape: 'arrays' })).toEqual([
      ['id', 'name', 'active'],
      [1, 'Ada', true],
      [2, 'Zoë 👩‍💻', null],
    ]);
    expect(tableToJsonValue(table, { shape: 'columns' })).toEqual({ id: [1, 2], name: ['Ada', 'Zoë 👩‍💻'], active: [true, null] });
  });

  it('makes duplicate and empty headers unique', () => {
    expect(tableToJsonValue({ headers: ['a', 'a', ''], rows: [['1', '2', '3']] })).toEqual([{ a: 1, a_2: 2, column_3: 3 }]);
  });

  it('nests dotted headers into objects and arrays', () => {
    const t = { headers: ['id', 'address.city', 'address.zip', 'tags.0', 'tags.1'], rows: [['1', 'Oslo', '0150', 'x', 'y']] };
    expect(tableToJsonValue(t, { nest: true })).toEqual([{ id: 1, address: { city: 'Oslo', zip: '0150' }, tags: ['x', 'y'] }]);
  });

  it('fills holes in sparse nested arrays with null', () => {
    const t = { headers: ['tags.1'], rows: [['b']] };
    expect(JSON.stringify(tableToJsonValue(t, { nest: true }))).toBe('[{"tags":[null,"b"]}]');
  });

  it('keeps both a flat column and a nested one with the same root', () => {
    const t = { headers: ['a.b', 'a'], rows: [['1', '2']] };
    expect(tableToJsonValue(t, { nest: true })).toEqual([{ a: { b: 1 }, a_2: 2 }]);
  });

  it('falls back to a flat key when a path collides with a scalar', () => {
    const t = { headers: ['a', 'a.b'], rows: [['1', '2']] };
    expect(tableToJsonValue(t, { nest: true })).toEqual([{ a: 1, 'a.b': 2 }]);
  });

  it('treats __proto__ and constructor as ordinary keys', () => {
    const t = { headers: ['__proto__', 'constructor', 'x.__proto__.polluted'], rows: [['1', '2', '3']] };
    const value = tableToJsonValue(t, { nest: true });
    expect(JSON.parse(JSON.stringify(value))).toEqual([JSON.parse('{"__proto__":1,"constructor":2,"x":{"__proto__":{"polluted":3}}}')]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('handles an empty table', () => {
    expect(tableToJsonValue({ headers: [], rows: [] })).toEqual([]);
  });
});

describe('stringify', () => {
  it('supports indent options', () => {
    expect(stringify({ a: 1 }, 'min')).toBe('{"a":1}');
    expect(stringify({ a: 1 }, '4')).toBe('{\n    "a": 1\n}');
    expect(stringify({ a: 1 }, 'tab')).toBe('{\n\t"a": 1\n}');
  });
});

describe('locateRecords', () => {
  it('finds the largest nested array of objects', () => {
    const found = locateRecords({ meta: { count: 2 }, data: { items: [{ a: 1 }, { a: 2 }] }, other: [{ b: 1 }] });
    expect(found?.path).toBe('$.data.items');
    expect(found?.rows).toHaveLength(2);
  });
  it('quotes keys that are not identifiers', () => {
    expect(locateRecords({ 'my rows': [{ a: 1 }] })?.path).toBe('$["my rows"]');
  });
  it('returns null for scalars', () => {
    expect(locateRecords(5)).toBeNull();
  });
});

describe('jsonToTable', () => {
  it('flattens nested objects with a union of keys', () => {
    const r = jsonToTable([
      { id: 1, user: { name: 'Ada', tags: ['a', 'b'] } },
      { id: 2, extra: true },
    ]);
    expect(r.table.headers).toEqual(['id', 'user.name', 'user.tags', 'extra']);
    expect(r.table.rows).toEqual([
      ['1', 'Ada', '["a","b"]', ''],
      ['2', '', '', 'true'],
    ]);
  });

  it('keeps nested objects as JSON when flattening is off', () => {
    const r = jsonToTable([{ id: 1, user: { name: 'Ada' } }], { flatten: false });
    expect(r.table.headers).toEqual(['id', 'user']);
    expect(r.table.rows[0][1]).toBe('{"name":"Ada"}');
  });

  it('joins or indexes arrays', () => {
    expect(jsonToTable([{ t: ['a', 'b'] }], { arrays: 'join', joinWith: '|' }).table.rows).toEqual([['a|b']]);
    const indexed = jsonToTable([{ t: ['a', { x: 1 }] }], { arrays: 'index' });
    expect(indexed.table.headers).toEqual(['t.0', 't.1.x']);
    expect(indexed.table.rows).toEqual([['a', '1']]);
  });

  it('uses a custom separator', () => {
    expect(jsonToTable([{ a: { b: 1 } }], { separator: '_' }).table.headers).toEqual(['a_b']);
  });

  it('converts arrays of arrays, optionally with a header row', () => {
    expect(jsonToTable([[1, 'a'], [2]]).table).toEqual({
      headers: ['Column 1', 'Column 2'],
      rows: [
        ['1', 'a'],
        ['2', ''],
      ],
    });
    expect(
      jsonToTable(
        [
          ['id', 'name'],
          [1, 'x'],
        ],
        { firstRowHeader: true },
      ).table,
    ).toEqual({ headers: ['id', 'name'], rows: [['1', 'x']] });
  });

  it('finds records inside a wrapper object', () => {
    const r = jsonToTable({ total: 2, results: [{ a: 1 }, { a: 2 }] });
    expect(r.source).toBe('$.results');
    expect(r.table.rows).toEqual([['1'], ['2']]);
    expect(r.notes[0]).toMatch(/\$\.results/);
  });

  it('treats a single object as one row', () => {
    expect(jsonToTable({ a: 1, b: { c: 2 } }).table).toEqual({ headers: ['a', 'b.c'], rows: [['1', '2']] });
  });

  it('places primitives in a value column', () => {
    const r = jsonToTable([{ a: 1 }, 5, null]);
    expect(r.table.headers).toEqual(['a', 'value']);
    expect(r.table.rows).toEqual([
      ['1', ''],
      ['', '5'],
      ['', ''],
    ]);
    expect(r.notes[0]).toMatch(/2 non-object items/);
  });

  it('handles empty arrays and empty objects', () => {
    expect(jsonToTable([]).table).toEqual({ headers: [], rows: [] });
    expect(jsonToTable([{ a: {} }]).table).toEqual({ headers: ['a'], rows: [['{}']] });
  });

  it('rejects scalars', () => {
    expect(() => jsonToTable('x')).toThrow(/array or object/);
  });

  it('enforces the column limit', () => {
    const wide = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i]));
    expect(() => jsonToTable([wide], { maxColumns: 10 })).toThrow(/more than 10 columns/);
  });

  it('round-trips with CSV → JSON for flat data', () => {
    const csv = 'id,name,score\n1,Ada,9.5\n2,"Lee, Jr.",\n';
    const json = tableToJsonValue(parseCsv(csv).table);
    const back = writeCsv(jsonToTable(json).table);
    expect(back).toBe('id,name,score\n1,Ada,9.5\n2,"Lee, Jr.",');
  });

  it('handles a large array', () => {
    const rows = Array.from({ length: 10_000 }, (_, i) => ({ i, s: `row ${i}`, n: { v: i * 2 } }));
    const r = jsonToTable(rows);
    expect(r.table.rows).toHaveLength(10_000);
    expect(r.table.rows[9999]).toEqual(['9999', 'row 9999', '19998']);
  });
});
