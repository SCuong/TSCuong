import { describe, expect, it } from 'vitest';
import {
  encodeComponent,
  extractQuery,
  flatten,
  jsonToQuery,
  normalizeQuery,
  pairsToObject,
  parsePairs,
  splitKey,
  type StringifyOptions,
  type ToObjectOptions,
} from './queryString';

const nested: ToObjectOptions = { nested: true, duplicates: 'array' };
const obj = (q: string, o: ToObjectOptions = nested) => pairsToObject(parsePairs(q), o);
const opts = (o: Partial<StringifyOptions> = {}): StringifyOptions => ({
  encoding: 'rfc3986',
  arrayFormat: 'brackets',
  sortKeys: false,
  readableBrackets: true,
  ...o,
});

describe('extractQuery / parsePairs', () => {
  it('accepts URLs, ?query and bare queries', () => {
    expect(extractQuery('https://x.test/p?a=1&b=2#h')).toBe('a=1&b=2');
    expect(extractQuery('?a=1')).toBe('a=1');
    expect(extractQuery('a=1')).toBe('a=1');
    expect(extractQuery('https://x.test/p')).toBe('');
    expect(extractQuery('')).toBe('');
  });

  it('decodes pairs with form or strict semantics', () => {
    expect(parsePairs('a=1+2&b=%2B&c')).toEqual([
      { key: 'a', value: '1 2', hasEquals: true },
      { key: 'b', value: '+', hasEquals: true },
      { key: 'c', value: '', hasEquals: false },
    ]);
    expect(parsePairs('a=1+2', false)[0].value).toBe('1+2');
  });

  it('accepts one pair per line and skips blanks', () => {
    expect(parsePairs('a=1\n\n b=2 \n&&').map((p) => p.key)).toEqual(['a', 'b']);
  });

  it('handles Unicode, emoji and malformed escapes', () => {
    expect(parsePairs('name=%E2%9C%93&e=😀&bad=%E0%A4')).toEqual([
      { key: 'name', value: '✓', hasEquals: true },
      { key: 'e', value: '😀', hasEquals: true },
      { key: 'bad', value: '%E0%A4', hasEquals: true },
    ]);
  });
});

describe('splitKey', () => {
  it('splits bracket notation', () => {
    expect(splitKey('a')).toEqual(['a']);
    expect(splitKey('a[b][c]')).toEqual(['a', 'b', 'c']);
    expect(splitKey('a[]')).toEqual(['a', '']);
    expect(splitKey('a[b')).toEqual(['a[b']);
    expect(splitKey('a[b]x')).toEqual(['a', 'bx']);
    expect(splitKey('[a]')).toEqual(['[a]']);
  });
});

describe('pairsToObject', () => {
  it('builds nested objects and arrays', () => {
    expect(obj('a=1&b[]=2&b[]=3&c[d]=4&c[e][f]=5').value).toEqual({
      a: '1',
      b: ['2', '3'],
      c: { d: '4', e: { f: '5' } },
    });
  });

  it('supports indexed arrays and compacts holes', () => {
    expect(obj('x[1]=b&x[0]=a&x[5]=c').value).toEqual({ x: ['a', 'b', 'c'] });
    expect(obj('list[0][name]=A&list[1][name]=B').value).toEqual({ list: [{ name: 'A' }, { name: 'B' }] });
  });

  it('turns huge indices into object keys', () => {
    expect(obj('x[5000]=a').value).toEqual({ x: { 5000: 'a' } });
  });

  it('handles duplicate keys per mode', () => {
    expect(obj('a=1&a=2&a=3').value).toEqual({ a: ['1', '2', '3'] });
    expect(obj('a=1&a=2', { nested: true, duplicates: 'first' }).value).toEqual({ a: '1' });
    expect(obj('a=1&a=2', { nested: true, duplicates: 'last' }).value).toEqual({ a: '2' });
    expect(obj('c[d]=1&c[d]=2').value).toEqual({ c: { d: ['1', '2'] } });
  });

  it('keeps brackets literal when nesting is off', () => {
    expect(obj('a[b]=1&a[b]=2', { nested: false, duplicates: 'array' }).value).toEqual({ 'a[b]': ['1', '2'] });
  });

  it('warns about conflicting keys', () => {
    const r = obj('a=1&a[b]=2');
    expect(r.value).toEqual({ a: { b: '2' } });
    expect(r.warnings).toHaveLength(1);
    const r2 = obj('a[b]=2&a=1');
    expect(r2.value).toEqual({ a: { b: '2' } });
    expect(r2.warnings).toHaveLength(1);
  });

  it('merges array then object notation into an object', () => {
    expect(obj('a[]=1&a[x]=2').value).toEqual({ a: { 0: '1', x: '2' } });
  });

  it('is safe against prototype keys', () => {
    const r = obj('__proto__[polluted]=yes&constructor[prototype][x]=1');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.keys(r.value)).toEqual(['__proto__', 'constructor']);
    expect(JSON.stringify(r.value)).toBe('{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"x":"1"}}}');
  });

  it('handles large input', () => {
    const q = Array.from({ length: 10000 }, (_, i) => `items[]=${i}`).join('&');
    const v = obj(q).value as { items: string[] };
    expect(v.items).toHaveLength(10000);
    expect(v.items[9999]).toBe('9999');
  });
});

describe('encodeComponent', () => {
  it('follows RFC 3986 and form rules', () => {
    expect(encodeComponent("a b!'()*~", 'rfc3986')).toBe('a%20b%21%27%28%29%2A~');
    expect(encodeComponent("a b!'()*~", 'form')).toBe('a+b%21%27%28%29*%7E');
    expect(encodeComponent('é😀', 'rfc3986')).toBe('%C3%A9%F0%9F%98%80');
    expect(encodeComponent('&=?#+', 'form')).toBe('%26%3D%3F%23%2B');
  });

  it('form encoding matches URLSearchParams', () => {
    const s = "hello world & ~*!'() ümlaut/?";
    expect(`k=${encodeComponent(s, 'form')}`).toBe(new URLSearchParams({ k: s }).toString());
  });
});

describe('flatten / jsonToQuery', () => {
  it('flattens nested structures', () => {
    expect(flatten({ a: 1, b: [2, 3], c: { d: true, e: null } }, { arrayFormat: 'brackets', sortKeys: false })).toEqual([
      ['a', '1'],
      ['b[]', '2'],
      ['b[]', '3'],
      ['c[d]', 'true'],
      ['c[e]', ''],
    ]);
  });

  it('supports array formats', () => {
    const j = '{"t":["x","y"]}';
    expect(jsonToQuery(j, opts())).toMatchObject({ value: 't[]=x&t[]=y' });
    expect(jsonToQuery(j, opts({ arrayFormat: 'indices' }))).toMatchObject({ value: 't[0]=x&t[1]=y' });
    expect(jsonToQuery(j, opts({ arrayFormat: 'repeat' }))).toMatchObject({ value: 't=x&t=y' });
    expect(jsonToQuery(j, opts({ arrayFormat: 'comma' }))).toMatchObject({ value: 't=x%2Cy' });
    expect(jsonToQuery(j, opts({ readableBrackets: false }))).toMatchObject({ value: 't%5B%5D=x&t%5B%5D=y' });
    expect(jsonToQuery('{"o":[{"a":1},{"a":2}]}', opts())).toMatchObject({ value: 'o[0][a]=1&o[1][a]=2' });
  });

  it('sorts keys recursively', () => {
    expect(jsonToQuery('{"b":1,"a":{"z":1,"y":2}}', opts({ sortKeys: true }))).toMatchObject({ value: 'a[y]=2&a[z]=1&b=1' });
  });

  it('round-trips through the parser', () => {
    const data = { q: 'café & crème', tags: ['a b', 'c'], filter: { min: '1', max: '9' } };
    const r = jsonToQuery(JSON.stringify(data), opts({ encoding: 'form' }));
    expect(r?.ok).toBe(true);
    if (r?.ok) expect(pairsToObject(parsePairs(r.value), nested).value).toEqual(data);
  });

  it('accepts [key, value] pair lists', () => {
    expect(jsonToQuery('[["a","1"],["a","2"],["b",3]]', opts())).toMatchObject({ value: 'a=1&a=2&b=3', count: 3 });
  });

  it('reports errors and empty input', () => {
    expect(jsonToQuery('', opts())).toBeNull();
    expect(jsonToQuery('{bad', opts())).toMatchObject({ ok: false });
    expect(jsonToQuery('[1,2]', opts())).toMatchObject({ ok: false });
    expect(jsonToQuery('"x"', opts())).toMatchObject({ ok: false });
    expect(jsonToQuery('{}', opts())).toMatchObject({ ok: true, value: '', count: 0 });
  });
});

describe('normalizeQuery', () => {
  it('re-encodes and sorts stably', () => {
    const pairs = parsePairs('b=2&a=x y&flag&a=1');
    expect(normalizeQuery(pairs, opts())).toBe('b=2&a=x%20y&flag&a=1');
    expect(normalizeQuery(pairs, opts({ sortKeys: true, encoding: 'form' }))).toBe('a=x+y&a=1&b=2&flag');
  });
});
