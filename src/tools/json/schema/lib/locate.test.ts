import { describe, expect, it } from 'vitest';
import { locatePointers, positionFinder } from './locate';
import { escapeToken, fromLocation, lastToken, parentPointer, parsePointer, toPointer, unescapeToken, valueAt } from './pointer';

const slice = (text: string, span: { from: number; to: number } | undefined) => (span ? text.slice(span.from, span.to) : undefined);

describe('JSON Pointer helpers', () => {
  it('escapes and unescapes tokens', () => {
    expect(escapeToken('a/b~c')).toBe('a~1b~0c');
    expect(unescapeToken('a~1b~0c')).toBe('a/b~c');
    expect(unescapeToken('~01')).toBe('~1');
    expect(toPointer(['a/b', 0, ''])).toBe('/a~1b/0/');
    expect(parsePointer('/a~1b/0/')).toEqual(['a/b', '0', '']);
    expect(parsePointer('')).toEqual([]);
  });

  it('decodes validator locations', () => {
    expect(fromLocation('#')).toBe('');
    expect(fromLocation('#/users/0/e-mail')).toBe('/users/0/e-mail');
    expect(fromLocation('#/a%20b/%C3%A9t%C3%A9')).toBe('/a b/été');
    expect(fromLocation('#/a~1b')).toBe('/a~1b');
    expect(fromLocation('#/100%25')).toBe('/100%');
    expect(fromLocation('#/bad%')).toBe('/bad%');
  });

  it('reads values at pointers', () => {
    const doc = { a: [{ b: 1 }], 'x/y': true, '': 0 };
    expect(valueAt(doc, '')).toBe(doc);
    expect(valueAt(doc, '/a/0/b')).toBe(1);
    expect(valueAt(doc, '/x~1y')).toBe(true);
    expect(valueAt(doc, '/')).toBe(0);
    expect(valueAt(doc, '/a/01')).toBeUndefined();
    expect(valueAt(doc, '/a/5')).toBeUndefined();
    expect(valueAt(doc, '/missing/deeper')).toBeUndefined();
    expect(valueAt(doc, '/toString')).toBeUndefined();
  });

  it('navigates to parents and last tokens', () => {
    expect(parentPointer('/a/b')).toBe('/a');
    expect(parentPointer('/a')).toBe('');
    expect(parentPointer('')).toBeNull();
    expect(lastToken('/a/b~1c')).toBe('b/c');
  });
});

describe('locatePointers', () => {
  const text = `{
  "name": "Ada",
  "tags": ["x", {"deep": [1, 2.5e3, null]}],
  "a/b": {"~k": true},
  "emoji 🚀": "ok",
  "esc\\"aped": 1
}`;

  it('finds values and keys', () => {
    const found = locatePointers(text, ['', '/name', '/tags/1/deep/1', '/a~1b/~0k', '/emoji 🚀', '/esc"aped', '/tags/1']);
    expect(slice(text, found.get('')?.value)).toBe(text);
    expect(slice(text, found.get('/name')?.value)).toBe('"Ada"');
    expect(slice(text, found.get('/name')?.key)).toBe('"name"');
    expect(slice(text, found.get('/tags/1/deep/1')?.value)).toBe('2.5e3');
    expect(found.get('/tags/1/deep/1')?.key).toBeUndefined();
    expect(slice(text, found.get('/a~1b/~0k')?.value)).toBe('true');
    expect(slice(text, found.get('/emoji 🚀')?.value)).toBe('"ok"');
    expect(slice(text, found.get('/esc"aped')?.key)).toBe('"esc\\"aped"');
    expect(slice(text, found.get('/tags/1')?.value)).toBe('{"deep": [1, 2.5e3, null]}');
  });

  it('ignores pointers that do not exist', () => {
    const found = locatePointers(text, ['/nope', '/tags/9', '/name/x']);
    expect(found.size).toBe(0);
  });

  it('uses the last duplicate key like JSON.parse', () => {
    const dup = '{"a": 1, "a": 2}';
    expect(slice(dup, locatePointers(dup, ['/a']).get('/a')?.value)).toBe('2');
  });

  it('handles a byte order mark and empty containers', () => {
    const bom = '﻿{"a": {}, "b": []}';
    const found = locatePointers(bom, ['/a', '/b']);
    expect(slice(bom, found.get('/a')?.value)).toBe('{}');
    expect(slice(bom, found.get('/b')?.value)).toBe('[]');
  });

  it('returns partial results for malformed input without throwing', () => {
    expect(locatePointers('{"a": 1, "b": ', ['/a', '/b']).get('/a')).toBeDefined();
    expect(locatePointers('', ['']).size).toBe(0);
    expect(locatePointers('{"a" 1}', ['/a']).size).toBe(0);
  });

  it('skips huge unrelated subtrees and deep nesting quickly', () => {
    const deep = `${'['.repeat(20000)}${']'.repeat(20000)}`;
    const big = `{"skip": ${deep}, "rows": [${Array.from({ length: 20000 }, (_, k) => `{"id": ${k}}`).join(',')}], "target": 42}`;
    const started = performance.now();
    const found = locatePointers(big, ['/target', '/rows/19999/id']);
    expect(performance.now() - started).toBeLessThan(1500);
    expect(slice(big, found.get('/target')?.value)).toBe('42');
    expect(slice(big, found.get('/rows/19999/id')?.value)).toBe('19999');
  });
});

describe('positionFinder', () => {
  it('maps spans to line, column and a single-line length', () => {
    const text = '{\n  "a": {\n    "b": 1\n  }\n}';
    const found = locatePointers(text, ['/a', '/a/b']);
    const pos = positionFinder(text);
    expect(pos(found.get('/a/b')!.value)).toEqual({ line: 3, column: 10, length: 1 });
    expect(pos(found.get('/a')!.value)).toEqual({ line: 2, column: 8, length: 1 });
    expect(pos(found.get('/a')!.key!)).toEqual({ line: 2, column: 3, length: 3 });
  });

  it('handles CRLF line breaks', () => {
    const text = '{\r\n  "a": "xyz"\r\n}';
    const found = locatePointers(text, ['/a']);
    expect(positionFinder(text)(found.get('/a')!.value)).toEqual({ line: 2, column: 8, length: 5 });
  });
});
