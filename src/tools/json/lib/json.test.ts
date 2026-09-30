import { describe, expect, it } from 'vitest';
import {
  formatJson,
  formatJsonError,
  jsonStats,
  minifyJson,
  parseJson,
  positionAt,
  sortKeysDeep,
  stringifyJson,
  stripBom,
} from './json';

describe('positionAt', () => {
  it('returns 1-based line and column', () => {
    expect(positionAt('abc', 0)).toEqual({ line: 1, column: 1 });
    expect(positionAt('ab\ncd', 3)).toEqual({ line: 2, column: 1 });
    expect(positionAt('ab\ncd', 4)).toEqual({ line: 2, column: 2 });
  });
});

describe('parseJson', () => {
  it('parses valid JSON', () => {
    expect(parseJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });
  it('reports empty input', () => {
    const r = parseJson('   ');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.message).toBe('Input is empty');
  });
  it('reports a line and column for invalid JSON', () => {
    const r = parseJson('{\n  "a": 1,\n  "b": x\n}');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.line).toBe(3);
      expect(r.error.column).toBeGreaterThan(0);
      expect(formatJsonError(r.error)).toMatch(/line 3/);
    }
  });
  it('accepts a UTF-8 BOM', () => {
    expect(parseJson('\uFEFF{"a":"é"}')).toEqual({ ok: true, value: { a: 'é' } });
    expect(stripBom('\uFEFFx')).toBe('x');
    expect(stripBom('x')).toBe('x');
  });
  it('keeps Unicode and emoji', () => {
    const r = parseJson('{"emoji":"😀","cjk":"漢字"}');
    expect(r.ok && r.value).toEqual({ emoji: '😀', cjk: '漢字' });
  });
});

describe('format / minify', () => {
  it('formats with indentation options', () => {
    expect(formatJson('{"a":[1,2]}', '2')).toEqual({ ok: true, value: '{\n  "a": [\n    1,\n    2\n  ]\n}' });
    const tab = formatJson('{"a":1}', 'tab');
    expect(tab.ok && tab.value).toBe('{\n\t"a": 1\n}');
  });
  it('sorts keys deeply without reordering arrays', () => {
    expect(sortKeysDeep({ b: 1, a: { d: 1, c: [3, 1] } })).toEqual({ a: { c: [3, 1], d: 1 }, b: 1 });
    expect(stringifyJson({ b: 1, a: 2 }, '2', true)).toBe('{\n  "a": 2,\n  "b": 1\n}');
  });
  it('minifies', () => {
    expect(minifyJson('{ "a" : [ 1 , 2 ] }')).toEqual({ ok: true, value: '{"a":[1,2]}' });
    expect(minifyJson('{').ok).toBe(false);
  });
  it('handles large arrays', () => {
    const big = JSON.stringify(Array.from({ length: 50_000 }, (_, i) => ({ i })));
    const r = minifyJson(big);
    expect(r.ok && r.value.length).toBe(big.length);
  });
});

describe('jsonStats', () => {
  it('counts node types and depth', () => {
    const s = jsonStats({ a: [1, 'x', null, true], b: { c: {} } });
    expect(s).toMatchObject({ objects: 3, arrays: 1, keys: 3, numbers: 1, strings: 1, nulls: 1, booleans: 1, maxDepth: 3 });
  });
  it('handles scalars', () => {
    expect(jsonStats(5)).toMatchObject({ numbers: 1, maxDepth: 0 });
  });
});
