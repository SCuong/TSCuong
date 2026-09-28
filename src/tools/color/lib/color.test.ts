import { describe, expect, it } from 'vitest';
import { parse } from 'culori';
import {
  cmykToRgb,
  cssColor,
  formatColor,
  inSrgb,
  nearestNamed,
  num,
  parseAny,
  parseCmyk,
  readableTextOn,
  rgbToCmyk,
  withAlpha,
} from './color';
import { contrastRatio, composite, evaluate, formatRatio, relativeLuminance, suggestPassing } from './contrast';
import { exportHarmony, exportScale, harmony, nearestStep, normalizeHue, slugify, tintScale, SCALE_STEPS } from './palette';
import { MACHADO_2009, confusablePairs, extractColorTokens, linearToSrgb, simulate, srgbToLinear } from './cvd';

const c = (s: string) => parseAny(s);

describe('parseAny', () => {
  it.each([
    '#f00',
    '#ff0000',
    'ff0000',
    'F00',
    '#ff000080',
    'rgb(255 0 0)',
    'rgb(255, 0, 0)',
    'rgba(255, 0, 0, 0.5)',
    'hsl(0 100% 50%)',
    'hsl(0deg, 100%, 50%)',
    'hwb(0 0% 0%)',
    'lab(54.29% 80.8 69.89)',
    'lch(54.29% 106.84 40.86)',
    'oklab(62.8% 0.2249 0.1258)',
    'oklch(62.8% 0.2577 29.23)',
    'red',
    'RebeccaPurple',
    'transparent',
    'cmyk(0% 100% 100% 0%)',
    'color(display-p3 1 0 0)',
  ])('parses %s', (input) => {
    expect(() => parseAny(input)).not.toThrow();
  });

  it('rejects junk with a readable message', () => {
    expect(() => parseAny('')).toThrow(/Enter a color/);
    expect(() => parseAny('not a color')).toThrow(/not a color/);
    expect(() => parseAny('#12')).toThrow();
    expect(() => parseAny('🎨')).toThrow(/not a color/);
    expect(() => parseAny('rgb(1,2)')).toThrow();
  });
});

describe('formatColor', () => {
  it('converts red to every format', () => {
    const red = c('#ff0000');
    expect(formatColor(red, 'hex')).toBe('#ff0000');
    expect(formatColor(red, 'hex8')).toBe('#ff0000ff');
    expect(formatColor(red, 'rgb')).toBe('rgb(255 0 0)');
    expect(formatColor(red, 'rgbLegacy')).toBe('rgb(255, 0, 0)');
    expect(formatColor(red, 'hsl')).toBe('hsl(0 100% 50%)');
    expect(formatColor(red, 'hwb')).toBe('hwb(0 0% 0%)');
    expect(formatColor(red, 'cmyk')).toBe('cmyk(0% 100% 100% 0%)');
    expect(formatColor(red, 'oklch')).toMatch(/^oklch\(62\.[78]\d?% 0\.257\d 29\.2\d\)$/);
    expect(formatColor(red, 'oklab')).toMatch(/^oklab\(62\.[78]\d?% 0\.22\d+ 0\.12\d+\)$/);
    expect(formatColor(red, 'lab')).toMatch(/^lab\(54\.29% 80\.\d+ 69\.\d+\)$/);
    expect(formatColor(red, 'lch')).toMatch(/^lch\(54\.29% 106\.\d+ 40\.\d+\)$/);
  });

  it('includes alpha', () => {
    const semi = c('rgba(0, 128, 255, 0.5)');
    expect(formatColor(semi, 'rgb')).toBe('rgb(0 128 255 / 0.5)');
    expect(formatColor(semi, 'rgbLegacy')).toBe('rgba(0, 128, 255, 0.5)');
    expect(formatColor(semi, 'hex8')).toBe('#0080ff80');
    expect(formatColor(semi, 'hsl')).toMatch(/\/ 0\.5\)$/);
    expect(cssColor(semi)).toBe('#0080ff80');
    expect(cssColor(withAlpha(semi, 1))).toBe('#0080ff');
  });

  it('round-trips through hex and hsl', () => {
    for (const hex of ['#000000', '#ffffff', '#123456', '#abcdef', '#7f7f7f', '#00ff00']) {
      expect(formatColor(c(formatColor(c(hex), 'hsl')), 'hex')).toBe(hex);
      expect(formatColor(c(formatColor(c(hex), 'oklch')), 'hex')).toBe(hex);
      expect(formatColor(c(formatColor(c(hex), 'lab')), 'hex')).toBe(hex);
      expect(formatColor(c(formatColor(c(hex), 'cmyk')), 'hex')).toBe(hex);
    }
  });

  it('handles achromatic hue as 0', () => {
    expect(formatColor(c('#808080'), 'hsl')).toBe('hsl(0 0% 50.2%)');
    expect(formatColor(c('white'), 'oklch')).toMatch(/^oklch\(100% 0 0\)$/);
  });

  it('detects and maps out-of-gamut colors', () => {
    const vivid = c('oklch(70% 0.4 150)');
    expect(inSrgb(vivid)).toBe(false);
    const hex = formatColor(vivid, 'hex');
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(inSrgb(parse(hex)!)).toBe(true);
    // The OKLCH field keeps the original, unmapped value.
    expect(formatColor(vivid, 'oklch')).toBe('oklch(70% 0.4 150)');
    expect(inSrgb(c('#ff0000'))).toBe(true);
    expect(inSrgb(c('color(display-p3 1 0 0)'))).toBe(false);
  });
});

describe('CMYK', () => {
  it('converts both ways', () => {
    expect(rgbToCmyk(0, 0, 0)).toEqual({ c: 0, m: 0, y: 0, k: 1 });
    expect(rgbToCmyk(1, 1, 1)).toEqual({ c: 0, m: 0, y: 0, k: 0 });
    const x = rgbToCmyk(0.2, 0.4, 0.6);
    const back = cmykToRgb(x.c, x.m, x.y, x.k);
    expect(back.r).toBeCloseTo(0.2);
    expect(back.g).toBeCloseTo(0.4);
    expect(back.b).toBeCloseTo(0.6);
  });

  it('parses several syntaxes', () => {
    expect(formatColor(parseCmyk('cmyk(0%, 100%, 100%, 0%)')!, 'hex')).toBe('#ff0000');
    expect(formatColor(parseCmyk('device-cmyk(0 1 1 0)')!, 'hex')).toBe('#ff0000');
    expect(formatColor(parseCmyk('0 100 100 0')!, 'hex')).toBe('#ff0000');
    expect(parseCmyk('cmyk(0 0 0)')).toBeNull();
    expect(parseCmyk('cmyk(120% 0 0 0)')).toBeNull();
  });
});

describe('names and helpers', () => {
  it('finds exact names', () => {
    expect(nearestNamed(c('#ff0000'))).toMatchObject({ name: 'red', exact: true });
    expect(nearestNamed(c('#663399'))).toMatchObject({ name: 'rebeccapurple', exact: true });
  });

  it('finds the closest name', () => {
    const m = nearestNamed(c('#fe0102'));
    expect(m.exact).toBe(false);
    expect(m.name).toBe('red');
    expect(m.distance).toBeGreaterThan(0);
  });

  it('num strips zeros and negative zero', () => {
    expect(num(1.5, 2)).toBe('1.5');
    expect(num(-0.0001, 2)).toBe('0');
    expect(num(NaN, 2)).toBe('0');
  });

  it('readable text', () => {
    expect(readableTextOn(c('#ffffff'))).toBe('#000000');
    expect(readableTextOn(c('#000000'))).toBe('#ffffff');
    expect(readableTextOn(c('#2563eb'))).toBe('#ffffff');
    expect(readableTextOn(c('#facc15'))).toBe('#000000');
  });
});

describe('contrast', () => {
  it('computes known ratios', () => {
    expect(contrastRatio(c('#000'), c('#fff'))).toBeCloseTo(21, 5);
    expect(contrastRatio(c('#fff'), c('#fff'))).toBe(1);
    expect(contrastRatio(c('#777777'), c('#ffffff'))).toBeCloseTo(4.478, 2);
    expect(contrastRatio(c('#767676'), c('#ffffff'))).toBeCloseTo(4.54, 2);
    // Symmetric.
    expect(contrastRatio(c('#2563eb'), c('#fff'))).toBeCloseTo(contrastRatio(c('#fff'), c('#2563eb')), 10);
  });

  it('luminance', () => {
    expect(relativeLuminance(c('#fff'))).toBeCloseTo(1);
    expect(relativeLuminance(c('#000'))).toBe(0);
  });

  it('composites translucent text', () => {
    const mixed = composite(c('rgba(0,0,0,0.5)'), c('#ffffff'));
    expect(mixed.r).toBeCloseTo(0.5);
    expect(contrastRatio(c('rgba(0,0,0,0.5)'), c('#fff'))).toBeLessThan(contrastRatio(c('#000'), c('#fff')));
    expect(contrastRatio(c('rgba(0,0,0,0)'), c('#fff'))).toBeCloseTo(1);
  });

  it('evaluates WCAG criteria at the thresholds', () => {
    const at45 = evaluate(4.5);
    expect(at45.find((x) => x.id === 'aa-normal')?.pass).toBe(true);
    expect(at45.find((x) => x.id === 'aaa-normal')?.pass).toBe(false);
    expect(evaluate(4.4999).find((x) => x.id === 'aa-normal')?.pass).toBe(false);
    expect(evaluate(3).find((x) => x.id === 'ui')?.pass).toBe(true);
  });

  it('formats without rounding a fail up to a pass', () => {
    expect(formatRatio(4.4999)).toBe('4.49:1');
    expect(formatRatio(21)).toBe('21.00:1');
  });

  it.each([
    ['#777777', '#ffffff', 4.5],
    ['#777777', '#ffffff', 7],
    ['#2563eb', '#1e293b', 4.5],
    ['#ff0000', '#00ff00', 3],
    ['#ffcc00', '#ffffff', 4.5],
    ['#a0a0a0', '#808080', 4.5],
  ])('suggests a passing color for %s on %s (≥ %s)', (fg, bg, target) => {
    const s = suggestPassing(c(fg), c(bg), target);
    expect(s).not.toBeNull();
    expect(contrastRatio(c(s!.color), c(bg))).toBeGreaterThanOrEqual(target);
    expect(s!.ratio).toBeGreaterThanOrEqual(target);
  });

  it('prefers the smaller lightness change', () => {
    const s = suggestPassing(c('#777777'), c('#ffffff'), 4.5)!;
    expect(s.deltaL).toBeLessThan(0);
    expect(Math.abs(s.deltaL)).toBeLessThan(0.02);
  });

  it('can adjust the background instead', () => {
    const s = suggestPassing(c('#ffffff'), c('#999999'), 4.5, false)!;
    expect(contrastRatio(c('#999999'), c(s.color))).toBeGreaterThanOrEqual(4.5);
  });

  it('returns the color unchanged when it already passes', () => {
    const s = suggestPassing(c('#000000'), c('#ffffff'), 4.5)!;
    expect(s.color).toBe('#000000');
  });

  it('returns null when impossible', () => {
    expect(suggestPassing(c('#777777'), c('#777777'), 22)).toBeNull();
  });
});

describe('palette', () => {
  it('rotates hues in OKLCH', () => {
    const base = c('#3b82f6');
    const comp = harmony(base, 'complementary');
    expect(comp).toHaveLength(2);
    expect(comp[0].hex).toBe('#3b82f6');
    const dh = normalizeHue(comp[1].h - comp[0].h);
    expect(Math.abs(dh - 180)).toBeLessThan(6); // gamut mapping can shift hue slightly
    expect(harmony(base, 'triadic')).toHaveLength(3);
    expect(harmony(base, 'tetradic')).toHaveLength(4);
    expect(harmony(base, 'square')).toHaveLength(4);
    expect(harmony(base, 'split')).toHaveLength(3);
    expect(harmony(base, 'analogous')[1].hex).toBe('#3b82f6');
    const mono = harmony(base, 'monochromatic');
    expect(mono).toHaveLength(5);
    expect(mono.map((s) => s.hex)).toContain('#3b82f6');
  });

  it('all swatches are valid sRGB hex', () => {
    for (const id of ['complementary', 'analogous', 'triadic', 'split', 'tetradic', 'square', 'monochromatic'] as const) {
      for (const s of harmony(c('#e11d48'), id)) expect(s.hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('builds a monotonic 50–950 scale with the base at its nearest step', () => {
    for (const hex of ['#3b82f6', '#ef4444', '#10b981', '#facc15', '#111827', '#f8fafc', '#808080', '#7c3aed']) {
      const scale = tintScale(c(hex));
      expect(scale.map((s) => s.step)).toEqual([...SCALE_STEPS]);
      expect(scale.filter((s) => s.isBase)).toHaveLength(1);
      expect(scale.find((s) => s.isBase)!.hex).toBe(hex);
      for (let i = 1; i < scale.length; i++) expect(scale[i].l).toBeLessThan(scale[i - 1].l + 1e-9);
      for (const s of scale) expect(s.hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('can anchor at 500', () => {
    const scale = tintScale(c('#f8fafc'), 500);
    expect(scale.find((s) => s.step === 500)!.hex).toBe('#f8fafc');
    expect(nearestStep(c('#3b82f6'))).toBe(500);
  });

  it('exports', () => {
    const scale = tintScale(c('#3b82f6'));
    expect(exportScale('Brand Blue', scale, 'css')).toContain('--color-brand-blue-500: #3b82f6;');
    expect(exportScale('Brand Blue', scale, 'css-oklch')).toMatch(/--color-brand-blue-50: oklch\([\d.]+% [\d.]+ [\d.]+\);/);
    expect(exportScale('Brand Blue', scale, 'tailwind3')).toContain("'brand-blue': {");
    expect(exportScale('Brand Blue', scale, 'tailwind4')).toMatch(/^@theme \{/);
    const json = JSON.parse(exportScale('Brand Blue', scale, 'json'));
    expect(json['brand-blue']['500']).toBe('#3b82f6');
    const svg = exportScale('Brand <Blue>', scale, 'svg');
    expect(svg).toContain('<title>Brand &lt;Blue&gt;</title>');
    expect(svg.match(/<rect /g)).toHaveLength(11);
    expect(exportHarmony('x', harmony(c('#3b82f6'), 'triadic'), 'css')).toContain('--color-x-3:');
  });

  it('slugifies names', () => {
    expect(slugify('  Brand Blue! ')).toBe('brand-blue');
    expect(slugify('Café Crème')).toBe('cafe-creme');
    expect(slugify('🎨')).toBe('color');
  });
});

describe('color vision deficiency', () => {
  it('matrix rows sum to 1 (white stays white)', () => {
    for (const m of Object.values(MACHADO_2009)) {
      for (const row of m) expect(row[0] + row[1] + row[2]).toBeCloseTo(1, 5);
    }
  });

  it('keeps white, black and greys unchanged', () => {
    for (const type of ['protanopia', 'deuteranopia', 'tritanopia', 'achromatopsia'] as const) {
      expect(simulate(c('#ffffff'), type)).toBe('#ffffff');
      expect(simulate(c('#000000'), type)).toBe('#000000');
      expect(simulate(c('#808080'), type)).toBe('#808080');
    }
  });

  it('gamma helpers round-trip', () => {
    for (const v of [0, 0.02, 0.2, 0.5, 1]) expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 6);
  });

  it('matches hand-computed results', () => {
    // Pure red under protanopia: linear (1,0,0) × first column.
    const expected = [0.152286, 0.114503, -0.003882].map((v) => Math.round(linearToSrgb(v) * 255));
    const hex = simulate(c('#ff0000'), 'protanopia');
    expect([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))).toEqual(expected);
    // Achromatopsia: luminance only.
    const g = simulate(c('#00ff00'), 'achromatopsia');
    expect(g.slice(1, 3)).toBe(g.slice(3, 5));
    expect(parseInt(g.slice(1, 3), 16)).toBe(Math.round(linearToSrgb(0.7152) * 255));
  });

  it('flags red/green confusion for deuteranopia but not for typical vision', () => {
    const colors = [c('#d62728'), c('#2ca02c'), c('#1f77b4')];
    expect(confusablePairs(colors, 'normal')).toEqual([]);
    const pairs = confusablePairs([c('#ff0000'), c('#7f7f00'), c('#0000ff')], 'deuteranopia', 0.08);
    expect(pairs.some((p) => p.a === 0 && p.b === 1)).toBe(true);
  });

  it('extracts color tokens', () => {
    expect(extractColorTokens('#fff, rgb(1 2 3)\nred  oklch(50% 0.1 20) #12345678')).toEqual([
      '#fff',
      'rgb(1 2 3)',
      'red',
      'oklch(50% 0.1 20)',
      '#12345678',
    ]);
  });
});
