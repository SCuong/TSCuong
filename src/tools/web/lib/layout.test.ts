import { describe, expect, it } from 'vitest';
import { DEVICES, FRAMEWORKS, activeBreakpoint, buildMediaQuery, frameworkQuery, type MediaQueryOptions } from './breakpoints';
import { approximate, commonSizes, cssSnippets, fmt, gcd, paddingPercent, parseRatio, ratioDecimal, ratioLabel, simplifyRatio, solveHeight, solveWidth } from './aspectRatio';

const fw = (id: string) => FRAMEWORKS.find((f) => f.id === id)!;
const q = (o: Partial<MediaQueryOptions>) =>
  buildMediaQuery({ mode: 'min', min: 768, max: 1024, unit: 'px', syntax: 'classic', orientation: 'any', colorScheme: 'any', reducedMotion: false, hover: false, ...o });

describe('breakpoints', () => {
  it('finds the active breakpoint at the edges', () => {
    expect(activeBreakpoint(fw('tailwind'), 639).name).toBe('(base)');
    expect(activeBreakpoint(fw('tailwind'), 640).name).toBe('sm');
    expect(activeBreakpoint(fw('tailwind'), 1536).name).toBe('2xl');
    expect(activeBreakpoint(fw('bootstrap'), 991).name).toBe('md');
    expect(activeBreakpoint(fw('bootstrap'), 992).name).toBe('lg');
    expect(activeBreakpoint(fw('material'), 599).name).toBe('Compact');
    expect(activeBreakpoint(fw('material'), 1600).name).toBe('Extra-large');
    expect(activeBreakpoint(fw('foundation'), 1023).name).toBe('medium');
    expect(activeBreakpoint(fw('foundation'), 1440).name).toBe('xxlarge');
  });

  it('writes framework-native queries', () => {
    const tw = fw('tailwind');
    expect(frameworkQuery(tw, tw.breakpoints[0], 'up')).toBeNull();
    expect(frameworkQuery(tw, tw.breakpoints[0], 'only')).toBe('@media (width < 40rem)');
    expect(frameworkQuery(tw, tw.breakpoints[1], 'up')).toBe('@media (width >= 40rem)');
    expect(frameworkQuery(tw, tw.breakpoints[2], 'only')).toBe('@media (48rem <= width < 64rem)');
    expect(frameworkQuery(tw, tw.breakpoints[5], 'only')).toBe('@media (width >= 96rem)');
    const bs = fw('bootstrap');
    expect(frameworkQuery(bs, bs.breakpoints[2], 'up')).toBe('@media (min-width: 768px)');
    expect(frameworkQuery(bs, bs.breakpoints[2], 'only')).toBe('@media (min-width: 768px) and (max-width: 991.98px)');
    expect(frameworkQuery(bs, bs.breakpoints[0], 'only')).toBe('@media (max-width: 575.98px)');
    const fd = fw('foundation');
    expect(frameworkQuery(fd, fd.breakpoints[1], 'only')).toBe('@media print, screen and (min-width: 40em) and (max-width: 63.99875em)');
    expect(frameworkQuery(fd, fd.breakpoints[2], 'up')).toBe('@media print, screen and (min-width: 64em)');
  });

  it('framework data is contiguous', () => {
    for (const f of FRAMEWORKS) {
      expect(f.breakpoints[0].min).toBe(0);
      for (let i = 1; i < f.breakpoints.length; i++) expect(f.breakpoints[i].min).toBe(f.breakpoints[i - 1].max);
      expect(f.breakpoints[f.breakpoints.length - 1].max).toBeNull();
    }
    expect(DEVICES.every((d) => d.width > 0 && d.height > 0)).toBe(true);
  });

  it('builds classic queries with the 0.02px offset', () => {
    expect(q({})).toBe('@media (min-width: 768px) {\n  /* your styles */\n}');
    expect(q({ mode: 'max' })).toContain('(max-width: 1023.98px)');
    expect(q({ mode: 'between' })).toContain('(min-width: 768px) and (max-width: 1023.98px)');
    expect(q({ mode: 'min', unit: 'em' })).toContain('(min-width: 48em)');
  });

  it('builds range syntax', () => {
    expect(q({ syntax: 'range' })).toContain('(width >= 768px)');
    expect(q({ syntax: 'range', mode: 'max' })).toContain('(width < 1024px)');
    expect(q({ syntax: 'range', mode: 'between', min: 1024, max: 768 })).toContain('(768px <= width < 1024px)');
  });

  it('adds feature conditions', () => {
    const s = q({ orientation: 'landscape', colorScheme: 'dark', reducedMotion: true, hover: true });
    expect(s).toContain('and (orientation: landscape) and (prefers-color-scheme: dark) and (prefers-reduced-motion: reduce) and (hover: hover) and (pointer: fine)');
  });
});

describe('aspect ratio', () => {
  it('gcd and simplification', () => {
    expect(gcd(1920, 1080)).toBe(120);
    expect(simplifyRatio(1920, 1080)).toEqual({ w: 16, h: 9 });
    expect(simplifyRatio(1280, 1024)).toEqual({ w: 5, h: 4 });
    expect(simplifyRatio(7, 3)).toEqual({ w: 7, h: 3 });
    expect(simplifyRatio(0, 3)).toBeNull();
    expect(simplifyRatio(-1, 3)).toBeNull();
    expect(simplifyRatio(NaN, 3)).toBeNull();
  });

  it('approximates decimal ratios', () => {
    expect(simplifyRatio(1.85, 1)).toEqual({ w: 37, h: 20 });
    expect(simplifyRatio(2.39, 1)).toEqual({ w: 239, h: 100 });
    expect(approximate(Math.PI, 10)).toEqual({ w: 22, h: 7 });
    expect(approximate(1.7777778)).toEqual({ w: 16, h: 9 });
  });

  // Regression: an unlocked width of 0.5 next to a height of 1280 produced the invalid ratio "0:1".
  it('keeps extreme decimal ratios instead of approximating them to zero', () => {
    expect(simplifyRatio(0.5, 1280)).toEqual({ w: 0.5, h: 1280 });
    expect(ratioLabel(simplifyRatio(0.5, 1280)!)).toBe('0.5:1280');
    expect(parseRatio('0.5:1280')).toEqual({ w: 0.5, h: 1280 });
    expect(simplifyRatio(1000.5, 1)).toEqual({ w: 2001, h: 2 });
  });

  it('solves missing sides', () => {
    expect(solveHeight(1920, { w: 16, h: 9 })).toBe(1080);
    expect(solveWidth(1080, { w: 9, h: 16 })).toBe(607.5);
    expect(ratioDecimal({ w: 21, h: 9 })).toBeCloseTo(2.3333, 4);
  });

  it('parses ratio text', () => {
    expect(parseRatio('16:9')).toEqual({ w: 16, h: 9 });
    expect(parseRatio(' 16 / 9 ')).toEqual({ w: 16, h: 9 });
    expect(parseRatio('4x3')).toEqual({ w: 4, h: 3 });
    expect(parseRatio('2.39')).toEqual({ w: 2.39, h: 1 });
    expect(parseRatio('1.85:1')).toEqual({ w: 1.85, h: 1 });
    expect(parseRatio('.5')).toEqual({ w: 0.5, h: 1 });
    expect(parseRatio('')).toBeNull();
    expect(parseRatio('16:0')).toBeNull();
    expect(parseRatio('-16:9')).toBeNull();
    expect(parseRatio('abc')).toBeNull();
    expect(parseRatio('16:9:1')).toBeNull();
  });

  it('formats CSS output', () => {
    expect(fmt(1.23456789)).toBe('1.2346');
    expect(fmt(2)).toBe('2');
    expect(ratioLabel({ w: 1920, h: 1080 })).toBe('16:9');
    expect(ratioLabel({ w: 1.85, h: 1 }, ' / ')).toBe('1.85 / 1');
    expect(paddingPercent({ w: 16, h: 9 })).toBe('56.25%');
    expect(paddingPercent({ w: 4, h: 3 })).toBe('75%');
    expect(paddingPercent({ w: 21, h: 9 })).toBe('42.8571%');
    const css = cssSnippets({ w: 1920, h: 1080 });
    expect(css.modern).toContain('aspect-ratio: 16 / 9;');
    expect(css.legacy).toContain('padding-top: 56.25%; /* 16:9 */');
  });

  it('lists exact common sizes', () => {
    const s = commonSizes({ w: 16, h: 9 });
    expect(s).toContainEqual({ w: 1920, h: 1080 });
    expect(s).toContainEqual({ w: 3840, h: 2160 });
    expect(s.every((x) => (x.w * 9) / 16 === x.h)).toBe(true);
  });
});
