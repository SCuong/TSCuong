import { describe, expect, it } from 'vitest';
import { IMAGE_KIND, pixelHash, toRgba } from './imageData';

describe('toRgba', () => {
  it('passes RGBA through', () => {
    const data = Uint8ClampedArray.from([1, 2, 3, 4]);
    expect(Array.from(toRgba({ width: 1, height: 1, kind: IMAGE_KIND.RGBA_32BPP, data })!)).toEqual([1, 2, 3, 4]);
  });

  it('expands RGB with opaque alpha', () => {
    const data = Uint8ClampedArray.from([10, 20, 30, 40, 50, 60]);
    expect(Array.from(toRgba({ width: 2, height: 1, kind: IMAGE_KIND.RGB_24BPP, data })!)).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
  });

  it('unpacks 1-bit rows with padding', () => {
    // width 3 → one byte per row. Row 0: 101xxxxx, row 1: 010xxxxx
    const data = Uint8ClampedArray.from([0b10100000, 0b01000000]);
    const rgba = toRgba({ width: 3, height: 2, kind: IMAGE_KIND.GRAYSCALE_1BPP, data })!;
    const gray = [];
    for (let i = 0; i < rgba.length; i += 4) gray.push(rgba[i]);
    expect(gray).toEqual([255, 0, 255, 0, 255, 0]);
  });

  it('rejects short buffers, empty images and unknown kinds', () => {
    expect(toRgba({ width: 2, height: 2, kind: IMAGE_KIND.RGB_24BPP, data: new Uint8ClampedArray(3) })).toBeNull();
    expect(toRgba({ width: 0, height: 2, kind: IMAGE_KIND.RGB_24BPP, data: new Uint8ClampedArray(3) })).toBeNull();
    expect(toRgba({ width: 1, height: 1, kind: 99, data: new Uint8ClampedArray(4) })).toBeNull();
    expect(toRgba({ width: 1, height: 1 })).toBeNull();
  });
});

describe('pixelHash', () => {
  it('is equal for equal images and differs otherwise', () => {
    const a = Uint8ClampedArray.from({ length: 400 }, (_, i) => i % 256);
    const b = Uint8ClampedArray.from(a);
    expect(pixelHash(10, 10, a)).toBe(pixelHash(10, 10, b));
    b[0] = 99;
    expect(pixelHash(10, 10, a)).not.toBe(pixelHash(10, 10, b));
    expect(pixelHash(20, 5, a)).not.toBe(pixelHash(10, 10, a));
  });
});
