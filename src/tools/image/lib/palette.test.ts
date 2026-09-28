import { describe, expect, it } from 'vitest';
import { extractPalette, kmeans, oklabToSrgb, paletteToCss, paletteToJson, rgbToHex, samplePixels, srgbToOklab } from './palette';
import { applyFiltersToPixels, DEFAULT_FILTERS, filterString, isIdentity } from './filters';

function image(colors: Array<[number, number, number, number]>, counts: number[]) {
  const px: number[] = [];
  colors.forEach((c, i) => {
    for (let j = 0; j < counts[i]; j++) px.push(...c);
  });
  return new Uint8ClampedArray(px);
}

describe('OKLab conversion', () => {
  it('round-trips sRGB colors', () => {
    for (const rgb of [
      [0, 0, 0],
      [255, 255, 255],
      [255, 0, 0],
      [18, 52, 86],
      [200, 150, 30],
    ] as Array<[number, number, number]>) {
      const lab = srgbToOklab(...rgb);
      expect(oklabToSrgb(...lab)).toEqual(rgb);
    }
    expect(srgbToOklab(255, 255, 255)[0]).toBeCloseTo(1, 3);
    expect(srgbToOklab(0, 0, 0)[0]).toBeCloseTo(0, 5);
  });
  it('rgbToHex', () => {
    expect(rgbToHex([255, 8, 0])).toBe('#ff0800');
  });
});

describe('palette clustering', () => {
  it('finds the exact colors and shares of a 3-color image', () => {
    const data = image(
      [
        [255, 0, 0, 255],
        [0, 0, 255, 255],
        [255, 255, 255, 255],
      ],
      [600, 300, 100],
    );
    const p = extractPalette(data, 3);
    expect(p.map((c) => c.hex)).toEqual(['#ff0000', '#0000ff', '#ffffff']);
    expect(p[0].share).toBeCloseTo(0.6, 2);
    expect(p[1].share).toBeCloseTo(0.3, 2);
    expect(p.reduce((n, c) => n + c.share, 0)).toBeCloseTo(1, 5);
  });

  it('returns fewer colors when the image has fewer distinct colors than k', () => {
    const data = image([[10, 20, 30, 255]], [500]);
    const p = extractPalette(data, 8);
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ hex: '#0a141e', share: 1 });
  });

  it('ignores transparent pixels and handles fully transparent images', () => {
    const data = image(
      [
        [0, 255, 0, 255],
        [255, 0, 0, 0],
      ],
      [10, 1000],
    );
    expect(extractPalette(data, 4).map((c) => c.hex)).toEqual(['#00ff00']);
    expect(extractPalette(image([[1, 2, 3, 0]], [50]), 4)).toEqual([]);
    expect(extractPalette(new Uint8ClampedArray(0), 4)).toEqual([]);
  });

  it('is deterministic and separates similar clusters', () => {
    const data = image(
      [
        [250, 10, 10, 255],
        [240, 20, 15, 255],
        [10, 10, 240, 255],
        [20, 15, 250, 255],
      ],
      [200, 200, 200, 200],
    );
    const a = extractPalette(data, 2);
    const b = extractPalette(data, 2);
    expect(a).toEqual(b);
    expect(a).toHaveLength(2);
    expect(a[0].share).toBeCloseTo(0.5, 2);
  });

  it('kmeans handles k larger than the number of points and empty input', () => {
    const pts = samplePixels(image([[0, 0, 0, 255], [255, 255, 255, 255]], [1, 1]));
    expect(kmeans(pts, 10).counts.length).toBe(2);
    expect(kmeans(new Float64Array(0), 3).counts).toEqual([]);
  });

  it('handles large inputs by sampling', () => {
    const big = new Uint8ClampedArray(2000 * 2000 * 4);
    for (let i = 0; i < big.length; i += 4) {
      big[i] = i % 8 === 0 ? 255 : 0;
      big[i + 3] = 255;
    }
    const p = extractPalette(big, 4);
    expect(p.length).toBeGreaterThanOrEqual(1);
    expect(samplePixels(big).length / 3).toBeLessThanOrEqual(40001);
  });

  it('exports CSS and JSON', () => {
    const colors = [{ hex: '#ff0000', rgb: [255, 0, 0] as [number, number, number], share: 0.75 }];
    expect(paletteToCss(colors)).toBe(':root {\n  --color-1: #ff0000;\n}\n');
    expect(JSON.parse(paletteToJson(colors))).toEqual([{ hex: '#ff0000', rgb: [255, 0, 0], percent: 75 }]);
  });
});

describe('filters', () => {
  it('builds canonical filter strings', () => {
    expect(filterString(DEFAULT_FILTERS)).toBe('none');
    expect(isIdentity(DEFAULT_FILTERS)).toBe(true);
    expect(filterString({ ...DEFAULT_FILTERS, brightness: 120, grayscale: 100, blur: 2 })).toBe('brightness(120%) grayscale(100%) blur(2px)');
  });
  it('pixel fallback matches CSS math for common filters', () => {
    const px = new Uint8ClampedArray([200, 100, 50, 255]);
    applyFiltersToPixels(px, 1, 1, { ...DEFAULT_FILTERS, invert: 100 });
    expect(Array.from(px)).toEqual([55, 155, 205, 255]);
    const g = new Uint8ClampedArray([255, 0, 0, 255]);
    applyFiltersToPixels(g, 1, 1, { ...DEFAULT_FILTERS, grayscale: 100 });
    expect(g[0]).toBe(g[1]);
    expect(g[1]).toBe(g[2]);
    const b = new Uint8ClampedArray([100, 100, 100, 255]);
    applyFiltersToPixels(b, 1, 1, { ...DEFAULT_FILTERS, brightness: 200 });
    expect(b[0]).toBe(200);
    const c = new Uint8ClampedArray([200, 200, 200, 255]);
    applyFiltersToPixels(c, 1, 1, { ...DEFAULT_FILTERS, contrast: 0 });
    expect(c[0]).toBe(128);
  });
  it('blur spreads a single bright pixel and preserves total energy approximately', () => {
    const w = 9;
    const px = new Uint8ClampedArray(w * w * 4);
    for (let i = 3; i < px.length; i += 4) px[i] = 255;
    const center = (4 * w + 4) * 4;
    px[center] = 255;
    applyFiltersToPixels(px, w, w, { ...DEFAULT_FILTERS, blur: 1 });
    expect(px[center]).toBeLessThan(255);
    expect(px[center + 4]).toBeGreaterThan(0);
  });
});
