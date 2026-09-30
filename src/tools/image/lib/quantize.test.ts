import { describe, expect, it } from 'vitest';
import { countColors, quantizeRgba } from './quantize';

function image(w: number, h: number, fn: (x: number, y: number) => [number, number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(fn(x, y), (y * w + x) * 4);
  return d;
}
const px = (d: Uint8ClampedArray, w: number, x: number, y: number) => Array.from(d.subarray((y * w + x) * 4, (y * w + x) * 4 + 4));

describe('quantizeRgba', () => {
  it('keeps images that already fit the palette exactly (regression: red + green became olive)', () => {
    const quad = image(20, 10, (x, y) => (y < 5 ? (x < 10 ? [255, 0, 0, 255] : [0, 255, 0, 255]) : x < 10 ? [0, 0, 255, 255] : [255, 255, 0, 255]));
    for (const k of [4, 8, 108, 256]) {
      const out = quantizeRgba(quad, k);
      expect(out).toEqual(quad);
    }
  });

  it('keeps colors of equal brightness apart when reducing', () => {
    // A hue wheel at constant r+g+b plus noise: many colors, several hues with the same sum.
    const w = 360;
    const hue = image(w, 4, (x, y) => {
      const t = x / w;
      const r = Math.round(255 * Math.max(0, 1 - Math.abs(t * 3 - 0.5) * 2));
      const g = Math.round(255 * Math.max(0, 1 - Math.abs(t * 3 - 1.5) * 2));
      const b = Math.round(255 * Math.max(0, 1 - Math.abs(t * 3 - 2.5) * 2));
      return [r, g, (b + y) & 255, 255];
    });
    const out = quantizeRgba(hue, 16);
    expect(countColors(out)).toBeLessThanOrEqual(16);
    const red = px(out, w, Math.round(w / 6), 0); // pure red region
    const green = px(out, w, Math.round(w / 2), 0); // pure green region
    expect(red[0]).toBeGreaterThan(180);
    expect(red[1]).toBeLessThan(80);
    expect(green[1]).toBeGreaterThan(180);
    expect(green[0]).toBeLessThan(80);
  });

  it('stays within the color budget with a small error on gradients', () => {
    const w = 256;
    const h = 64;
    const grad = image(w, h, (x, y) => [x, (y * 4) & 255, (x + y) & 255, 255]);
    expect(countColors(grad)).toBeGreaterThan(1000);
    for (const k of [8, 64, 255]) {
      const out = quantizeRgba(grad, k);
      expect(countColors(out)).toBeLessThanOrEqual(k);
      let err = 0;
      for (let i = 0; i < grad.length; i++) err += Math.abs(grad[i] - out[i]);
      const mean = err / grad.length;
      expect(mean).toBeLessThan(k >= 64 ? 8 : 30);
    }
  });

  it('keeps transparency', () => {
    const w = 100;
    const img = image(w, 10, (x) => (x < 30 ? [12, 34, 56, 0] : [x * 2, 255 - x, 128, x < 60 ? 128 : 255]));
    const out = quantizeRgba(img, 8);
    expect(px(out, w, 5, 5)).toEqual([0, 0, 0, 0]);
    expect(px(out, w, 45, 5)[3]).toBe(128);
    expect(px(out, w, 90, 5)[3]).toBe(255);
    expect(countColors(out)).toBeLessThanOrEqual(8);
  });
});
