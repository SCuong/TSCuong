import { describe, expect, it } from 'vitest';
import { CSS_UNITS, DEFAULT_CONTEXT as ctx, batchConvert, convert, formatNumber, parseLength, pxPerUnit } from './cssUnits';

describe('absolute units', () => {
  it.each([
    [1, 'in', 96],
    [1, 'pt', 4 / 3],
    [12, 'pt', 16],
    [1, 'pc', 16],
    [2.54, 'cm', 96],
    [25.4, 'mm', 96],
    [4, 'Q', 96 / 25.4],
  ] as const)('%s%s = %spx', (v, unit, px) => {
    expect(convert(v, unit, 'px', ctx)).toBeCloseTo(px, 10);
  });
});

describe('relative units', () => {
  it('rem and em use their font sizes', () => {
    expect(convert(1.5, 'rem', 'px', ctx)).toBe(24);
    expect(convert(24, 'px', 'rem', { ...ctx, rootFontSize: 10 })).toBe(2.4);
    expect(convert(2, 'em', 'px', { ...ctx, parentFontSize: 20 })).toBe(40);
    expect(convert(1, 'rem', 'em', { ...ctx, rootFontSize: 16, parentFontSize: 32 })).toBe(0.5);
  });

  it('viewport and percent units', () => {
    expect(convert(50, 'vw', 'px', ctx)).toBe(720);
    expect(convert(10, 'vh', 'px', ctx)).toBe(90);
    expect(convert(10, 'vmin', 'px', ctx)).toBe(90);
    expect(convert(10, 'vmax', 'px', ctx)).toBe(144);
    expect(convert(25, '%', 'px', ctx)).toBe(300);
    expect(convert(600, 'px', '%', ctx)).toBe(50);
  });

  it('round-trips through every unit', () => {
    for (const a of CSS_UNITS) for (const b of CSS_UNITS) expect(convert(convert(13.7, a, b, ctx), b, a, ctx)).toBeCloseTo(13.7, 9);
  });

  it('returns NaN when the reference is zero', () => {
    expect(convert(10, 'px', 'rem', { ...ctx, rootFontSize: 0 })).toBeNaN();
    expect(pxPerUnit('%', { ...ctx, percentBase: 0 })).toBe(0);
  });
});

describe('parseLength', () => {
  it.each([
    ['16px', 16, 'px'],
    [' 1.5 rem ', 1.5, 'rem'],
    ['-2.25EM', -2.25, 'em'],
    ['.5in', 0.5, 'in'],
    ['100%', 100, '%'],
    ['12', 12, 'px'],
    ['1e2px', 100, 'px'],
    ['4Q', 4, 'Q'],
    ['+3pt', 3, 'pt'],
  ] as const)('%j', (text, value, unit) => {
    expect(parseLength(text)).toEqual({ value, unit });
  });

  it('rejects invalid input', () => {
    for (const bad of ['', 'px', '12foo', '1.2.3px', 'abc', '🎉', '--1px']) expect(parseLength(bad)).toBeNull();
  });

  it('uses the default unit for bare numbers', () => {
    expect(parseLength('2', 'rem')).toEqual({ value: 2, unit: 'rem' });
  });
});

describe('batchConvert', () => {
  it('converts a mixed list', () => {
    const rows = batchConvert('16px, 1.5rem\n12pt; 50%\nnope', 'rem', ctx, 4);
    expect(rows.map((r) => r.result ?? r.error)).toEqual(['1rem', '1.5rem', '1rem', '37.5rem', 'Not a CSS length']);
  });

  it('respects precision and handles empty input', () => {
    expect(batchConvert('1px', 'rem', ctx, 2)[0].result).toBe('0.06rem');
    expect(batchConvert('  \n , ', 'px', ctx, 2)).toEqual([]);
  });

  it('handles large lists', () => {
    const rows = batchConvert(Array.from({ length: 5000 }, (_, i) => `${i}px`).join('\n'), 'rem', ctx, 3);
    expect(rows).toHaveLength(5000);
    expect(rows[4999].result).toBe('312.438rem');
  });

  it('formatNumber', () => {
    expect(formatNumber(1.23456, 2)).toBe('1.23');
    expect(formatNumber(-0.0001, 2)).toBe('0');
    expect(formatNumber(Infinity, 2)).toBe('—');
  });
});
