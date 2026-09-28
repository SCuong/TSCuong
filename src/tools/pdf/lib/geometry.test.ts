import { describe, expect, it } from 'vitest';
import {
  anchorCenter,
  insetBox,
  mmToPt,
  normalizeRotation,
  originForCenteredRotation,
  paperName,
  ptToMm,
  rotatedBounds,
  visualMarginsToUser,
  visualSize,
  visualToUser,
} from './geometry';
import { hexToRgb01 } from './color';

const box = { x: 10, y: 20, width: 300, height: 400 };

describe('rotation helpers', () => {
  it('normalizes angles', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(-360)).toBe(0);
  });

  it('computes the displayed size', () => {
    expect(visualSize(box, 0)).toEqual({ width: 300, height: 400 });
    expect(visualSize(box, 90)).toEqual({ width: 400, height: 300 });
    expect(visualSize(box, 270)).toEqual({ width: 400, height: 300 });
  });

  it('maps visual corners to the right user-space corners', () => {
    // Visual bottom-left of the displayed page.
    expect(visualToUser(0, 0, box, 0)).toEqual({ x: 10, y: 20 });
    expect(visualToUser(0, 0, box, 90)).toEqual({ x: 310, y: 20 }); // user bottom-right
    expect(visualToUser(0, 0, box, 180)).toEqual({ x: 310, y: 420 }); // user top-right
    expect(visualToUser(0, 0, box, 270)).toEqual({ x: 10, y: 420 }); // user top-left
  });

  it('maps margins consistently with visualToUser', () => {
    const m = { top: 1, right: 2, bottom: 3, left: 4 };
    for (const r of [0, 90, 180, 270]) {
      const vs = visualSize(box, r);
      const inner = insetBox(box, visualMarginsToUser(m, r))!;
      // The four corners of the visually inset rectangle must be the four corners of the user-space inset box.
      const corners = [
        visualToUser(m.left, m.bottom, box, r),
        visualToUser(vs.width - m.right, m.bottom, box, r),
        visualToUser(m.left, vs.height - m.top, box, r),
        visualToUser(vs.width - m.right, vs.height - m.top, box, r),
      ].map((p) => `${Math.round(p.x)},${Math.round(p.y)}`);
      const expected = [
        [inner.x, inner.y],
        [inner.x + inner.width, inner.y],
        [inner.x, inner.y + inner.height],
        [inner.x + inner.width, inner.y + inner.height],
      ].map(([x, y]) => `${Math.round(x)},${Math.round(y)}`);
      expect(corners.sort()).toEqual(expected.sort());
    }
  });

  it('insetBox returns null when nothing remains', () => {
    expect(insetBox(box, { top: 200, bottom: 200, left: 0, right: 0 })).toBeNull();
    expect(insetBox(box, { top: 0, bottom: 0, left: 0, right: 0 })).toEqual(box);
  });
});

describe('placement', () => {
  it('anchors elements in all positions', () => {
    expect(anchorCenter('center', 10, 10, 100, 200, 5)).toEqual({ cx: 50, cy: 100 });
    expect(anchorCenter('top-left', 10, 10, 100, 200, 5)).toEqual({ cx: 10, cy: 190 });
    expect(anchorCenter('bottom-right', 10, 10, 100, 200, 5)).toEqual({ cx: 90, cy: 10 });
    expect(anchorCenter('middle-left', 10, 10, 100, 200, 5)).toEqual({ cx: 10, cy: 100 });
    expect(anchorCenter('bottom-center', 10, 10, 100, 200, 5)).toEqual({ cx: 50, cy: 10 });
  });

  it('keeps a rotated element centered', () => {
    const o = originForCenteredRotation(50, 50, 20, 10, 90);
    // Rotating by 90° CCW around the origin, the center (10, 5) offset becomes (-5, 10).
    expect(o.x).toBeCloseTo(55, 6);
    expect(o.y).toBeCloseTo(40, 6);
    expect(originForCenteredRotation(50, 50, 20, 10, 0)).toEqual({ x: 40, y: 45 });
  });

  it('computes rotated bounds', () => {
    const b = rotatedBounds(10, 20, 90);
    expect(b.width).toBeCloseTo(20, 6);
    expect(b.height).toBeCloseTo(10, 6);
  });
});

describe('units and paper sizes', () => {
  it('converts mm and points', () => {
    expect(ptToMm(72)).toBeCloseTo(25.4, 6);
    expect(mmToPt(25.4)).toBeCloseTo(72, 6);
  });
  it('names common paper sizes in both orientations', () => {
    expect(paperName(595, 842)).toBe('A4');
    expect(paperName(792, 612)).toBe('Letter');
    expect(paperName(500, 500)).toBeNull();
  });
});

describe('hexToRgb01', () => {
  it('parses long and short hex colors', () => {
    expect(hexToRgb01('#ff0000')).toEqual([1, 0, 0]);
    expect(hexToRgb01('0f0')).toEqual([0, 1, 0]);
    expect(hexToRgb01('#336699').map((v) => Math.round(v * 255))).toEqual([51, 102, 153]);
  });
  it('falls back to black', () => {
    expect(hexToRgb01('nope')).toEqual([0, 0, 0]);
    expect(hexToRgb01('')).toEqual([0, 0, 0]);
  });
});

describe('tileCenters', () => {
  it('covers the page with staggered rows', async () => {
    const { tileCenters } = await import('./geometry');
    const centers = tileCenters(600, 800, 200, 30, 45);
    expect(centers.length).toBeGreaterThan(8);
    expect(centers.some((c) => c.cx < 150 && c.cy < 150)).toBe(true);
    expect(centers.some((c) => c.cx > 450 && c.cy > 650)).toBe(true);
    expect(tileCenters(600, 800, 0, 30, 0)).toEqual([]);
    expect(tileCenters(600, 800, 1, 1, 0, 50)).toHaveLength(50);
  });
});
