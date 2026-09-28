import { describe, expect, it } from 'vitest';
import { GRADIENT_PRESETS, colorAt, gradientCss, gradientDeclaration, hexToRgb, normalizeAngle, stopColor, type Gradient } from './gradient';

const g = (over: Partial<Gradient>): Gradient => ({
  type: 'linear',
  angle: 90,
  shape: 'ellipse',
  size: 'farthest-corner',
  x: 50,
  y: 50,
  repeating: false,
  stops: [
    { id: 'a', color: '#FF0000', alpha: 1, position: 0 },
    { id: 'b', color: '#0000ff', alpha: 1, position: 100 },
  ],
  ...over,
});

describe('gradientCss', () => {
  it('builds linear gradients', () => {
    expect(gradientCss(g({}))).toBe('linear-gradient(90deg, #ff0000 0%, #0000ff 100%)');
    expect(gradientCss(g({ angle: -45 }))).toBe('linear-gradient(315deg, #ff0000 0%, #0000ff 100%)');
    expect(gradientCss(g({ angle: 720 }))).toBe('linear-gradient(0deg, #ff0000 0%, #0000ff 100%)');
  });

  it('sorts stops by position', () => {
    const css = gradientCss(g({ stops: [{ id: 'b', color: '#0000ff', alpha: 1, position: 80 }, { id: 'a', color: '#ff0000', alpha: 1, position: 10.25 }] }));
    expect(css).toBe('linear-gradient(90deg, #ff0000 10.3%, #0000ff 80%)');
  });

  it('uses rgb with alpha for translucent stops', () => {
    expect(stopColor({ color: '#336699', alpha: 0.5 })).toBe('rgb(51 102 153 / 0.5)');
    expect(stopColor({ color: '#336699', alpha: 1 })).toBe('#336699');
    expect(stopColor({ color: '#336699', alpha: 0 })).toBe('rgb(51 102 153 / 0)');
  });

  it('builds radial gradients, omitting defaults', () => {
    expect(gradientCss(g({ type: 'radial' }))).toBe('radial-gradient(#ff0000 0%, #0000ff 100%)');
    expect(gradientCss(g({ type: 'radial', shape: 'circle', size: 'closest-side', x: 20, y: 80 }))).toBe(
      'radial-gradient(circle closest-side at 20% 80%, #ff0000 0%, #0000ff 100%)',
    );
  });

  it('builds conic gradients', () => {
    expect(gradientCss(g({ type: 'conic', angle: 0 }))).toBe('conic-gradient(#ff0000 0%, #0000ff 100%)');
    expect(gradientCss(g({ type: 'conic', angle: 45, x: 10, y: 10 }))).toBe('conic-gradient(from 45deg at 10% 10%, #ff0000 0%, #0000ff 100%)');
  });

  it('supports repeating gradients', () => {
    expect(gradientCss(g({ repeating: true }))).toMatch(/^repeating-linear-gradient\(/);
    expect(gradientCss(g({ type: 'radial', repeating: true }))).toMatch(/^repeating-radial-gradient\(/);
  });

  it('clamps positions', () => {
    expect(gradientCss(g({ stops: [{ id: 'a', color: '#000000', alpha: 1, position: -10 }, { id: 'b', color: '#ffffff', alpha: 1, position: 140 }] }))).toBe(
      'linear-gradient(90deg, #000000 0%, #ffffff 100%)',
    );
  });

  it('adds a fallback declaration', () => {
    expect(gradientDeclaration(g({}))).toBe('background-color: #ff0000;\nbackground-image: linear-gradient(90deg, #ff0000 0%, #0000ff 100%);');
  });

  it('every preset produces valid-looking CSS', () => {
    for (const p of GRADIENT_PRESETS) expect(gradientCss(p.gradient)).toMatch(/^(repeating-)?(linear|radial|conic)-gradient\(.+\)$/);
  });
});

describe('helpers', () => {
  it('interpolates colors between stops', () => {
    const stops = g({}).stops;
    expect(colorAt(stops, 50)).toEqual({ color: '#800080', alpha: 1 });
    expect(colorAt(stops, -5).color).toBe('#FF0000');
    expect(colorAt(stops, 200).color).toBe('#0000ff');
    expect(colorAt([], 50).color).toBe('#000000');
  });

  it('parses hex safely', () => {
    expect(hexToRgb('#abc')).toEqual([170, 187, 204]);
    expect(hexToRgb('zzz')).toEqual([0, 0, 0]);
    expect(normalizeAngle(-90)).toBe(270);
  });
});
