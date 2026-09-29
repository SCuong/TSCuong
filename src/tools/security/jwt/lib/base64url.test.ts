import { describe, expect, it } from 'vitest';
import { analyzeBase64Url, decodeUtf8Strict, encodeBase64Url, encodeBase64UrlText } from './base64url';

const text = (bytes: Uint8Array | null) => (bytes ? new TextDecoder().decode(bytes) : null);

describe('analyzeBase64Url', () => {
  it('decodes canonical Base64URL of every length', () => {
    expect(text(analyzeBase64Url('').bytes)).toBe('');
    expect(text(analyzeBase64Url('Zg').bytes)).toBe('f');
    expect(text(analyzeBase64Url('Zm8').bytes)).toBe('fo');
    expect(text(analyzeBase64Url('Zm9v').bytes)).toBe('foo');
    expect(text(analyzeBase64Url('Zm9vYg').bytes)).toBe('foob');
    const a = analyzeBase64Url('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(text(a.bytes)).toBe('{"alg":"HS256","typ":"JWT"}');
    expect(a).toMatchObject({ padded: false, standardAlphabet: false, badLength: false, nonCanonical: false });
  });

  it('decodes URL-safe characters to the right bytes', () => {
    expect(Array.from(analyzeBase64Url('-_8').bytes!)).toEqual([0xfb, 0xff]);
    expect(Array.from(analyzeBase64Url('+/8').bytes!)).toEqual([0xfb, 0xff]);
  });

  it('flags padding and the standard alphabet but still decodes', () => {
    const padded = analyzeBase64Url('Zg==');
    expect(padded.padded).toBe(true);
    expect(text(padded.bytes)).toBe('f');
    const std = analyzeBase64Url('+/8');
    expect(std.standardAlphabet).toBe(true);
  });

  it('reports the first invalid character with its index', () => {
    const a = analyzeBase64Url('abc%def');
    expect(a.bytes).toBeNull();
    expect(a.invalid).toEqual({ char: '%', index: 3 });
    expect(analyzeBase64Url('ab=c').invalid).toEqual({ char: '=', index: 2 });
    expect(analyzeBase64Url('ab😀').invalid).toEqual({ char: '😀', index: 2 });
    expect(analyzeBase64Url('ab.c').invalid?.char).toBe('.');
  });

  it('detects impossible lengths and non-canonical trailing bits', () => {
    expect(analyzeBase64Url('abcde').badLength).toBe(true);
    expect(analyzeBase64Url('abcde').bytes).toBeNull();
    expect(analyzeBase64Url('Zh').nonCanonical).toBe(true);
    expect(analyzeBase64Url('Zg').nonCanonical).toBe(false);
    expect(analyzeBase64Url('Zm9').nonCanonical).toBe(true);
  });

  it('round-trips random bytes and long input', () => {
    for (let n = 0; n < 70; n++) {
      const bytes = crypto.getRandomValues(new Uint8Array(n));
      const encoded = encodeBase64Url(bytes);
      expect(encoded).toMatch(/^[A-Za-z0-9_-]*$/);
      expect(Array.from(analyzeBase64Url(encoded).bytes!)).toEqual(Array.from(bytes));
    }
    const big = new Uint8Array(200_000).map((_, i) => i & 0xff);
    expect(analyzeBase64Url(encodeBase64Url(big)).bytes!.length).toBe(200_000);
  });

  it('encodes Unicode text as UTF-8', () => {
    const encoded = encodeBase64UrlText('héllo 🔐');
    expect(decodeUtf8Strict(analyzeBase64Url(encoded).bytes!)).toBe('héllo 🔐');
  });
});

describe('decodeUtf8Strict', () => {
  it('rejects invalid UTF-8', () => {
    expect(decodeUtf8Strict(Uint8Array.of(0xff, 0xfe))).toBeNull();
    expect(decodeUtf8Strict(Uint8Array.of(0x68, 0x69))).toBe('hi');
  });
});
