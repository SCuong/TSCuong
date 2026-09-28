import { converter, formatHex, toGamut, type Color, type Oklch } from 'culori';

const toOklch = converter('oklch');
const toRgb = converter('rgb');
const mapToSrgb = toGamut('rgb', 'oklch');

export type HarmonyId = 'complementary' | 'analogous' | 'triadic' | 'split' | 'tetradic' | 'square' | 'monochromatic';

export const HARMONIES: Array<{ id: HarmonyId; label: string; description: string }> = [
  { id: 'complementary', label: 'Complementary', description: 'The base and the hue opposite it (180°).' },
  { id: 'analogous', label: 'Analogous', description: 'Neighbouring hues 30° either side of the base.' },
  { id: 'triadic', label: 'Triadic', description: 'Three hues evenly spaced 120° apart.' },
  { id: 'split', label: 'Split complementary', description: 'The base plus the two hues 30° either side of its complement.' },
  { id: 'tetradic', label: 'Tetradic', description: 'Two complementary pairs forming a rectangle (0°, 60°, 180°, 240°).' },
  { id: 'square', label: 'Square', description: 'Four hues evenly spaced 90° apart.' },
  { id: 'monochromatic', label: 'Monochromatic', description: 'One hue at several lightness levels.' },
];

const OFFSETS: Record<Exclude<HarmonyId, 'monochromatic'>, number[]> = {
  complementary: [0, 180],
  analogous: [-30, 0, 30],
  triadic: [0, 120, 240],
  split: [0, 150, 210],
  tetradic: [0, 60, 180, 240],
  square: [0, 90, 180, 270],
};

export interface Swatch {
  hex: string;
  /** OKLCH values of the (gamut-mapped) color. */
  l: number;
  c: number;
  h: number;
}

export function normalizeHue(h: number): number {
  return ((h % 360) + 360) % 360;
}

function toSwatch(color: Color): Swatch {
  const mapped = toRgb(mapToSrgb(color));
  const clamped = {
    mode: 'rgb' as const,
    r: Math.min(1, Math.max(0, mapped.r)),
    g: Math.min(1, Math.max(0, mapped.g)),
    b: Math.min(1, Math.max(0, mapped.b)),
  };
  const o = toOklch(clamped);
  return { hex: formatHex(clamped), l: o.l, c: o.c ?? 0, h: normalizeHue(o.h ?? 0) };
}

/** Harmony colors, computed by rotating the hue in OKLCH (perceptually even) and gamut-mapping to sRGB. */
export function harmony(base: Color, id: HarmonyId): Swatch[] {
  const o = toOklch(base);
  const h = o.h ?? 0;
  const c = o.c ?? 0;
  if (id === 'monochromatic') {
    const levels = [0.3, 0.45, 0.6, 0.75, 0.9];
    // Put the base itself in the row, replacing the closest level.
    const closest = levels.reduce((best, l, i) => (Math.abs(l - o.l) < Math.abs(levels[best] - o.l) ? i : best), 0);
    return levels.map((l, i) => (i === closest ? toSwatch(o) : toSwatch({ mode: 'oklch', l, c, h })));
  }
  return OFFSETS[id].map((offset) => toSwatch(offset === 0 ? o : { mode: 'oklch', l: o.l, c, h: normalizeHue(h + offset) }));
}

export const SCALE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
export type ScaleStep = (typeof SCALE_STEPS)[number];

/** Reference lightness curve (OKLCH L) modelled on common design-system scales. */
const L_CURVE: Record<ScaleStep, number> = {
  50: 0.971,
  100: 0.936,
  200: 0.885,
  300: 0.808,
  400: 0.704,
  500: 0.637,
  600: 0.577,
  700: 0.505,
  800: 0.444,
  900: 0.396,
  950: 0.258,
};

/** Chroma relative to the base: low at the extremes where sRGB has little room. */
const C_CURVE: Record<ScaleStep, number> = {
  50: 0.06,
  100: 0.14,
  200: 0.27,
  300: 0.5,
  400: 0.8,
  500: 1,
  600: 1,
  700: 0.9,
  800: 0.76,
  900: 0.62,
  950: 0.42,
};

export interface ScaleSwatch extends Swatch {
  step: ScaleStep;
  isBase: boolean;
}

/** The step whose reference lightness is closest to the color's lightness. */
export function nearestStep(color: Color): ScaleStep {
  const l = toOklch(color).l;
  let best: ScaleStep = 500;
  for (const s of SCALE_STEPS) if (Math.abs(L_CURVE[s] - l) < Math.abs(L_CURVE[best] - l)) best = s;
  return best;
}

/**
 * A 50–950 tints and shades scale in OKLCH. The base color is placed exactly at
 * `anchor` (default: the step with the closest lightness); the other steps follow the
 * reference lightness curve, remapped piecewise so the scale stays monotonic.
 */
export function tintScale(base: Color, anchor: ScaleStep | 'auto' = 'auto'): ScaleSwatch[] {
  const o = toOklch(base) as Oklch;
  const baseC = o.c ?? 0;
  const baseH = o.h ?? 0;
  const step = anchor === 'auto' ? nearestStep(o) : anchor;
  const anchorIndex = SCALE_STEPS.indexOf(step);
  const top = Math.max(L_CURVE[50], o.l);
  const bottom = Math.min(L_CURVE[950], o.l);
  // Keep the base's chroma at the anchor; scale the others relative to the anchor's factor.
  const chromaScale = baseC / C_CURVE[step];

  return SCALE_STEPS.map((s, i) => {
    if (i === anchorIndex) return { ...toSwatch(o), step: s, isBase: true };
    let l: number;
    if (i < anchorIndex) {
      // Between the top (step 50) and the anchor.
      const t = (L_CURVE[50] - L_CURVE[s]) / (L_CURVE[50] - L_CURVE[step] || 1);
      l = top + (o.l - top) * t;
    } else {
      const t = (L_CURVE[s] - L_CURVE[step]) / (L_CURVE[950] - L_CURVE[step] || 1);
      l = o.l + (bottom - o.l) * t;
    }
    const c = Math.min(0.4, chromaScale * C_CURVE[s]);
    return { ...toSwatch({ mode: 'oklch', l, c, h: baseH }), step: s, isBase: false };
  });
}

/* -------------------------------------------------------------------------- */
/* Export                                                                     */
/* -------------------------------------------------------------------------- */

export function slugify(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'color';
}

function oklchCss(s: Swatch): string {
  const r = (v: number, d: number) => String(Number(v.toFixed(d)));
  return `oklch(${r(s.l * 100, 2)}% ${r(s.c, 4)} ${r(s.h, 2)})`;
}

export type ExportFormat = 'css' | 'css-oklch' | 'tailwind3' | 'tailwind4' | 'json' | 'svg';

export function exportScale(name: string, scale: ScaleSwatch[], format: ExportFormat): string {
  const slug = slugify(name);
  switch (format) {
    case 'css':
      return `:root {\n${scale.map((s) => `  --color-${slug}-${s.step}: ${s.hex};`).join('\n')}\n}\n`;
    case 'css-oklch':
      return `:root {\n${scale.map((s) => `  --color-${slug}-${s.step}: ${oklchCss(s)};`).join('\n')}\n}\n`;
    case 'tailwind3':
      return [
        '/** @type {import(\'tailwindcss\').Config} */',
        'export default {',
        '  theme: {',
        '    extend: {',
        '      colors: {',
        `        '${slug}': {`,
        ...scale.map((s) => `          ${s.step}: '${s.hex}',`),
        '        },',
        '      },',
        '    },',
        '  },',
        '};',
        '',
      ].join('\n');
    case 'tailwind4':
      return `@theme {\n${scale.map((s) => `  --color-${slug}-${s.step}: ${oklchCss(s)};`).join('\n')}\n}\n`;
    case 'json':
      return `${JSON.stringify({ [slug]: Object.fromEntries(scale.map((s) => [String(s.step), s.hex])) }, null, 2)}\n`;
    case 'svg':
      return scaleSvg(name, scale);
  }
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function textOn(hex: string): string {
  const rgb = toRgb(hex)!;
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(rgb.r) + 0.7152 * lin(rgb.g) + 0.0722 * lin(rgb.b);
  return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? '#000000' : '#ffffff';
}

export function scaleSvg(name: string, swatches: Array<Swatch & { step?: number | string }>): string {
  const w = 96;
  const h = 120;
  const width = w * swatches.length;
  const items = swatches
    .map((s, i) => {
      const x = i * w;
      const fg = textOn(s.hex);
      const label = s.step !== undefined ? String(s.step) : '';
      return [
        `  <rect x="${x}" y="0" width="${w}" height="${h}" fill="${s.hex}"/>`,
        label ? `  <text x="${x + 10}" y="${h - 32}" fill="${fg}" font-family="system-ui, sans-serif" font-size="13" font-weight="600">${escapeXml(label)}</text>` : '',
        `  <text x="${x + 10}" y="${h - 14}" fill="${fg}" font-family="ui-monospace, monospace" font-size="12">${s.hex}</text>`,
      ]
        .filter(Boolean)
        .join('\n');
    })
    .join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">\n  <title>${escapeXml(name)}</title>\n${items}\n</svg>\n`;
}

export function exportHarmony(name: string, swatches: Swatch[], format: 'css' | 'json' | 'svg'): string {
  const slug = slugify(name);
  if (format === 'css') return `:root {\n${swatches.map((s, i) => `  --color-${slug}-${i + 1}: ${s.hex};`).join('\n')}\n}\n`;
  if (format === 'json') return `${JSON.stringify({ [slug]: swatches.map((s) => s.hex) }, null, 2)}\n`;
  return scaleSvg(name, swatches);
}
