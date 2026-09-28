import { describe, expect, it } from 'vitest';
import { RADIUS_PRESETS, borderRadiusLonghand, borderRadiusValue, shorten4, type RadiusConfig } from './radius';
import { SHADOW_PRESETS, layerColor, layerCss, shadowCss, type ShadowLayer } from './shadow';

const layer = (over: Partial<ShadowLayer> = {}): ShadowLayer => ({
  id: 'a',
  x: 0,
  y: 4,
  blur: 12,
  spread: 0,
  color: '#000000',
  opacity: 0.25,
  inset: false,
  visible: true,
  ...over,
});

describe('box-shadow', () => {
  it('formats a layer', () => {
    expect(layerCss(layer())).toBe('0 4px 12px 0 rgb(0 0 0 / 0.25)');
    expect(layerCss(layer({ inset: true, x: -2, spread: 3, opacity: 1, color: '#FF0000' }))).toBe('inset -2px 4px 12px 3px #ff0000');
  });

  it('clamps blur and opacity', () => {
    expect(layerCss(layer({ blur: -5 }))).toBe('0 4px 0 0 rgb(0 0 0 / 0.25)');
    expect(layerColor({ color: '#123456', opacity: 2 })).toBe('#123456');
    expect(layerColor({ color: '#123456', opacity: -1 })).toBe('rgb(18 52 86 / 0)');
  });

  it('joins layers and skips hidden ones', () => {
    expect(shadowCss([layer(), layer({ id: 'b', y: 1, blur: 2, visible: false }), layer({ id: 'c', inset: true })])).toBe(
      '0 4px 12px 0 rgb(0 0 0 / 0.25), inset 0 4px 12px 0 rgb(0 0 0 / 0.25)',
    );
    expect(shadowCss([])).toBe('none');
    expect(shadowCss([layer({ visible: false })])).toBe('none');
  });

  it('rounds decimals', () => {
    expect(layerCss(layer({ x: 1.26, y: 0.04 }))).toBe('1.3px 0 12px 0 rgb(0 0 0 / 0.25)');
  });

  it('presets are valid', () => {
    for (const p of SHADOW_PRESETS) expect(shadowCss(p.layers)).not.toBe('none');
  });
});

const cfg = (tl: [number, number], tr: [number, number], br: [number, number], bl: [number, number], elliptical = true, unit: 'px' | '%' = 'px'): RadiusConfig => ({
  topLeft: { x: tl[0], y: tl[1] },
  topRight: { x: tr[0], y: tr[1] },
  bottomRight: { x: br[0], y: br[1] },
  bottomLeft: { x: bl[0], y: bl[1] },
  unit,
  elliptical,
});

describe('border-radius', () => {
  it('shortens per CSS shorthand rules', () => {
    expect(shorten4(['1', '1', '1', '1'])).toEqual(['1']);
    expect(shorten4(['1', '2', '1', '2'])).toEqual(['1', '2']);
    expect(shorten4(['1', '2', '3', '2'])).toEqual(['1', '2', '3']);
    expect(shorten4(['1', '2', '3', '4'])).toEqual(['1', '2', '3', '4']);
    expect(shorten4(['1', '1', '2', '2'])).toEqual(['1', '1', '2', '2']);
    expect(shorten4(['1', '2', '1', '3'])).toEqual(['1', '2', '1', '3']);
  });

  it('uses the shortest single-axis value', () => {
    expect(borderRadiusValue(cfg([8, 8], [8, 8], [8, 8], [8, 8], false))).toBe('8px');
    expect(borderRadiusValue(cfg([0, 0], [0, 0], [0, 0], [0, 0], false))).toBe('0');
    expect(borderRadiusValue(cfg([10, 99], [20, 99], [10, 99], [20, 99], false))).toBe('10px 20px');
    expect(borderRadiusValue(cfg([50, 50], [50, 50], [50, 50], [50, 50], false, '%'))).toBe('50%');
  });

  it('uses the 8-value syntax only when the axes differ', () => {
    expect(borderRadiusValue(cfg([30, 30], [70, 30], [70, 70], [30, 70], true, '%'))).toBe('30% 70% 70% 30% / 30% 30% 70% 70%');
    expect(borderRadiusValue(cfg([10, 10], [10, 10], [10, 10], [10, 10]))).toBe('10px');
    expect(borderRadiusValue(cfg([10, 20], [10, 20], [10, 20], [10, 20]))).toBe('10px / 20px');
  });

  it('writes longhands', () => {
    expect(borderRadiusLonghand(cfg([10, 20], [5, 5], [0, 0], [1.234, 1.234]))).toBe(
      'border-top-left-radius: 10px 20px;\nborder-top-right-radius: 5px;\nborder-bottom-right-radius: 0;\nborder-bottom-left-radius: 1.23px;',
    );
  });

  it('clamps negatives', () => {
    expect(borderRadiusValue(cfg([-5, 0], [0, 0], [0, 0], [0, 0], false))).toBe('0');
  });

  it('presets produce values', () => {
    for (const p of RADIUS_PRESETS) expect(borderRadiusValue(p.config).length).toBeGreaterThan(0);
  });
});
