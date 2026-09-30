import { describe, expect, it } from 'vitest';
import {
  aspectRatioLabel,
  centeredAspectRect,
  clampRect,
  computeResize,
  containDestRect,
  coverSourceRect,
  fitMaxDimension,
  rotatedBounds,
  rotateFlipCss,
  rotateFlipTransform,
  transformPoint,
} from './geometry';
import { moveCrop, resizeCrop, roundCrop } from './crop';
import { uniqueNames } from './zip';
import { paletteSizeForQuality, keepFormat } from './canvas';

const src = { width: 4000, height: 3000 };

describe('computeResize', () => {
  it('handles every mode', () => {
    expect(computeResize(src, { mode: 'percent', percent: 25 })).toEqual({ width: 1000, height: 750 });
    expect(computeResize(src, { mode: 'width', width: 800 })).toEqual({ width: 800, height: 600 });
    expect(computeResize(src, { mode: 'height', height: 300 })).toEqual({ width: 400, height: 300 });
    expect(computeResize(src, { mode: 'fit', width: 1000, height: 1000 })).toEqual({ width: 1000, height: 750 });
    expect(computeResize(src, { mode: 'fit', height: 600 })).toEqual({ width: 800, height: 600 });
    expect(computeResize(src, { mode: 'exact', width: 100, height: 100 })).toEqual({ width: 100, height: 100 });
    expect(computeResize(src, { mode: 'exact', width: 400, keepAspect: true })).toEqual({ width: 400, height: 300 });
  });
  it('never returns zero and respects noUpscale', () => {
    expect(computeResize({ width: 1000, height: 1 }, { mode: 'percent', percent: 10 })).toEqual({ width: 100, height: 1 });
    expect(computeResize({ width: 100, height: 50 }, { mode: 'fit', width: 1000, height: 1000, noUpscale: true })).toEqual({ width: 100, height: 50 });
    expect(computeResize({ width: 100, height: 50 }, { mode: 'fit', width: 1000, height: 1000 })).toEqual({ width: 1000, height: 500 });
  });
  it('throws clear errors for missing values', () => {
    expect(() => computeResize(src, { mode: 'percent' })).toThrow(/percentage/);
    expect(() => computeResize(src, { mode: 'fit' })).toThrow(/maximum/);
    expect(() => computeResize(src, { mode: 'exact', width: 10 })).toThrow(/both/);
    expect(() => computeResize(src, { mode: 'width', width: -5 })).toThrow();
  });
});

describe('geometry helpers', () => {
  it('fitMaxDimension', () => {
    expect(fitMaxDimension(src, 2000)).toEqual({ width: 2000, height: 1500 });
    expect(fitMaxDimension(src, 5000)).toEqual(src);
    expect(fitMaxDimension(src, null)).toEqual(src);
  });
  it('rotatedBounds', () => {
    expect(rotatedBounds({ width: 400, height: 200 }, 90)).toEqual({ width: 200, height: 400 });
    expect(rotatedBounds({ width: 400, height: 200 }, -90)).toEqual({ width: 200, height: 400 });
    expect(rotatedBounds({ width: 400, height: 200 }, 180)).toEqual({ width: 400, height: 200 });
    const b = rotatedBounds({ width: 100, height: 100 }, 45);
    expect(b.width).toBe(141);
  });
  it('rotateFlipTransform: rotates clockwise, then mirrors on screen', () => {
    // 200×100 image; where does each source corner land (as a pixel box corner)?
    const size = { width: 200, height: 100 };
    const at = (deg: number, h: boolean, v: boolean, x: number, y: number) => {
      const t = rotateFlipTransform(size, deg, h, v);
      const p = transformPoint(t.matrix, x, y);
      return [Math.round(p.x), Math.round(p.y), t.width, t.height];
    };
    // Right 90°: top-left goes to the top-right corner, bottom-left to the top-left.
    expect(at(90, false, false, 0, 0)).toEqual([100, 0, 100, 200]);
    expect(at(90, false, false, 0, 100)).toEqual([0, 0, 100, 200]);
    // Right 90° + horizontal flip mirrors the rotated result left↔right (regression:
    // the flip used to be applied before rotating, which flipped it vertically on screen).
    expect(at(90, true, false, 0, 0)).toEqual([0, 0, 100, 200]);
    expect(at(90, true, false, 0, 100)).toEqual([100, 0, 100, 200]);
    // Vertical flip after 90° swaps top and bottom of the rotated image.
    expect(at(90, false, true, 0, 0)).toEqual([100, 200, 100, 200]);
    // Flip without rotation.
    expect(at(0, true, false, 0, 0)).toEqual([200, 0, 200, 100]);
    expect(at(0, false, true, 0, 0)).toEqual([0, 100, 200, 100]);
    expect(at(180, false, false, 0, 0)).toEqual([200, 100, 200, 100]);
    expect(at(-90, false, false, 0, 0)).toEqual([0, 200, 100, 200]);
    // Right angles are exact (no 1e-16 drift that would blur pixels).
    for (const v of rotateFlipTransform(size, 270, true, true).matrix) expect(Number.isInteger(v)).toBe(true);
    // Arbitrary angles keep the image centered in the expanded canvas.
    const t = rotateFlipTransform({ width: 100, height: 100 }, 45);
    const center = transformPoint(t.matrix, 50, 50);
    expect(center.x).toBeCloseTo(t.width / 2, 6);
    expect(center.y).toBeCloseTo(t.height / 2, 6);
  });
  it('rotateFlipCss applies the rotation before the on-screen mirror', () => {
    expect(rotateFlipCss(90, true, false)).toBe('scale(-1, 1) rotate(90deg)');
    expect(rotateFlipCss(0, false, false)).toBe('scale(1, 1) rotate(0deg)');
  });
  it('clampRect and centeredAspectRect', () => {
    expect(clampRect({ x: -10, y: 50, width: 500, height: 500 }, { width: 200, height: 300 })).toEqual({ x: 0, y: 0, width: 200, height: 300 });
    expect(centeredAspectRect({ width: 400, height: 200 }, 1)).toEqual({ x: 100, y: 0, width: 200, height: 200 });
    expect(centeredAspectRect({ width: 400, height: 400 }, 16 / 9)).toEqual({ x: 0, y: 88, width: 400, height: 225 });
  });
  it('cover and contain rects', () => {
    const cover = coverSourceRect({ width: 2000, height: 1000 }, { width: 100, height: 100 }, { x: 0, y: 0.5 });
    expect(cover).toEqual({ x: 0, y: 0, width: 1000, height: 1000 });
    const right = coverSourceRect({ width: 2000, height: 1000 }, { width: 100, height: 100 }, { x: 1, y: 0.5 });
    expect(right.x).toBe(1000);
    expect(containDestRect({ width: 200, height: 100 }, { width: 100, height: 100 })).toEqual({ x: 0, y: 25, width: 100, height: 50 });
  });
  it('aspectRatioLabel', () => {
    expect(aspectRatioLabel(1920, 1080)).toBe('16:9');
    expect(aspectRatioLabel(1000, 1000)).toBe('1:1');
    expect(aspectRatioLabel(1366, 768)).toBe('≈ 16:9');
    expect(aspectRatioLabel(0, 10)).toBe('—');
  });
});

describe('crop interaction', () => {
  const bounds = { width: 1000, height: 800 };
  it('moves within bounds', () => {
    expect(moveCrop({ x: 10, y: 10, width: 100, height: 100 }, -50, 2000, bounds)).toEqual({ x: 0, y: 700, width: 100, height: 100 });
  });
  it('resizes freely with anchored opposite side', () => {
    const r = resizeCrop({ x: 100, y: 100, width: 200, height: 200 }, 'nw', -50, -30, bounds, null);
    expect(r).toEqual({ x: 50, y: 70, width: 250, height: 230 });
    const clamped = resizeCrop({ x: 100, y: 100, width: 200, height: 200 }, 'e', 5000, 0, bounds, null);
    expect(clamped.width).toBe(900);
  });
  it('keeps aspect ratio on corners and edges', () => {
    const r = resizeCrop({ x: 100, y: 100, width: 200, height: 100 }, 'se', 100, 0, bounds, 2);
    expect(r.width / r.height).toBeCloseTo(2);
    expect(r.x).toBe(100);
    const e = resizeCrop({ x: 100, y: 100, width: 200, height: 100 }, 'e', 200, 0, bounds, 2);
    expect(e).toMatchObject({ x: 100, width: 400, height: 200 });
    const huge = resizeCrop({ x: 0, y: 0, width: 200, height: 100 }, 'se', 5000, 5000, bounds, 2);
    expect(huge.width).toBeLessThanOrEqual(1000);
    expect(huge.height).toBeLessThanOrEqual(800);
    expect(huge.width / huge.height).toBeCloseTo(2);
    const n = resizeCrop({ x: 400, y: 400, width: 100, height: 100 }, 'n', 0, -5000, bounds, 1);
    expect(n.y).toBeGreaterThanOrEqual(0);
    expect(n.x).toBeGreaterThanOrEqual(0);
    expect(n.x + n.width).toBeLessThanOrEqual(1000);
  });
  it('enforces the minimum size', () => {
    const r = resizeCrop({ x: 100, y: 100, width: 200, height: 200 }, 'w', 500, 0, bounds, null, 10);
    expect(r.width).toBe(10);
  });
  it('roundCrop', () => {
    expect(roundCrop({ x: 999.6, y: -2, width: 10.4, height: 20.5 }, bounds)).toEqual({ x: 990, y: 0, width: 10, height: 21 });
  });
});

describe('misc', () => {
  it('uniqueNames de-duplicates case-insensitively and sanitizes slashes', () => {
    expect(uniqueNames(['a.png', 'A.png', 'a.png', 'b/c.jpg', '', 'x'])).toEqual(['a.png', 'A (2).png', 'a (3).png', 'b_c.jpg', 'file', 'x']);
  });
  it('paletteSizeForQuality spans 8–256', () => {
    expect(paletteSizeForQuality(0)).toBe(8);
    expect(paletteSizeForQuality(1)).toBe(256);
    expect(paletteSizeForQuality(0.5)).toBeGreaterThan(8);
    expect(paletteSizeForQuality(2)).toBe(256);
  });
  it('keepFormat maps sources to encodable outputs', () => {
    expect(keepFormat('jpeg')).toBe('jpeg');
    expect(keepFormat('gif')).toBe('png');
    expect(keepFormat('svg')).toBe('png');
    expect(keepFormat(undefined)).toBe('png');
  });
});
