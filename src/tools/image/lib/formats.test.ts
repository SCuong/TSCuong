import { describe, expect, it } from 'vitest';
import { readImageHeader, sniffImageFormat, svgDimensions } from './formats';

const enc = (s: string) => Array.from(s, (c) => c.charCodeAt(0));
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const le16 = (n: number) => [n & 0xff, (n >> 8) & 0xff];
const le32 = (n: number) => [...le16(n & 0xffff), ...le16(n >>> 16)];
const pngChunk = (type: string, data: number[]) => [...be32(data.length), ...enc(type), ...data, 0, 0, 0, 0];

function png(w: number, h: number, colorType: number, extra: number[] = []) {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...pngChunk('IHDR', [...be32(w), ...be32(h), 8, colorType, 0, 0, 0]),
    ...extra,
    ...pngChunk('IDAT', [1]),
    ...pngChunk('IEND', []),
  ]);
}

describe('sniffImageFormat', () => {
  it('detects common formats', () => {
    expect(sniffImageFormat(png(1, 1, 6))).toBe('png');
    expect(sniffImageFormat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(sniffImageFormat(new Uint8Array(enc('GIF89a\x01\x00\x01\x00')))).toBe('gif');
    expect(sniffImageFormat(new Uint8Array([...enc('RIFF'), 0, 0, 0, 0, ...enc('WEBPVP8 ')]))).toBe('webp');
    expect(sniffImageFormat(new Uint8Array([...enc('BM'), ...new Array(30).fill(0)]))).toBe('bmp');
    expect(sniffImageFormat(new Uint8Array([0, 0, 1, 0, 1, 0]))).toBe('ico');
    expect(sniffImageFormat(new Uint8Array([0x49, 0x49, 0x2a, 0]))).toBe('tiff');
    expect(sniffImageFormat(new Uint8Array([0xff, 0x0a, 1]))).toBe('jxl');
  });

  it('distinguishes AVIF and HEIC ftyp brands, ignores MP4', () => {
    const ftyp = (major: string, compat: string[]) => {
      const body = [...enc('ftyp'), ...enc(major), 0, 0, 0, 0, ...compat.flatMap(enc)];
      return new Uint8Array([...be32(body.length + 4), ...body]);
    };
    expect(sniffImageFormat(ftyp('avif', ['mif1', 'miaf']))).toBe('avif');
    expect(sniffImageFormat(ftyp('mif1', ['avif']))).toBe('avif');
    expect(sniffImageFormat(ftyp('heic', ['mif1', 'heic']))).toBe('heic');
    expect(sniffImageFormat(ftyp('isom', ['iso2', 'mp41']))).toBeNull();
  });

  it('detects SVG text with BOM, XML declaration and comments', () => {
    const svg = '﻿<?xml version="1.0"?>\n<!-- x -->\n<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    expect(sniffImageFormat(new TextEncoder().encode(svg))).toBe('svg');
    expect(sniffImageFormat(new TextEncoder().encode('<html><body>svg</body></html>'))).toBeNull();
  });

  it('returns null for empty, text and random data', () => {
    expect(sniffImageFormat(new Uint8Array(0))).toBeNull();
    expect(sniffImageFormat(new TextEncoder().encode('hello 😀'))).toBeNull();
    expect(sniffImageFormat(new Uint8Array([0x50, 0x4b, 3, 4]))).toBeNull();
  });
});

describe('readImageHeader', () => {
  it('reads PNG size, alpha, ICC and APNG', () => {
    const h = readImageHeader(png(640, 480, 2, [...pngChunk('iCCP', [1]), ...pngChunk('tRNS', [0, 0])]))!;
    expect(h).toMatchObject({ format: 'png', width: 640, height: 480, bitDepth: 8, hasAlpha: true, hasIcc: true, animated: false });
    const apng = readImageHeader(png(10, 10, 6, pngChunk('acTL', [...be32(3), ...be32(0)])))!;
    expect(apng.animated).toBe(true);
    expect(apng.frameCount).toBe(3);
  });

  it('reads JPEG SOF dimensions after APP segments', () => {
    const seg = (m: number, p: number[]) => [0xff, m, ((p.length + 2) >> 8) & 0xff, (p.length + 2) & 0xff, ...p];
    const bytes = new Uint8Array([
      0xff, 0xd8,
      ...seg(0xe1, [...enc('Exif\0\0'), 0, 0]),
      ...seg(0xe2, [...enc('ICC_PROFILE\0'), 1, 1]),
      ...seg(0xc2, [8, 0x04, 0x38, 0x07, 0x80, 3, 1, 0x22, 0]),
      0xff, 0xda,
    ]);
    const h = readImageHeader(bytes)!;
    expect(h).toMatchObject({ format: 'jpeg', width: 1920, height: 1080, progressive: true, hasExif: true, hasIcc: true, channels: 3 });
  });

  it('reads GIF dimensions and counts frames', () => {
    const frame = [0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 1, 0x44, 0];
    const bytes = new Uint8Array([...enc('GIF89a'), ...le16(300), ...le16(200), 0, 0, 0, ...frame, ...frame, 0x3b]);
    const h = readImageHeader(bytes)!;
    expect(h).toMatchObject({ width: 300, height: 200, animated: true, frameCount: 2 });
  });

  it('reads WebP VP8, VP8L and VP8X', () => {
    const riff = (chunk: number[]) => new Uint8Array([...enc('RIFF'), 0, 0, 0, 0, ...enc('WEBP'), ...chunk]);
    const vp8 = riff([...enc('VP8 '), 0, 0, 0, 0, 0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(400), ...le16(300)]);
    expect(readImageHeader(vp8)).toMatchObject({ width: 400, height: 300, hasAlpha: false });
    const bits = (399 & 0x3fff) | ((299 & 0x3fff) << 14) | (1 << 28);
    const vp8l = riff([...enc('VP8L'), 0, 0, 0, 0, 0x2f, ...le32(bits >>> 0)]);
    expect(readImageHeader(vp8l)).toMatchObject({ width: 400, height: 300, hasAlpha: true });
    const vp8x = riff([...enc('VP8X'), 10, 0, 0, 0, 0x12, 0, 0, 0, 99, 0, 0, 49, 0, 0]);
    expect(readImageHeader(vp8x)).toMatchObject({ width: 100, height: 50, animated: true, hasAlpha: true });
  });

  it('reads BMP and ICO', () => {
    const bmp = new Uint8Array([...enc('BM'), ...new Array(16).fill(0), ...le32(64), ...le32(-32 >>> 0), 1, 0, 32, 0, 0, 0]);
    expect(readImageHeader(bmp)).toMatchObject({ width: 64, height: 32, bitsPerPixel: 32 });
    const ico = new Uint8Array([0, 0, 1, 0, 2, 0, 16, 16, 0, 0, 1, 0, 32, 0, ...new Array(8).fill(0), 0, 0, 0, 0, 1, 0, 32, 0, ...new Array(8).fill(0)]);
    expect(readImageHeader(ico)).toMatchObject({ width: 256, height: 256, frameCount: 2 });
  });

  it('survives truncated headers', () => {
    expect(readImageHeader(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toMatchObject({ format: 'png' });
    expect(readImageHeader(new Uint8Array([0xff, 0xd8, 0xff]))).toMatchObject({ format: 'jpeg' });
  });
});

describe('svgDimensions', () => {
  it('uses width/height with units', () => {
    expect(svgDimensions('<svg width="100" height="50">')).toMatchObject({ width: 100, height: 50 });
    expect(svgDimensions('<svg width="1in" height="72pt">')).toMatchObject({ width: 96, height: 96 });
  });
  it('falls back to viewBox, and derives a missing side', () => {
    expect(svgDimensions('<svg viewBox="0 0 24 12">')).toMatchObject({ width: 24, height: 12, fromViewBox: true });
    expect(svgDimensions('<svg width="48" viewBox="0,0,24,12">')).toMatchObject({ width: 48, height: 24 });
    expect(svgDimensions('<svg width="100%" height="100%" viewBox="0 0 10 20">')).toMatchObject({ width: 10, height: 20 });
  });
  it('returns null without size information', () => {
    expect(svgDimensions('<svg>')).toBeNull();
    expect(svgDimensions('<svg viewBox="0 0 0 0">')).toBeNull();
  });
});
