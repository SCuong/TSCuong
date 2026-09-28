import { describe, expect, it } from 'vitest';
import { encodeBmp, encodeIco, hexToRgb, parseIco } from './encoders';

const fakePng = (n: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(n).fill(7)]);

describe('encodeIco', () => {
  it('writes a valid directory with PNG entries', () => {
    const entries = [16, 32, 48, 256].map((s, i) => ({ width: s, height: s, png: fakePng(10 + i) }));
    const ico = encodeIco(entries);
    expect(Array.from(ico.slice(0, 6))).toEqual([0, 0, 1, 0, 4, 0]);
    const parsed = parseIco(ico);
    expect(parsed.map((e) => e.width)).toEqual([16, 32, 48, 256]);
    expect(ico[6 + 3 * 16]).toBe(0); // 256 stored as 0
    let expectedOffset = 6 + 16 * 4;
    parsed.forEach((e, i) => {
      expect(e.offset).toBe(expectedOffset);
      expect(e.size).toBe(entries[i].png.length);
      expect(e.bitCount).toBe(32);
      expect(e.isPng).toBe(true);
      expect(Array.from(ico.slice(e.offset, e.offset + e.size))).toEqual(Array.from(entries[i].png));
      expectedOffset += e.size;
    });
    expect(ico.length).toBe(expectedOffset);
  });

  it('rejects empty and oversized entries', () => {
    expect(() => encodeIco([])).toThrow();
    expect(() => encodeIco([{ width: 512, height: 512, png: fakePng(1) }])).toThrow(/256/);
    expect(() => encodeIco([{ width: 0, height: 16, png: fakePng(1) }])).toThrow();
  });

  it('parseIco rejects non-icons', () => {
    expect(() => parseIco(new Uint8Array([1, 2, 3, 4, 5, 6]))).toThrow();
  });
});

describe('encodeBmp', () => {
  it('writes a bottom-up 24-bit BMP with padded rows and composited alpha', () => {
    // 3×2: row 0 = red, green, transparent; row 1 = blue, white, half-black
    const px = new Uint8Array([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 0,
      0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 0, 128,
    ]);
    const bmp = encodeBmp(px, 3, 2, [255, 255, 255]);
    const v = new DataView(bmp.buffer);
    expect(String.fromCharCode(bmp[0], bmp[1])).toBe('BM');
    expect(v.getUint32(2, true)).toBe(bmp.length);
    expect(v.getInt32(18, true)).toBe(3);
    expect(v.getInt32(22, true)).toBe(2);
    expect(v.getUint16(28, true)).toBe(24);
    const rowSize = 12; // 9 bytes padded to 12
    expect(bmp.length).toBe(54 + rowSize * 2);
    // First stored row is the bottom row (blue, white, half black over white)
    expect(Array.from(bmp.slice(54, 63))).toEqual([255, 0, 0, 255, 255, 255, 127, 127, 127]);
    // Second stored row: red, green, transparent → white
    expect(Array.from(bmp.slice(66, 75))).toEqual([0, 0, 255, 0, 255, 0, 255, 255, 255]);
  });

  it('validates input', () => {
    expect(() => encodeBmp(new Uint8Array(4), 0, 1)).toThrow();
    expect(() => encodeBmp(new Uint8Array(4), 2, 2)).toThrow();
  });
});

describe('hexToRgb', () => {
  it('parses short and long forms', () => {
    expect(hexToRgb('#fff')).toEqual([255, 255, 255]);
    expect(hexToRgb('102030')).toEqual([16, 32, 48]);
    expect(hexToRgb('#10203040')).toEqual([16, 32, 48]);
    expect(hexToRgb('nope')).toBeNull();
  });
});
