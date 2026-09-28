import { describe, expect, it } from 'vitest';
import { colorDistance, flatten, guessBackground, keyColor, strength } from './chroma';
import { formatColor, readableTextOn, rgbToHsl } from './color';

function img(w: number, h: number, fn: (x: number, y: number) => [number, number, number, number]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(fn(x, y), (y * w + x) * 4);
  return d;
}

describe('chroma key', () => {
  it('distance and strength', () => {
    expect(colorDistance(0, 0, 0, 255, 255, 255)).toBeCloseTo(100);
    expect(colorDistance(10, 10, 10, 10, 10, 10)).toBe(0);
    expect(strength(5, 10, 0)).toBe(1);
    expect(strength(15, 10, 10)).toBeCloseTo(0.5);
    expect(strength(25, 10, 10)).toBe(0);
  });

  it('makes a color transparent everywhere (non-contiguous)', () => {
    const d = img(4, 1, (x) => (x % 2 ? [255, 255, 255, 255] : [255, 0, 0, 255]));
    const n = keyColor(d, 4, 1, { target: [255, 255, 255], tolerance: 5, feather: 0, mode: 'transparent' });
    expect(n).toBe(2);
    expect([d[3], d[7], d[11], d[15]]).toEqual([255, 0, 255, 0]);
  });

  it('feathers near colors', () => {
    const d = img(1, 1, () => [230, 230, 230, 255]);
    const dist = colorDistance(230, 230, 230, 255, 255, 255);
    keyColor(d, 1, 1, { target: [255, 255, 255], tolerance: 0, feather: dist * 2, mode: 'transparent' });
    expect(d[3]).toBeGreaterThan(100);
    expect(d[3]).toBeLessThan(155);
  });

  it('contiguous mode only affects the connected region', () => {
    // white | red wall | white
    const d = img(5, 1, (x) => (x === 2 ? [255, 0, 0, 255] : [255, 255, 255, 255]));
    keyColor(d, 5, 1, { target: [255, 255, 255], tolerance: 5, feather: 0, mode: 'transparent', contiguous: true, seed: { x: 0, y: 0 } });
    expect([d[3], d[7], d[11], d[15], d[19]]).toEqual([0, 0, 255, 255, 255]);
  });

  it('contiguous with a seed outside the image does nothing', () => {
    const d = img(2, 2, () => [255, 255, 255, 255]);
    expect(keyColor(d, 2, 2, { target: [255, 255, 255], tolerance: 5, feather: 0, mode: 'transparent', contiguous: true, seed: { x: 9, y: 9 } })).toBe(0);
  });

  it('replaces colors and keeps alpha', () => {
    const d = img(1, 1, () => [0, 255, 0, 200]);
    keyColor(d, 1, 1, { target: [0, 255, 0], tolerance: 10, feather: 0, mode: 'replace', replacement: [0, 0, 255] });
    expect(Array.from(d)).toEqual([0, 0, 255, 200]);
  });

  it('flattens onto a background', () => {
    const d = new Uint8ClampedArray([255, 0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 128]);
    flatten(d, [255, 255, 255]);
    expect(Array.from(d)).toEqual([255, 255, 255, 255, 255, 0, 0, 255, 127, 127, 127, 255]);
  });

  it('guesses the border color', () => {
    const d = img(10, 10, (x, y) => (x > 2 && x < 7 && y > 2 && y < 7 ? [255, 0, 0, 255] : [16, 200, 96, 255]));
    const [r, g, b] = guessBackground(d, 10, 10);
    expect(Math.abs(r - 16)).toBeLessThan(8);
    expect(Math.abs(g - 200)).toBeLessThan(8);
    expect(Math.abs(b - 96)).toBeLessThan(8);
  });

  it('handles a large flood fill without stack overflow', () => {
    const w = 1500;
    const d = img(w, w, () => [255, 255, 255, 255]);
    const n = keyColor(d, w, w, { target: [255, 255, 255], tolerance: 1, feather: 0, mode: 'transparent', contiguous: true, seed: { x: 0, y: 0 } });
    expect(n).toBe(w * w);
  });
});

describe('color helpers', () => {
  it('rgbToHsl', () => {
    expect(rgbToHsl(255, 0, 0)).toEqual([0, 100, 50]);
    expect(rgbToHsl(0, 0, 255)).toEqual([240, 100, 50]);
    expect(rgbToHsl(128, 128, 128)).toEqual([0, 0, 50]);
  });
  it('formatColor with and without alpha', () => {
    expect(formatColor(255, 136, 0)).toEqual({ hex: '#ff8800', rgb: 'rgb(255, 136, 0)', hsl: 'hsl(32, 100%, 50%)' });
    expect(formatColor(0, 0, 0, 128).hex).toBe('#00000080');
  });
  it('readableTextOn', () => {
    expect(readableTextOn(255, 255, 255)).toBe('#000000');
    expect(readableTextOn(0, 0, 80)).toBe('#ffffff');
  });
});
