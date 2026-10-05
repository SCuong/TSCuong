import { describe, expect, it } from 'vitest';
import { boundedZoom, fitScale, pageAt, pageLayout } from './geometry';
describe('reader geometry', () => {
  const sizes = [
    { width: 595, height: 842 },
    { width: 842, height: 595 },
    { width: 300, height: 1000 },
  ];
  it('lays out mixed portrait/landscape pages without overlaps', () => {
    const result = pageLayout(sizes, 2);
    expect(result.offsets.map((p) => p.top)).toEqual([12, 1708, 2910]);
    expect(result.height).toBe(4922);
    expect(pageAt(result.offsets, 2500)).toBe(1);
    expect(pageAt(result.offsets, 0)).toBe(0);
    expect(pageAt(result.offsets, 1e9)).toBe(2);
  });
  it('fits to the viewport including margins and respects page height', () => {
    expect(fitScale(sizes[0], 406, 800, 'width')).toBeCloseTo(390 / 595);
    expect(fitScale(sizes[0], 900, 500, 'page')).toBeCloseTo(476 / 842);
  });
  it('bounds touch zoom', () => {
    expect(boundedZoom(0.01)).toBe(0.35);
    expect(boundedZoom(100)).toBe(5);
  });
});
