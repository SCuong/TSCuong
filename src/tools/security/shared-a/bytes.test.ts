import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64, bytesToBase64Url, bytesToHex, decodeInput, equalBytes, hexToBytes, readInChunks, utf8 } from './bytes';

describe('bytes helpers', () => {
  it('converts hex both ways, tolerating separators and 0x', () => {
    expect(bytesToHex(new Uint8Array([0, 15, 255]))).toBe('000fff');
    expect(hexToBytes('0x00 0f:FF')).toEqual(new Uint8Array([0, 15, 255]));
    expect(hexToBytes('abc')).toBeNull();
    expect(hexToBytes('zz')).toBeNull();
    expect(hexToBytes('')).toEqual(new Uint8Array(0));
  });

  it('converts base64 and base64url', () => {
    const bytes = new Uint8Array([251, 255, 191]);
    expect(bytesToBase64(bytes)).toBe('+/+/');
    expect(bytesToBase64Url(bytes)).toBe('-_-_');
    expect(base64ToBytes('-_-_')).toEqual(bytes);
    expect(Array.from(base64ToBytes('SmVmZQ')!)).toEqual(Array.from(utf8('Jefe')));
    expect(base64ToBytes('S')).toBeNull();
    expect(base64ToBytes('a$b')).toBeNull();
  });

  it('round-trips large buffers through base64', () => {
    const big = new Uint8Array(200_000).map((_, i) => i & 0xff);
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big);
  });

  it('decodes inputs by encoding', () => {
    const d = decodeInput('é', 'text');
    expect(d.ok && Array.from(d.bytes)).toEqual([0xc3, 0xa9]);
    expect(decodeInput('zz', 'hex', 'Key')).toEqual({ ok: false, error: expect.stringMatching(/^Key is not valid hex/) });
  });

  it('compares bytes', () => {
    expect(equalBytes(utf8('ab'), utf8('ab'))).toBe(true);
    expect(equalBytes(utf8('ab'), utf8('ac'))).toBe(false);
    expect(equalBytes(utf8('ab'), utf8('abc'))).toBe(false);
  });

  it('reads blobs in chunks', async () => {
    const chunks: number[] = [];
    await readInChunks(new Blob([new Uint8Array(10)]), (c) => chunks.push(c.length), { chunkSize: 4 });
    expect(chunks).toEqual([4, 4, 2]);
  });
});
