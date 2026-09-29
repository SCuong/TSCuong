import { describe, expect, it } from 'vitest';
import { prettyJson, tokenizeJson } from './jsonTokens';

describe('tokenizeJson', () => {
  it('classifies keys, strings, numbers and literals', () => {
    const tokens = tokenizeJson(prettyJson({ a: 'x', b: 1.5e3, c: true, d: null, e: [-2] }));
    const kinds = tokens.filter((t) => t.kind !== 'punct').map((t) => `${t.kind}:${t.text}`);
    expect(kinds).toEqual([
      'key:"a"',
      'string:"x"',
      'key:"b"',
      'number:1500',
      'key:"c"',
      'literal:true',
      'key:"d"',
      'literal:null',
      'key:"e"',
      'number:-2',
    ]);
  });

  it('keeps every character and handles escapes and Unicode', () => {
    const json = prettyJson({ 'q"k': 'a\\"b', emoji: '😀 true 12', nested: { x: [1, { y: false }] } });
    const tokens = tokenizeJson(json);
    expect(tokens.map((t) => t.text).join('')).toBe(json);
    expect(tokens.find((t) => t.kind === 'string' && t.text.includes('😀'))?.text).toBe('"😀 true 12"');
    expect(tokens.find((t) => t.kind === 'key')?.text).toBe('"q\\"k"');
  });

  it('handles empty input and primitives', () => {
    expect(tokenizeJson('')).toEqual([]);
    expect(tokenizeJson('"hi"')).toEqual([{ kind: 'string', text: '"hi"' }]);
  });
});

describe('prettyJson', () => {
  it('pretty prints and survives unserialisable values', () => {
    expect(prettyJson({ a: 1 })).toBe('{\n  "a": 1\n}');
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(prettyJson(cyclic)).toBe('[object Object]');
    expect(prettyJson(undefined)).toBe('undefined');
  });
});
