import {
  colorsNamed,
  converter,
  differenceEuclidean,
  displayable,
  formatHex,
  formatHex8,
  parse,
  toGamut,
  type Color,
  type Rgb,
} from 'culori';

export const toRgb = converter('rgb');
const toHsl = converter('hsl');
const toHwb = converter('hwb');
const toLab = converter('lab');
const toLch = converter('lch');
const toOklab = converter('oklab');
const toOklch = converter('oklch');
const mapToSrgb = toGamut('rgb', 'oklch');
const deltaOk = differenceEuclidean('oklab');

export type FormatId = 'hex' | 'hex8' | 'rgb' | 'rgbLegacy' | 'hsl' | 'hwb' | 'lab' | 'lch' | 'oklab' | 'oklch' | 'cmyk';

export const FORMATS: Array<{ id: FormatId; label: string; hint?: string }> = [
  { id: 'hex', label: 'HEX' },
  { id: 'hex8', label: 'HEX8', hint: 'With alpha' },
  { id: 'rgb', label: 'RGB' },
  { id: 'rgbLegacy', label: 'RGBA (legacy)', hint: 'Comma syntax for older tools' },
  { id: 'hsl', label: 'HSL' },
  { id: 'hwb', label: 'HWB' },
  { id: 'lab', label: 'LAB', hint: 'CIE Lab (D50)' },
  { id: 'lch', label: 'LCH', hint: 'CIE LCh (D50)' },
  { id: 'oklab', label: 'OKLAB' },
  { id: 'oklch', label: 'OKLCH' },
  { id: 'cmyk', label: 'CMYK', hint: 'Naive conversion without an ICC profile' },
];

export class ColorError extends Error {
  override name = 'ColorError';
}

/** Rounds and strips trailing zeros. */
export function num(value: number | undefined, digits: number): string {
  const v = value === undefined || Number.isNaN(value) ? 0 : value;
  const r = Number(v.toFixed(digits));
  return String(Object.is(r, -0) ? 0 : r);
}

const alphaOf = (c: Color): number => (c.alpha === undefined ? 1 : c.alpha);
const alphaSuffix = (c: Color): string => (alphaOf(c) < 1 ? ` / ${num(alphaOf(c), 3)}` : '');
const hue = (h: number | undefined): string => num(h === undefined || Number.isNaN(h) ? 0 : ((h % 360) + 360) % 360, 2);

/** Naive CMYK from sRGB (no ICC profile), each component 0–1. */
export function rgbToCmyk(r: number, g: number, b: number): { c: number; m: number; y: number; k: number } {
  const k = 1 - Math.max(r, g, b);
  if (k >= 1) return { c: 0, m: 0, y: 0, k: 1 };
  return { c: (1 - r - k) / (1 - k), m: (1 - g - k) / (1 - k), y: (1 - b - k) / (1 - k), k };
}

export function cmykToRgb(c: number, m: number, y: number, k: number): { r: number; g: number; b: number } {
  return { r: (1 - c) * (1 - k), g: (1 - m) * (1 - k), b: (1 - y) * (1 - k) };
}

/** Parses "cmyk(0% 100% 100% 0%)", "device-cmyk(0 1 1 0)", "0, 100, 100, 0" (percent). */
export function parseCmyk(text: string): Rgb | null {
  const s = text.trim().toLowerCase();
  const m = /^(?:(?:device-)?cmyk\s*\()?\s*([^)]*?)\s*\)?$/.exec(s);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  if (parts.length !== 4) return null;
  const values: number[] = [];
  for (const p of parts) {
    const pm = /^(-?\d*\.?\d+)(%?)$/.exec(p);
    if (!pm) return null;
    let v = Number(pm[1]);
    // Percent sign, or bare numbers above 1, are percentages.
    if (pm[2] || parts.some((x) => !x.endsWith('%') && Number(x) > 1)) v /= 100;
    if (v < 0 || v > 1) return null;
    values.push(v);
  }
  const { r, g, b } = cmykToRgb(values[0], values[1], values[2], values[3]);
  return { mode: 'rgb', r, g, b };
}

const unit = (v: number | undefined) => (v === undefined || Number.isNaN(v) ? v : Math.min(1, Math.max(0, v)));

/**
 * CSS clamps the channels of the legacy sRGB functions when it parses them (CSS Color 4): `rgb(300 0 0)`
 * is plain red and `hsl(0 150% 50%)` is `hsl(0 100% 50%)`. `color(srgb …)` is not clamped (it may be out of gamut).
 */
function clampLegacy(text: string, c: Color): Color {
  const alpha = c.alpha === undefined ? {} : { alpha: unit(c.alpha) };
  if (c.mode === 'rgb' && /^rgba?\(/i.test(text)) return { ...c, r: unit(c.r)!, g: unit(c.g)!, b: unit(c.b)!, ...alpha };
  if (c.mode === 'hsl' && /^hsla?\(/i.test(text)) return { ...c, s: unit(c.s)!, l: unit(c.l)!, ...alpha };
  if (c.mode === 'hwb' && /^hwb\(/i.test(text)) return { ...c, w: unit(c.w)!, b: unit(c.b)!, ...alpha };
  return { ...c, ...alpha } as Color;
}

/** Parses any CSS color (plus CMYK) or throws a ColorError. */
export function parseAny(text: string): Color {
  const s = text.trim();
  if (!s) throw new ColorError('Enter a color.');
  let c: Color | undefined;
  if (/^[0-9a-f]{3,4}$|^[0-9a-f]{6}$|^[0-9a-f]{8}$/i.test(s)) c = parse(`#${s}`);
  else if (/^(device-)?cmyk/i.test(s)) c = parseCmyk(s) ?? undefined;
  else c = parse(s);
  if (!c) throw new ColorError(`“${s.length > 40 ? `${s.slice(0, 40)}…` : s}” is not a color this tool understands.`);
  return clampLegacy(s, c);
}

/** The sRGB color used for hex/rgb output (gamut-mapped in OKLCH when needed). */
export function srgbOf(color: Color): Rgb {
  const rgb = toRgb(color);
  // Values that only miss the gamut by rounding noise (less than half an 8-bit step) are clipped, not mapped.
  const tolerance = 0.5 / 255;
  const nearlyInGamut = [rgb.r, rgb.g, rgb.b].every((v) => v >= -tolerance && v <= 1 + tolerance);
  if (displayable(rgb) || nearlyInGamut) {
    return {
      mode: 'rgb',
      r: Math.min(1, Math.max(0, rgb.r)),
      g: Math.min(1, Math.max(0, rgb.g)),
      b: Math.min(1, Math.max(0, rgb.b)),
      ...(rgb.alpha !== undefined ? { alpha: rgb.alpha } : {}),
    };
  }
  const mapped = toRgb(mapToSrgb(color));
  return {
    mode: 'rgb',
    r: Math.min(1, Math.max(0, mapped.r)),
    g: Math.min(1, Math.max(0, mapped.g)),
    b: Math.min(1, Math.max(0, mapped.b)),
    ...(rgb.alpha !== undefined ? { alpha: rgb.alpha } : {}),
  };
}

/** Whether the color fits in sRGB (ignoring rounding noise smaller than half an 8-bit step). */
export function inSrgb(color: Color): boolean {
  const rgb = toRgb(color);
  const tolerance = 0.5 / 255;
  return [rgb.r, rgb.g, rgb.b].every((v) => v >= -tolerance && v <= 1 + tolerance);
}

export function formatColor(color: Color, id: FormatId): string {
  const srgb = srgbOf(color);
  switch (id) {
    case 'hex':
      return formatHex(srgb);
    case 'hex8':
      return formatHex8({ ...srgb, alpha: alphaOf(color) });
    case 'rgb': {
      const [r, g, b] = [srgb.r, srgb.g, srgb.b].map((v) => Math.round(v * 255));
      return `rgb(${r} ${g} ${b}${alphaSuffix(color)})`;
    }
    case 'rgbLegacy': {
      const [r, g, b] = [srgb.r, srgb.g, srgb.b].map((v) => Math.round(v * 255));
      return alphaOf(color) < 1 ? `rgba(${r}, ${g}, ${b}, ${num(alphaOf(color), 3)})` : `rgb(${r}, ${g}, ${b})`;
    }
    case 'hsl': {
      const c = toHsl(srgb);
      return `hsl(${hue(c.h)} ${num((c.s ?? 0) * 100, 1)}% ${num(c.l * 100, 1)}%${alphaSuffix(color)})`;
    }
    case 'hwb': {
      const c = toHwb(srgb);
      return `hwb(${hue(c.h)} ${num(c.w * 100, 1)}% ${num(c.b * 100, 1)}%${alphaSuffix(color)})`;
    }
    case 'lab': {
      const c = toLab(color);
      return `lab(${num(c.l, 2)}% ${num(c.a, 2)} ${num(c.b, 2)}${alphaSuffix(color)})`;
    }
    case 'lch': {
      const c = toLch(color);
      return `lch(${num(c.l, 2)}% ${num(c.c, 2)} ${hue(c.h)}${alphaSuffix(color)})`;
    }
    case 'oklab': {
      const c = toOklab(color);
      return `oklab(${num(c.l * 100, 2)}% ${num(c.a, 4)} ${num(c.b, 4)}${alphaSuffix(color)})`;
    }
    case 'oklch': {
      const c = toOklch(color);
      return `oklch(${num(c.l * 100, 2)}% ${num(c.c, 4)} ${hue(c.h)}${alphaSuffix(color)})`;
    }
    case 'cmyk': {
      const { c, m, y, k } = rgbToCmyk(srgb.r, srgb.g, srgb.b);
      return `cmyk(${num(c * 100, 1)}% ${num(m * 100, 1)}% ${num(y * 100, 1)}% ${num(k * 100, 1)}%)`;
    }
  }
}

let namedCache: Array<{ name: string; color: Color }> | null = null;
function namedList() {
  if (!namedCache) {
    namedCache = Object.entries(colorsNamed).map(([name, value]) => ({
      name,
      color: { mode: 'rgb', r: ((value >> 16) & 255) / 255, g: ((value >> 8) & 255) / 255, b: (value & 255) / 255 } as Color,
    }));
  }
  return namedCache;
}

export interface NamedMatch {
  name: string;
  exact: boolean;
  /** OKLab Euclidean distance (0 = identical). */
  distance: number;
  hex: string;
}

/** The exact CSS named color, or the closest one by OKLab distance. */
export function nearestNamed(color: Color): NamedMatch {
  const srgb = srgbOf(color);
  const hex = formatHex(srgb);
  let best: NamedMatch | null = null;
  for (const { name, color: c } of namedList()) {
    const h = formatHex(c);
    if (h === hex) {
      // Prefer the most common spelling (e.g. "gray" over "grey", "aqua" over "cyan").
      const exact = { name, exact: true, distance: 0, hex: h };
      if (!best || !best.exact) best = exact;
      continue;
    }
    if (best?.exact) continue;
    const d = deltaOk(srgb, c);
    if (!best || d < best.distance) best = { name, exact: false, distance: d, hex: h };
  }
  return best!;
}

export function alphaValue(color: Color): number {
  return alphaOf(color);
}

export function withAlpha(color: Color, alpha: number): Color {
  return { ...color, alpha: Math.min(1, Math.max(0, alpha)) };
}

/** A string safe to use as a CSS color for previews (sRGB, with alpha). */
export function cssColor(color: Color): string {
  return formatColor(color, alphaOf(color) < 1 ? 'hex8' : 'hex');
}

/** Picks black or white text for a background, by WCAG contrast. */
export function readableTextOn(color: Color): '#000000' | '#ffffff' {
  const { r, g, b } = srgbOf(color);
  const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? '#000000' : '#ffffff';
}
