import { describe, expect, it } from 'vitest';
import { createLineIndex, pathSegment, scanJson } from './jsonScan';

function err(text: string) {
  const r = scanJson(text);
  expect(r.ok).toBe(false);
  return r.error!;
}

describe('scanJson — valid input', () => {
  it.each([
    '{}',
    '[]',
    '0',
    '-0.5e+10',
    '"x"',
    'true',
    'null',
    ' {"a": [1, 2, {"b": "c\\n\\u00e9"}]} ',
    '"😀 漢字"',
    '\uFEFF{"a":1}',
  ])('accepts %s', (text) => {
    const r = scanJson(text);
    expect(r.error).toBeNull();
    expect(r.ok).toBe(true);
  });

  it('agrees with JSON.parse on a large document', () => {
    const big = JSON.stringify({ items: Array.from({ length: 20_000 }, (_, i) => ({ id: i, name: `n${i}`, tags: ['a', 'b'] })) });
    expect(scanJson(big).ok).toBe(true);
  });
});

describe('scanJson — errors', () => {
  it('reports empty input', () => {
    expect(err('  ').message).toBe('Input is empty');
  });
  it('finds a trailing comma in objects and arrays', () => {
    const e = err('{\n  "a": 1,\n}');
    expect(e.message).toMatch(/Trailing comma/);
    expect(e.line).toBe(2);
    expect(e.column).toBe(9);
    expect(err('[1,2,]').message).toMatch(/Trailing comma/);
  });
  it('explains unquoted and single-quoted keys', () => {
    expect(err('{a: 1}').message).toMatch(/Property name 'a' must be wrapped in double quotes/);
    expect(err("{'a': 1}").message).toMatch(/double quotes/);
    expect(err("['x']").message).toMatch(/double quotes/);
  });
  it('rejects comments', () => {
    const e = err('{\n // hi\n "a": 1}');
    expect(e.message).toMatch(/Comments/);
    expect(e.line).toBe(2);
  });
  it('rejects Python/JS literals with a hint', () => {
    expect(err('{"a": True}').message).toMatch(/'True' is not a JSON value/);
    expect(err('[NaN]').message).toMatch(/NaN/);
    expect(err('[undefined]').message).toMatch(/undefined/);
    expect(err('[nul]').message).toMatch(/Unexpected token 'nul'/);
  });
  it('checks numbers', () => {
    expect(err('01').message).toMatch(/leading zeros/);
    expect(err('1.').message).toMatch(/decimal point/);
    expect(err('1e').message).toMatch(/exponent/);
    expect(err('+1').message).toMatch(/Invalid number/);
    expect(err('-').message).toMatch(/Invalid number/);
  });
  it('checks strings', () => {
    expect(err('"abc').message).toMatch(/Unterminated string/);
    expect(err('"a\\x"').message).toMatch(/Invalid escape/);
    expect(err('"\\u12"').message).toMatch(/Unicode escape/);
    expect(err('"a\nb"').message).toMatch(/line break/);
    expect(err('"a\tb"').message).toMatch(/tab/);
  });
  it('reports missing commas and brackets', () => {
    expect(err('{"a":1 "b":2}').message).toMatch(/Missing ','/);
    expect(err('[1 2]').message).toMatch(/expected ',' or '\]'/);
    const open = err('{"a": [1, 2');
    expect(open.message).toMatch(/end of input/);
    expect(err('{"a" 1}').message).toMatch(/expected ':'/);
  });
  it('reports data after the root value', () => {
    const e = err('{} {}');
    expect(e.message).toMatch(/after the end/);
    expect(e.column).toBe(4);
  });
  it('accounts for a BOM in the column of line 1', () => {
    expect(err('\uFEFF{,}').column).toBe(3);
  });
  it('agrees with JSON.parse about validity for tricky inputs', () => {
    const cases = ['[1,]', '{"a":1,}', '"\\/"', '[1e5, -0, 0.0]', '{"":""}', '[[[[]]]]', '[\n]', '{"a":1}}', '[,1]', '[01]'];
    for (const c of cases) {
      let valid = true;
      try {
        JSON.parse(c);
      } catch {
        valid = false;
      }
      expect(scanJson(c).ok, c).toBe(valid);
    }
  });
});

describe('scanJson — duplicate keys', () => {
  it('finds duplicates JSON.parse hides, with paths and lines', () => {
    const r = scanJson('{\n  "a": 1,\n  "b": {"x": 1, "x": 2},\n  "a": 3\n}');
    expect(r.ok).toBe(true);
    expect(r.duplicates).toEqual([
      { key: 'x', path: '$.b', line: 3, column: 17, firstLine: 3 },
      { key: 'a', path: '$', line: 4, column: 3, firstLine: 2 },
    ]);
  });
  it('treats escaped and literal keys as the same key', () => {
    expect(scanJson('{"a":1,"\\u0061":2}').duplicates).toHaveLength(1);
  });
  it('builds paths through arrays and odd keys', () => {
    const r = scanJson('{"list":[{"k":1,"k":2}],"we ird":{"z":1,"z":1}}');
    expect(r.duplicates.map((d) => d.path)).toEqual(['$.list[0]', '$["we ird"]']);
  });
  it('does not report keys in sibling objects', () => {
    expect(scanJson('[{"a":1},{"a":2}]').duplicates).toHaveLength(0);
  });
});

describe('deep nesting', () => {
  it('handles nesting past the tracking limit without overflowing the stack', () => {
    const deep = '['.repeat(5000) + ']'.repeat(5000);
    const r = scanJson(deep);
    expect(r.ok).toBe(true);
    expect(r.truncated).toBe(true);
    expect(scanJson('['.repeat(5000) + ']'.repeat(4999)).ok).toBe(false);
  });
});

describe('helpers', () => {
  it('pathSegment', () => {
    expect(pathSegment('abc')).toBe('.abc');
    expect(pathSegment('a-b')).toBe('["a-b"]');
    expect(pathSegment(3)).toBe('[3]');
    expect(pathSegment('')).toBe('[""]');
  });
  it('createLineIndex', () => {
    const at = createLineIndex('a\nbc\n\nd');
    expect(at(0)).toEqual({ line: 1, column: 1 });
    expect(at(3)).toEqual({ line: 2, column: 2 });
    expect(at(5)).toEqual({ line: 3, column: 1 });
    expect(at(6)).toEqual({ line: 4, column: 1 });
  });
});
