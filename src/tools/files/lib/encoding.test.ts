import { describe, expect, it } from 'vitest';
import {
  convertLineEndings,
  countLineEndings,
  DECODE_ENCODINGS,
  decodeBytes,
  describeLineEndings,
  detectBom,
  detectEncoding,
  encodeText,
  isSupportedLabel,
  isValidUtf8,
  outputFileName,
} from './encoding';

const utf8 = (s: string) => new TextEncoder().encode(s);

describe('detectEncoding', () => {
  it('uses BOMs', () => {
    expect(detectBom(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toEqual({
      encoding: 'utf-8',
      length: 3,
    });
    expect(detectEncoding(new Uint8Array([0xff, 0xfe, 0x41, 0]))).toMatchObject({ encoding: 'utf-16le', confidence: 'certain' });
    expect(detectEncoding(new Uint8Array([0xfe, 0xff, 0, 0x41]))).toMatchObject({ encoding: 'utf-16be', confidence: 'certain' });
    expect(detectBom(new Uint8Array([0x41]))).toBeNull();
  });
  it('recognizes ASCII and UTF-8 (including emoji)', () => {
    expect(detectEncoding(utf8('hello')).encoding).toBe('utf-8');
    expect(detectEncoding(utf8('héllo 😀 日本')).reason).toMatch(/Valid UTF-8/);
    expect(detectEncoding(new Uint8Array(0))).toMatchObject({
      encoding: 'utf-8',
      confidence: 'guess',
    });
  });
  it('falls back to Windows-1252 for invalid UTF-8', () => {
    const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]); // "café" in Windows-1252
    expect(detectEncoding(latin1)).toMatchObject({
      encoding: 'windows-1252',
      confidence: 'guess',
    });
    expect(decodeBytes(latin1, 'windows-1252').text).toBe('café');
  });
  it('tolerates a truncated multi-byte sequence only when told the sample is truncated', () => {
    const cut = utf8('ok 😀').subarray(0, 5);
    expect(isValidUtf8(cut)).toBe(false);
    expect(isValidUtf8(cut, true)).toBe(true);
    expect(detectEncoding(cut, true).encoding).toBe('utf-8');
  });
  it('spots BOM-less UTF-16 by its NUL pattern', () => {
    expect(detectEncoding(encodeText('Hello, world', 'utf-16le')).encoding).toBe('utf-16le');
    const be = encodeText('Hello, world', 'utf-16be-bom').subarray(2);
    expect(detectEncoding(be).encoding).toBe('utf-16be');
  });
});

describe('decodeBytes', () => {
  it('decodes legacy Asian encodings via TextDecoder labels', () => {
    expect(decodeBytes(new Uint8Array([0x93, 0xfa, 0x96, 0x7b]), 'shift_jis').text).toBe('日本');
    expect(decodeBytes(new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]), 'gbk').text).toBe('你好');
    expect(decodeBytes(new Uint8Array([0xcf, 0xf0, 0xe8]), 'windows-1251').text).toBe('При');
  });
  it('strips the BOM and counts replacement characters', () => {
    expect(decodeBytes(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]), 'utf-8').text).toBe('A');
    expect(decodeBytes(new Uint8Array([0x41, 0xff, 0x42, 0xfe]), 'utf-8')).toEqual({ text: 'A�B�', replacements: 2 });
  });
  it('supports every offered label', () => {
    for (const e of DECODE_ENCODINGS) expect(isSupportedLabel(e.label), e.label).toBe(true);
    expect(isSupportedLabel('not-an-encoding')).toBe(false);
  });
});

describe('encodeText', () => {
  it('encodes UTF-8 with and without BOM, never doubling it', () => {
    expect(Array.from(encodeText('é', 'utf-8'))).toEqual([0xc3, 0xa9]);
    expect(Array.from(encodeText('A', 'utf-8-bom'))).toEqual([0xef, 0xbb, 0xbf, 0x41]);
    expect(Array.from(encodeText('\uFEFFA', 'utf-8-bom'))).toEqual([0xef, 0xbb, 0xbf, 0x41]);
  });
  it('encodes UTF-16 including surrogate pairs and round-trips', () => {
    expect(Array.from(encodeText('A', 'utf-16le-bom'))).toEqual([0xff, 0xfe, 0x41, 0]);
    expect(Array.from(encodeText('A', 'utf-16be-bom'))).toEqual([0xfe, 0xff, 0, 0x41]);
    const s = 'héllo 😀 日本\r\n';
    expect(decodeBytes(encodeText(s, 'utf-16le'), 'utf-16le').text).toBe(s);
    expect(decodeBytes(encodeText(s, 'utf-16be-bom'), 'utf-16be').text).toBe(s);
    expect(decodeBytes(encodeText(s, 'utf-8-bom'), 'utf-8').text).toBe(s);
    expect(encodeText('', 'utf-16le').length).toBe(0);
  });
});

describe('line endings', () => {
  it('counts and describes', () => {
    expect(countLineEndings('a\r\nb\nc\rd\r\n')).toEqual({
      crlf: 2,
      lf: 1,
      cr: 1,
    });
    expect(describeLineEndings({ crlf: 3, lf: 0, cr: 0 })).toBe('CRLF (Windows)');
    expect(describeLineEndings({ crlf: 1, lf: 2, cr: 0 })).toMatch(/^Mixed/);
    expect(describeLineEndings({ crlf: 0, lf: 0, cr: 0 })).toBe('No line breaks');
  });
  it('converts', () => {
    expect(convertLineEndings('a\r\nb\nc\rd', 'lf')).toBe('a\nb\nc\nd');
    expect(convertLineEndings('a\r\nb\nc\rd', 'crlf')).toBe('a\r\nb\r\nc\r\nd');
    expect(convertLineEndings('a\nb', 'cr')).toBe('a\rb');
    expect(convertLineEndings('a\nb\r\n', 'keep')).toBe('a\nb\r\n');
    const big = 'line\n'.repeat(100000);
    expect(convertLineEndings(big, 'crlf').length).toBe(big.length + 100000);
  });
  it('names output files', () => {
    expect(outputFileName('notes.txt', 'utf-8')).toBe('notes.utf8.txt');
    expect(outputFileName('data.csv', 'utf-16le-bom')).toBe('data.utf16.csv');
    expect(outputFileName('README', 'utf-8-bom')).toBe('README.utf8.txt');
  });
});

describe('legacy encoding guesses', () => {
  const bytes = (...b: number[]) => Uint8Array.from(b);

  it('recognises ISO-2022-JP instead of calling it plain ASCII', () => {
    // Regression: 7-bit Japanese text was reported as "Plain ASCII" with high confidence and shown as escape codes.
    const text = bytes(0x1b, 0x24, 0x42, 0x46, 0x7c, 0x4b, 0x5c, 0x38, 0x6c, 0x1b, 0x28, 0x42, 0x0a);
    const d = detectEncoding(text);
    expect(d).toMatchObject({ encoding: 'iso-2022-jp', confidence: 'high' });
    expect(decodeBytes(text, d.encoding).text).toBe('日本語\n');
  });

  it.each([
    ['shift_jis', [0x82, 0xb1, 0x82, 0xf1, 0x82, 0xc9, 0x82, 0xbf, 0x82, 0xcd, 0x90, 0xa2, 0x8a, 0x45], 'こんにちは世界'],
    ['euc-kr', [0xbe, 0xc8, 0xb3, 0xe7, 0xc7, 0xcf, 0xbc, 0xbc, 0xbf, 0xe4, 0x20, 0xbc, 0xbc, 0xb0, 0xe8], '안녕하세요 세계'],
    ['gbk', [0xc4, 0xe3, 0xba, 0xc3, 0xca, 0xc0, 0xbd, 0xe7, 0xa3, 0xac, 0xbb, 0xb6, 0xd3, 0xad], '你好世界，欢迎'],
    ['windows-1251', [0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2, 0x20, 0xec, 0xe8, 0xf0, 0x2c, 0x20, 0xea, 0xe0, 0xea, 0x20, 0xe4, 0xe5, 0xeb, 0xe0], 'Привет мир, как дела'],
    ['koi8-r', [0xd0, 0xd2, 0xc9, 0xd7, 0xc5, 0xd4, 0x20, 0xcd, 0xc9, 0xd2, 0x2c, 0x20, 0xcb, 0xc1, 0xcb, 0x20, 0xc4, 0xc5, 0xcc, 0xc1], 'привет мир, как дела'],
  ])('guesses %s (still marked as a guess)', (label, raw, text) => {
    // Regression: every legacy file was guessed as Windows-1252, turning these into mojibake.
    const d = detectEncoding(Uint8Array.from(raw));
    expect(d).toMatchObject({ encoding: label, confidence: 'guess' });
    expect(decodeBytes(Uint8Array.from(raw), d.encoding).text).toBe(text);
  });

  it('keeps Western European text as Windows-1252', () => {
    const western = bytes(
      0x43, 0x61, 0x66, 0xe9, 0x20, 0xc4, 0x72, 0x67, 0x65, 0x72, 0x20, 0xfc, 0x62, 0x65, 0x72, 0x20, 0x47, 0x72, 0xf6, 0xdf, 0x65, 0x2c,
      0x20, 0x6e, 0x61, 0xef, 0x76, 0x65, 0x20, 0x66, 0x61, 0xe7, 0x61, 0x64, 0x65,
    );
    expect(detectEncoding(western).encoding).toBe('windows-1252');
    expect(detectEncoding(bytes(0x43, 0x61, 0x66, 0xe9, 0x20, 0x80, 0x0d, 0x0a)).encoding).toBe('windows-1252');
  });
});
