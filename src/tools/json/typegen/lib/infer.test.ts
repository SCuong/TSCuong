import { describe, expect, it } from 'vitest';
import { detectFormats, formatFromMask, FORMAT_BITS } from './formats';
import { inferModel, inferShape, JsonSyntaxError, MAX_DEPTH, type ObjectDef, type TypeRef, type TypeModel } from './infer';
import { pascalCase } from './naming';

const name = (def: ObjectDef) => pascalCase(def.words);
const byName = (model: TypeModel, n: string) => {
  const def = model.objects.find((d) => name(d) === n);
  if (!def) throw new Error(`No type ${n} in ${model.objects.map(name).join(', ')}`);
  return def;
};
const field = (def: ObjectDef, key: string) => {
  const f = def.fields.find((x) => x.key === key);
  if (!f) throw new Error(`No field ${key}`);
  return f;
};

/** Compact description of a type for assertions. */
function show(t: TypeRef): string {
  const n = t.nullable ? '?' : '';
  switch (t.kind) {
    case 'array':
      return `${show(t.items)}[]${n}`;
    case 'object':
      return `${name(t.def)}${n}`;
    case 'map':
      return `map<${show(t.values)}>${n}`;
    case 'union':
      return `(${t.members.map(show).join('|')})${n}`;
    case 'string':
      return `string${t.format ? `:${t.format}` : ''}${n}`;
    case 'unknown':
      return `unknown(${t.reason})${n}`;
    default:
      return `${t.kind}${n}`;
  }
}

describe('inferShape parsing', () => {
  it('tells integers from floats by their spelling', () => {
    const m = inferModel('{"a": 1, "b": 1.0, "c": 1e3, "d": -0, "e": 2.5E-3}');
    const root = m.objects[0];
    expect(show(field(root, 'a').type)).toBe('integer');
    expect(show(field(root, 'b').type)).toBe('number');
    expect(show(field(root, 'c').type)).toBe('number');
    expect(show(field(root, 'd').type)).toBe('integer');
    expect(show(field(root, 'e').type)).toBe('number');
  });

  it('keeps key order, including numeric-looking keys mixed with names', () => {
    const m = inferModel('{"zeta": 1, "10": 2, "alpha": 3, "2": 4}');
    expect(m.objects[0].fields.map((f) => f.key)).toEqual(['zeta', '10', 'alpha', '2']);
  });

  it('applies last-duplicate-wins like JSON.parse', () => {
    const m = inferModel('{"a": 1, "b": true, "a": "text"}');
    expect(m.objects[0].fields.map((f) => [f.key, show(f.type)])).toEqual([
      ['a', 'string'],
      ['b', 'boolean'],
    ]);
  });

  it('handles __proto__ and other special keys as ordinary fields', () => {
    const m = inferModel('{"__proto__": {"x": 1}, "constructor": "c"}');
    expect(m.objects[0].fields.map((f) => f.key)).toEqual(['__proto__', 'constructor']);
  });

  it('decodes escapes in keys and strings', () => {
    const m = inferModel('{"a\\u00e9\\n": "https:\\/\\/example.com\\/x"}');
    const f = m.objects[0].fields[0];
    expect(f.key).toBe('aé\n');
    expect(show(f.type)).toBe('string:uri');
  });

  it('accepts a byte order mark and surrounding whitespace', () => {
    expect(inferModel('﻿ \n {"a": 1} \r\n').objects).toHaveLength(1);
  });

  it.each([
    ['', 'Input is empty'],
    ['{', 'Expected a property name'],
    ['{"a":1,}', 'Expected a property name'],
    ['[1,]', 'Unexpected character'],
    ['{"a" 1}', "Expected ':'"],
    ['[01]', "Expected ',' or ']'"],
    ['"abc', 'Unterminated string'],
    ['"a\\x"', 'Invalid escape'],
    ['"a\tb"', 'Control character in string'],
    ['tru', 'Invalid literal'],
    ['1.', 'Invalid number'],
    ['1e', 'Invalid number'],
    ['{} {}', 'Unexpected data after the JSON value'],
    ["{'a': 1}", 'Expected a property name'],
  ])('rejects %j', (text, message) => {
    expect(() => inferShape(text)).toThrow(JsonSyntaxError);
    expect(() => inferShape(text)).toThrow(message);
  });

  it('summarizes very deep nesting as unknown without overflowing the stack', () => {
    const depth = 50_000;
    const text = `{"deep": ${'['.repeat(depth)}1${']'.repeat(depth)}}`;
    const m = inferModel(text);
    const t = field(m.objects[0], 'deep').type;
    let levels = 0;
    let cur = t;
    while (cur.kind === 'array') {
      levels++;
      cur = cur.items;
    }
    expect(levels).toBe(MAX_DEPTH - 1);
    expect(cur).toMatchObject({ kind: 'unknown', reason: 'deep' });
    expect(m.warnings[0]).toMatch(/deeper than/);
  });

  it('still rejects invalid JSON hidden inside skipped deep nesting', () => {
    const text = `${'['.repeat(MAX_DEPTH + 5)}1,${']'.repeat(MAX_DEPTH + 5)}`;
    expect(() => inferShape(text)).toThrow(JsonSyntaxError);
  });
});

describe('merging rules', () => {
  it('marks keys missing from some objects as optional', () => {
    const m = inferModel('[{"a": 1, "b": 2}, {"a": 3}]');
    const item = m.objects[0];
    expect(field(item, 'a').optional).toBe(false);
    expect(field(item, 'b').optional).toBe(true);
  });

  it('marks keys that were null somewhere as nullable', () => {
    const m = inferModel('[{"a": 1}, {"a": null}]');
    expect(show(field(m.objects[0], 'a').type)).toBe('integer?');
    expect(field(m.objects[0], 'a').optional).toBe(false);
  });

  it('merges integers and floats into number', () => {
    const m = inferModel('[1, 2.5, 3]');
    expect(show(m.root)).toBe('number[]');
  });

  it('builds unions for mixed kinds', () => {
    expect(show(inferModel('[1, "a", true]').root)).toBe('(boolean|integer|string)[]');
    expect(show(inferModel('[1, "a", null]').root)).toBe('(integer|string)?[]');
    expect(show(inferModel('[{"a": 1}, "x"]').root)).toBe('(string|RootItem)[]');
  });

  it('types only-null values as null with a note', () => {
    const m = inferModel('{"a": null}');
    const f = field(m.objects[0], 'a');
    expect(show(f.type)).toBe('null');
    expect(f.note).toMatch(/Only null/);
  });

  it('types always-empty arrays as unknown items with a note', () => {
    const m = inferModel('{"tags": [], "more": [[], []]}');
    expect(show(field(m.objects[0], 'tags').type)).toBe('unknown(empty-array)[]');
    expect(field(m.objects[0], 'tags').note).toMatch(/empty array/);
    expect(show(field(m.objects[0], 'more').type)).toBe('unknown(empty-array)[][]');
  });

  it('uses items from non-empty arrays when some arrays are empty', () => {
    const m = inferModel('[{"tags": []}, {"tags": ["a"]}]');
    expect(show(field(m.objects[0], 'tags').type)).toBe('string[]');
    expect(field(m.objects[0], 'tags').note).toBeUndefined();
  });

  it('merges nested objects across array items', () => {
    const m = inferModel('[{"p": {"x": 1}}, {"p": {"x": 2, "y": "a"}}, {"p": null}]');
    const p = byName(m, 'P');
    expect(field(p, 'x').optional).toBe(false);
    expect(field(p, 'y').optional).toBe(true);
    expect(show(field(m.objects[0], 'p').type)).toBe('P?');
  });

  it('merges nested arrays of arrays', () => {
    expect(show(inferModel('[[1, 2], [3.5], []]').root)).toBe('number[][]');
  });

  it('treats objects keyed by ids, numbers or dates as maps', () => {
    const m = inferModel(
      '{"users": {"1": {"n": "a"}, "2": {"n": "b", "x": 1}}, "days": {"2024-01-01": 3}, "byId": {"123e4567-e89b-12d3-a456-426614174000": true}}',
    );
    expect(show(field(m.objects[0], 'users').type)).toBe('map<User>');
    expect(show(field(m.objects[0], 'days').type)).toBe('map<integer>');
    expect(show(field(m.objects[0], 'byId').type)).toBe('map<boolean>');
    // Values of a map are merged like array items.
    expect(field(byName(m, 'User'), 'x').optional).toBe(true);
    expect(field(byName(m, 'User'), 'n').optional).toBe(false);
  });

  it('keeps ordinary objects as objects', () => {
    const m = inferModel('{"rates": {"USD": 1, "EUR": 0.9}}');
    expect(show(field(m.objects[0], 'rates').type)).toBe('Rates');
  });

  it('types empty objects as maps of unknown', () => {
    const m = inferModel('{"meta": {}}');
    expect(show(field(m.objects[0], 'meta').type)).toBe('map<unknown(empty-object)>');
  });

  it('handles top-level arrays and primitives', () => {
    expect(show(inferModel('[{"a": 1}]').root)).toBe('RootItem[]');
    expect(show(inferModel('[{"a": 1}]', { rootName: 'users' }).root)).toBe('User[]');
    expect(show(inferModel('"x"').root)).toBe('string');
    expect(show(inferModel('42').root)).toBe('integer');
    expect(show(inferModel('null').root)).toBe('null');
    expect(show(inferModel('[]').root)).toBe('unknown(empty-array)[]');
    expect(inferModel('[]').rootNote).toMatch(/empty array/);
  });
});

describe('null handling modes', () => {
  const sample = '[{"a": 1, "b": null, "c": "x"}, {"a": 2, "b": 5}]';
  it('exact keeps optional and nullable separate', () => {
    const def = inferModel(sample).objects[0];
    expect([field(def, 'b').optional, show(field(def, 'b').type)]).toEqual([false, 'integer?']);
    expect([field(def, 'c').optional, show(field(def, 'c').type)]).toEqual([true, 'string']);
  });
  it('loose makes optional or nullable fields both', () => {
    const def = inferModel(sample, { nullMode: 'loose' }).objects[0];
    expect([field(def, 'a').optional, show(field(def, 'a').type)]).toEqual([false, 'integer']);
    expect([field(def, 'b').optional, show(field(def, 'b').type)]).toEqual([true, 'integer?']);
    expect([field(def, 'c').optional, show(field(def, 'c').type)]).toEqual([true, 'string?']);
  });
  it('all-optional makes every field optional', () => {
    const def = inferModel(sample, { nullMode: 'all-optional' }).objects[0];
    expect(def.fields.every((f) => f.optional)).toBe(true);
    expect(show(field(def, 'c').type)).toBe('string');
  });
});

describe('naming', () => {
  it('names nested objects after their keys and array items in the singular', () => {
    const m = inferModel('{"user": {"addresses": [{"city": "x"}], "profile": {"bio": "b"}}}');
    expect(m.objects.map(name)).toEqual(['Root', 'User', 'Address', 'Profile']);
  });

  it('uses the root name option', () => {
    expect(inferModel('{"a": 1}', { rootName: 'api response' }).objects.map(name)).toEqual(['ApiResponse']);
    expect(inferModel('{"a": 1}', { rootName: '  ' }).objects.map(name)).toEqual(['Root']);
    expect(inferModel('{"a": 1}', { rootName: '日本' }).objects.map(name)).toEqual(['Root']);
  });

  it('shares one type between identical shapes, named by the common suffix', () => {
    const m = inferModel(
      '{"billingAddress": {"street": "a", "city": "b"}, "shippingAddress": {"city": "c", "street": "d"}}',
    );
    expect(m.objects.map(name)).toEqual(['Root', 'Address']);
    const root = m.objects[0];
    expect(field(root, 'billingAddress').type).toEqual(field(root, 'shippingAddress').type);
    // Field order follows the first occurrence.
    expect(byName(m, 'Address').fields.map((f) => f.key)).toEqual(['street', 'city']);
  });

  it('prefixes the parent name when different shapes want the same name', () => {
    const m = inferModel('{"owner": {"address": {"city": "x"}}, "store": {"address": {"zip": 1}}}');
    expect(m.objects.map(name)).toEqual(['Root', 'Owner', 'Address', 'Store', 'StoreAddress']);
  });

  it('falls back to numeric suffixes', () => {
    const m = inferModel('{"a": {"item": {"x": 1}}, "aItem": {"q": 1}, "b": {"item": {"y": 1}}}');
    const names = m.objects.map(name);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
    expect(names).toContain('Item');
  });

  it('never reuses the root name for a nested type', () => {
    const m = inferModel('{"root": {"x": 1}}');
    expect(m.objects.map(name)).toEqual(['Root', 'RootRoot']);
  });

  it('names types from keys without ASCII letters after their parent', () => {
    const m = inferModel('{"名前": {"x": 1}}');
    expect(m.objects.map(name)).toEqual(['Root', 'RootValue']);
  });

  it('names items of nested arrays once, not ItemItem', () => {
    expect(inferModel('{"grid": [[{"x": 1}]]}').objects.map(name)).toEqual(['Root', 'GridItem']);
    expect(inferModel('{"rows": [[[{"x": 1}]]]}').objects.map(name)).toEqual(['Root', 'Row']);
    expect(inferModel('{"groups": {"1": [{"x": 1}]}}').objects.map(name)).toEqual(['Root', 'Group']);
  });

  it('handles singular-looking array keys', () => {
    expect(inferModel('{"data": [{"x": 1}]}').objects.map(name)).toEqual(['Root', 'DataItem']);
    expect(inferModel('{"people": [{"x": 1}]}').objects.map(name)).toEqual(['Root', 'Person']);
  });
});

describe('scale', () => {
  it('infers a large array quickly', () => {
    const rows = Array.from({ length: 20_000 }, (_, i) => ({
      id: i,
      name: `user ${i}`,
      email: `u${i}@example.com`,
      score: i % 2 ? i / 2 : i,
      tags: i % 3 ? ['a'] : [],
      meta: i % 5 ? { ok: true } : null,
    }));
    const text = JSON.stringify(rows);
    const started = performance.now();
    const m = inferModel(text);
    expect(performance.now() - started).toBeLessThan(3000);
    const item = m.objects[0];
    expect(show(field(item, 'email').type)).toBe('string:email');
    expect(show(field(item, 'score').type)).toBe('number');
    expect(show(field(item, 'meta').type)).toBe('Meta?');
    expect(item.samples).toBe(20_000);
  });
});

describe('detectFormats', () => {
  const fmt = (s: string) => formatFromMask(detectFormats(s));
  it.each([
    ['2024-03-18T09:30:00Z', 'date-time'],
    ['2024-03-18T09:30:00.123+02:00', 'date-time'],
    ['2024-02-29', 'date'],
    ['09:30:00Z', 'time'],
    ['ada@example.com', 'email'],
    ['first.last+tag@mail.example.co.uk', 'email'],
    ['https://example.com/a/b?c=d#e', 'uri'],
    ['http://localhost:5173/', 'uri'],
    ['123e4567-e89b-12d3-a456-426614174000', 'uuid'],
  ])('%s is %s', (value, format) => {
    expect(fmt(value)).toBe(format);
  });

  it.each([
    '2023-02-29',
    '2024-13-01',
    '2024-03-18 09:30:00',
    '2024-03-18T25:00:00Z',
    '09:30:00',
    'ada@',
    'a..b@example.com',
    '.a@example.com',
    'ada@example',
    'example.com',
    'https://exa mple.com',
    'https://example.com/café',
    'ftp:/x',
    '123e4567-e89b-12d3-a456-42661417400',
    '',
    'hello world',
  ])('%s has no format', (value) => {
    expect(detectFormats(value)).toBe(0);
  });

  it('formatFromMask only accepts a single format', () => {
    expect(formatFromMask(FORMAT_BITS.email)).toBe('email');
    expect(formatFromMask(FORMAT_BITS.email | FORMAT_BITS.uri)).toBeUndefined();
    expect(formatFromMask(0)).toBeUndefined();
  });

  it('drops the format when any value does not match', () => {
    const m = inferModel('[{"e": "a@example.com"}, {"e": "not an email"}, {"e": ""}]');
    expect(show(field(m.objects[0], 'e').type)).toBe('string');
    const m2 = inferModel('[{"d": "2024-01-01T00:00:00Z"}, {"d": "2024-01-02T00:00:00Z"}]');
    expect(show(field(m2.objects[0], 'd').type)).toBe('string:date-time');
  });
});
