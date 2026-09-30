import { describe, expect, it } from 'vitest';
import { parse } from 'culori';
import { simulate, type VisionType } from './cvd';
import { MAX_IMAGE_SIDE, fitSize, simulatePixels } from './cvdImage';

const TYPES: VisionType[] = ['protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia', 'normal'];

function pixelsOf(hexes: string[], alpha = 255): Uint8ClampedArray {
  const data = new Uint8ClampedArray(hexes.length * 4);
  hexes.forEach((hex, i) => {
    const n = parseInt(hex.slice(1), 16);
    data.set([(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha], i * 4);
  });
  return data;
}

describe('simulatePixels', () => {
  const hexes = ['#ff0000', '#00ff00', '#0000ff', '#ffffff', '#000000', '#808080', '#1f77b4', '#ff7f0e', '#2ca02c', '#f0e442', '#010203', '#fefdfc'];

  it.each(TYPES)('matches the per-color model for %s (within one 8-bit level)', (type) => {
    const src = pixelsOf(hexes);
    const out = new Uint8ClampedArray(src.length);
    simulatePixels(src, type, out);
    hexes.forEach((hex, i) => {
      const expected = simulate(parse(hex)!, type);
      const n = parseInt(expected.slice(1), 16);
      const want = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      for (let k = 0; k < 3; k++) expect(Math.abs(out[i * 4 + k] - want[k])).toBeLessThanOrEqual(1);
    });
  });

  it('keeps alpha and gives the same result when processed in chunks', () => {
    const src = pixelsOf(hexes, 77);
    const whole = new Uint8ClampedArray(src.length);
    simulatePixels(src, 'deuteranopia', whole);
    const chunked = new Uint8ClampedArray(src.length);
    for (let from = 0; from < src.length; from += 8) simulatePixels(src, 'deuteranopia', chunked, from, Math.min(src.length, from + 8));
    expect(chunked).toEqual(whole);
    for (let i = 3; i < whole.length; i += 4) expect(whole[i]).toBe(77);
  });

  it('keeps grays gray', () => {
    const src = pixelsOf(['#000000', '#404040', '#808080', '#c0c0c0', '#ffffff']);
    for (const type of TYPES) {
      const out = new Uint8ClampedArray(src.length);
      simulatePixels(src, type, out);
      for (let i = 0; i < out.length; i += 4) {
        expect(Math.abs(out[i] - src[i])).toBeLessThanOrEqual(1);
        expect(Math.abs(out[i + 1] - src[i + 1])).toBeLessThanOrEqual(1);
        expect(Math.abs(out[i + 2] - src[i + 2])).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('fitSize', () => {
  it('scales large images down, keeping the aspect ratio', () => {
    expect(fitSize(1200, 800)).toEqual({ width: 1200, height: 800, scaled: false });
    expect(fitSize(4800, 2400)).toEqual({ width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE / 2, scaled: true });
    expect(fitSize(100, 10000, 1000)).toEqual({ width: 10, height: 1000, scaled: true });
    expect(fitSize(1, 100000, 1000)).toEqual({ width: 1, height: 1000, scaled: true });
  });
});
