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
    expect(Array.from(encodeText('﻿A', 'utf-8-bom'))).toEqual([0xef, 0xbb, 0xbf, 0x41]);
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
