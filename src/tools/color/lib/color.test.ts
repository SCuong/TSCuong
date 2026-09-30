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

  // Regression: out-of-range legacy channels were gamut-mapped (rgb(300 0 0) became #ff604f) instead of
  // being clamped at parse time as browsers do (it renders as #ff0000).
  it('clamps rgb(), hsl() and hwb() channels like browsers', () => {
    expect(formatColor(c('rgb(300 0 0)'), 'hex')).toBe('#ff0000');
    expect(inSrgb(c('rgb(300 -20 0)'))).toBe(true);
    expect(formatColor(c('rgba(0, 0, 0, 1.5)'), 'rgb')).toBe('rgb(0 0 0)');
    expect(formatColor(c('hsl(0 150% 50%)'), 'hex')).toBe('#ff0000');
    expect(formatColor(c('hwb(0 -10% 0%)'), 'hex')).toBe('#ff0000');
    // color(srgb …) may legitimately be out of gamut and is not clamped.
    expect(inSrgb(c('color(srgb 1.2 0 0)'))).toBe(false);
  });
});

/** Independent CSS Color 4 reference math (sample code from the spec), to check the library's results. */
function referenceLabAndOklch(hex: string) {
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const n = parseInt(hex.slice(1), 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => lin(v / 255));
  const mul = (m: number[][], v: number[]) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
  const xyz65 = mul(
    [
      [506752 / 1228815, 87881 / 245763, 12673 / 70218],
      [87098 / 409605, 175762 / 245763, 12673 / 175545],
      [7918 / 409605, 87881 / 737289, 1001167 / 1053270],
    ],
    rgb,
  );
  const xyz50 = mul(
    [
      [1.0479297925449969, 0.022946870601609652, -0.05019226628920524],
      [0.02962780877005599, 0.9904344267538799, -0.017073799063418826],
      [-0.009243040646204504, 0.015055191490298152, 0.7518742814281371],
    ],
    xyz65,
  );
  const white = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];
  const f = xyz50.map((v, i) => v / white[i]).map((v) => (v > 216 / 24389 ? Math.cbrt(v) : ((24389 / 27) * v + 16) / 116));
  const lms = mul(
    [
      [0.4122214708, 0.5363325363, 0.0514459929],
      [0.2119034982, 0.6806995451, 0.1073969566],
      [0.0883024619, 0.2817188376, 0.6299787005],
    ],
    rgb,
  ).map(Math.cbrt);
  const [L, a, b] = mul(
    [
      [0.2104542553, 0.793617785, -0.0040720468],
      [1.9779984951, -2.428592205, 0.4505937099],
      [0.0259040371, 0.7827717662, -0.808675766],
    ],
    lms,
  );
  return { lab: [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])], oklch: [L * 100, Math.hypot(a, b)] };
}

describe('conversions against the CSS Color 4 reference formulas', () => {
  it.each(['#ff0000', '#00ff00', '#0000ff', '#2563eb', '#777777', '#123456', '#abcdef', '#f0e442', '#663399'])('%s', (hex) => {
    const numbers = (s: string) => (s.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    const ref = referenceLabAndOklch(hex);
    const [l, a, b] = numbers(formatColor(c(hex), 'lab'));
    expect(l).toBeCloseTo(ref.lab[0], 1);
    expect(a).toBeCloseTo(ref.lab[1], 1);
    expect(b).toBeCloseTo(ref.lab[2], 1);
    const [ol, oc] = numbers(formatColor(c(hex), 'oklch'));
    expect(ol).toBeCloseTo(ref.oklch[0], 1);
    expect(oc).toBeCloseTo(ref.oklch[1], 3);
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
    expect(formatRatio(2.996)).toBe('2.99:1');
    expect(formatRatio(6.999)).toBe('6.99:1');
    expect(formatRatio(21)).toBe('21.00:1');
  });

  // Regression: ratios were always truncated, so #777 on white showed 4.47:1 (reference checkers: 4.48:1).
  it('rounds like reference checkers otherwise', () => {
    expect(formatRatio(contrastRatio(c('#777777'), c('#ffffff')))).toBe('4.48:1');
    expect(formatRatio(contrastRatio(c('#ff0000'), c('#ffffff')))).toBe('4.00:1');
    expect(formatRatio(contrastRatio(c('#767676'), c('#ffffff')))).toBe('4.54:1');
    expect(formatRatio(contrastRatio(c('#0000ff'), c('#ffffff')))).toBe('8.59:1');
    expect(formatRatio(contrastRatio(c('#595959'), c('#ffffff')))).toBe('7.00:1');
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

  // Regression: hex codes without "#" (as copied from many palette sites) were silently ignored.
  it('extracts bare hex codes and reports everything else', () => {
    expect(extractColorTokens('1f77b4, ff7f0e;2ca02c cmyk(0% 100% 100% 0%) 12345 #zz')).toEqual([
      '1f77b4',
      'ff7f0e',
      '2ca02c',
      'cmyk(0% 100% 100% 0%)',
      '12345',
      '#zz',
    ]);
  });
});
