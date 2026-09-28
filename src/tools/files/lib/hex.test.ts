import { describe, expect, it } from 'vitest';
import {
  byteToChar,
  findAll,
  inspectBytes,
  parseHexPattern,
  parseOffset,
  searchFile,
  textPattern,
  toHex,
  utf8At,
  type Pattern,
} from './hex';

const reader = (buf: Uint8Array) => async (s: number, e: number) => buf.slice(s, e);
const pat = (x: Pattern | { error: string }) => {
  if ('error' in x) throw new Error(x.error);
  return x;
};

describe('parseOffset', () => {
  it('accepts decimal and hex forms', () => {
    expect(parseOffset('1234', 5000)).toEqual({ ok: true, value: 1234 });
    expect(parseOffset('0x4D2', 5000)).toEqual({ ok: true, value: 1234 });
    expect(parseOffset('4d2h', 5000)).toEqual({ ok: true, value: 1234 });
    expect(parseOffset('$10', 5000)).toEqual({ ok: true, value: 16 });
    expect(parseOffset('1_000', 5000)).toEqual({ ok: true, value: 1000 });
  });
  it('rejects bad input with reasons', () => {
    expect(parseOffset('', 10)).toMatchObject({ ok: false });
    expect(parseOffset('ff', 1000)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/0x/),
    });
    expect(parseOffset('xyz', 10)).toMatchObject({ ok: false });
    expect(parseOffset('100', 100)).toMatchObject({
      ok: false,
      error: expect.stringMatching(/only 100 bytes/),
    });
  });
});

describe('patterns', () => {
  it('parses hex with separators and wildcards', () => {
    const p = pat(parseHexPattern('DE ad-BE:ef'));
    expect(Array.from(p.bytes)).toEqual([0xde, 0xad, 0xbe, 0xef]);
    const w = pat(parseHexPattern('4d ?? 5a'));
    expect(Array.from(w.mask)).toEqual([1, 0, 1]);
    expect(Array.from(pat(parseHexPattern('0x4D5A')).bytes)).toEqual([0x4d, 0x5a]);
  });
  it('rejects invalid hex', () => {
    expect(parseHexPattern('')).toHaveProperty('error');
    expect(parseHexPattern('zz')).toHaveProperty('error');
    expect(parseHexPattern('ABC')).toHaveProperty('error');
    expect(parseHexPattern('?? ??')).toHaveProperty('error');
  });
  it('text patterns encode UTF-8', () => {
    expect(Array.from(pat(textPattern('é', false)).bytes)).toEqual([0xc3, 0xa9]);
    expect(textPattern('', false)).toHaveProperty('error');
  });
  it('findAll handles wildcards and case-insensitivity', () => {
    const buf = new TextEncoder().encode('Hello hello HELLO');
    expect(findAll(buf, pat(textPattern('hello', true)))).toEqual([0, 6, 12]);
    expect(findAll(buf, pat(textPattern('hello', false)))).toEqual([6]);
    expect(findAll(new Uint8Array([1, 2, 3, 1, 9, 3]), pat(parseHexPattern('01 ?? 03')))).toEqual([0, 3]);
  });
});

describe('searchFile', () => {
  const size = 10_000;
  const buf = new Uint8Array(size);
  const needle = [0xca, 0xfe, 0xba, 0xbe];
  // Place matches so one spans a chunk boundary (chunk = 1000).
  for (const pos of [5, 998, 4000, 9996]) buf.set(needle, pos);
  const p = pat(parseHexPattern('CA FE BA BE'));

  it('finds forward matches including across chunk boundaries', async () => {
    const r = reader(buf);
    expect(await searchFile(r, size, p, 0, 'forward', { chunkSize: 1000 })).toBe(5);
    expect(await searchFile(r, size, p, 6, 'forward', { chunkSize: 1000 })).toBe(998);
    expect(await searchFile(r, size, p, 999, 'forward', { chunkSize: 1000 })).toBe(4000);
    expect(await searchFile(r, size, p, 4001, 'forward', { chunkSize: 1000 })).toBe(9996);
    expect(await searchFile(r, size, p, 9997, 'forward', { chunkSize: 1000 })).toBe(-1);
  });

  it('finds backward matches including across chunk boundaries', async () => {
    const r = reader(buf);
    expect(await searchFile(r, size, p, size - 1, 'backward', { chunkSize: 1000 })).toBe(9996);
    expect(await searchFile(r, size, p, 9995, 'backward', { chunkSize: 1000 })).toBe(4000);
    expect(await searchFile(r, size, p, 3999, 'backward', { chunkSize: 1000 })).toBe(998);
    expect(await searchFile(r, size, p, 997, 'backward', { chunkSize: 1000 })).toBe(5);
    expect(await searchFile(r, size, p, 4, 'backward', { chunkSize: 1000 })).toBe(-1);
  });

  it('reports progress and supports cancel', async () => {
    const ctrl = new AbortController();
    const progress: number[] = [];
    expect(
      await searchFile(reader(buf), size, pat(parseHexPattern('FF FF')), 0, 'forward', {
        chunkSize: 1000,
        onProgress: (f) => progress.push(f),
      }),
    ).toBe(-1);
    expect(progress.at(-1)).toBe(1);
    ctrl.abort();
    await expect(searchFile(reader(buf), size, p, 0, 'forward', { signal: ctrl.signal })).rejects.toThrow();
  });

  it('handles patterns longer than the file', async () => {
    expect(await searchFile(reader(new Uint8Array(2)), 2, p, 0, 'forward')).toBe(-1);
  });
});

describe('inspectBytes', () => {
  it('decodes integers and floats in both byte orders', () => {
    const bytes = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
    const rows = Object.fromEntries(inspectBytes(bytes).map((r) => [r.label, r]));
    expect(rows.uint16).toEqual({ label: 'uint16', le: '513', be: '258' });
    expect(rows.uint32.le).toBe(String(0x04030201));
    expect(rows.uint32.be).toBe(String(0x01020304));
    expect(rows.uint64.le).toBe(0x0807060504030201n.toString());
    expect(rows.int8.le).toBe('1');
  });
  it('handles signedness, floats and short buffers', () => {
    const neg = Object.fromEntries(inspectBytes(new Uint8Array([0xff, 0xff, 0xff, 0xff])).map((r) => [r.label, r]));
    expect(neg.int8.le).toBe('-1');
    expect(neg.int32.le).toBe('-1');
    expect(neg.uint32.le).toBe('4294967295');
    expect(neg.float32.le).toBe('NaN');
    expect(neg.int64.le).toBe('—');
    const f = new Uint8Array(4);
    new DataView(f.buffer).setFloat32(0, 1.5, true);
    expect(Object.fromEntries(inspectBytes(f).map((r) => [r.label, r])).float32.le).toBe('1.5');
    expect(inspectBytes(new Uint8Array(0))).toHaveLength(8);
  });
  it('utf8At decodes multi-byte characters', () => {
    expect(utf8At(new TextEncoder().encode('😀x'))).toEqual({
      char: '😀',
      length: 4,
    });
    expect(utf8At(new Uint8Array([0x41]))).toEqual({ char: 'A', length: 1 });
    expect(utf8At(new Uint8Array([0xc3]))).toBeNull();
    expect(utf8At(new Uint8Array([0xff]))).toBeNull();
  });
  it('formatting helpers', () => {
    expect(toHex(255, 4)).toBe('00FF');
    expect(byteToChar(0x41)).toBe('A');
    expect(byteToChar(0)).toBe('·');
  });
});
