import { describe, expect, it } from 'vitest';
import { buildAlphabet, bytesToBase64, bytesToBase64Url, bytesToHex, encodeBytes, generateStrings } from './randomString';

describe('buildAlphabet', () => {
  it('builds presets', () => {
    const hex = buildAlphabet('hex', '', false);
    expect(hex.ok && hex.alphabet.join('')).toBe('0123456789abcdef');
    const b58 = buildAlphabet('base58', '', false);
    expect(b58.ok && b58.alphabet.length).toBe(58);
    const an = buildAlphabet('alphanumeric', '', false);
    expect(an.ok && an.alphabet.length).toBe(62);
    const sym = buildAlphabet('symbols', '', false);
    expect(sym.ok && sym.alphabet.length).toBe(32);
  });

  it('removes look-alikes', () => {
    const r = buildAlphabet('alphanumeric', '', true);
    expect(r.ok).toBe(true);
    if (r.ok) for (const c of ['0', 'O', '1', 'l', 'I']) expect(r.alphabet).not.toContain(c);
  });

  it('dedupes custom sets and validates them', () => {
    const r = buildAlphabet('custom', 'aabbc😀😀', false);
    expect(r.ok && r.alphabet).toEqual(['a', 'b', 'c', '😀']);
    expect(buildAlphabet('custom', '', false).ok).toBe(false);
    const one = buildAlphabet('custom', 'zzz', false);
    expect(!one.ok && one.error).toMatch(/at least 2/);
    const la = buildAlphabet('custom', '0O1', true);
    expect(!la.ok && la.error).toMatch(/look-alikes/);
  });
});

describe('generateStrings', () => {
  it('respects length, count and alphabet', () => {
    const r = buildAlphabet('hex', '', false);
    if (!r.ok) throw new Error();
    const out = generateStrings(r.alphabet, 32, 100);
    expect(out).toHaveLength(100);
    for (const s of out) expect(s).toMatch(/^[0-9a-f]{32}$/);
    expect(new Set(out).size).toBe(100);
  });

  it('is roughly uniform over digits', () => {
    const r = buildAlphabet('digits', '', false);
    if (!r.ok) throw new Error();
    const counts = new Array(10).fill(0);
    for (const s of generateStrings(r.alphabet, 1000, 20)) for (const ch of s) counts[Number(ch)]++;
    for (const c of counts) expect(Math.abs(c - 2000)).toBeLessThan(300);
  });
});

describe('byte encodings', () => {
  const bytes = Uint8Array.from([0, 1, 127, 128, 250, 251, 255]);
  it('hex', () => expect(bytesToHex(bytes)).toBe('00017f80fafbff'));
  it('base64 and base64url', () => {
    expect(bytesToBase64(bytes)).toBe('AAF/gPr7/w==');
    expect(bytesToBase64Url(bytes)).toBe('AAF_gPr7_w');
  });
  it('byte array', () => expect(encodeBytes(bytes, 'array')).toBe('[0, 1, 127, 128, 250, 251, 255]'));
  it('large buffers', () => {
    const big = new Uint8Array(100_000).fill(65);
    expect(bytesToBase64(big)).toHaveLength(Math.ceil(100_000 / 3) * 4);
  });
  it('empty', () => {
    expect(encodeBytes(new Uint8Array(0), 'hex')).toBe('');
    expect(encodeBytes(new Uint8Array(0), 'base64')).toBe('');
  });
});
