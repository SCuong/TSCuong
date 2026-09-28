import { converter, formatHex, formatHex8, parse, toGamut, type Color, type Rgb } from 'culori';

const toRgb = converter('rgb');
const toOklch = converter('oklch');
const mapToSrgb = toGamut('rgb', 'oklch');

function channel(v: number): number {
  const c = Math.min(1, Math.max(0, v));
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance of an sRGB color (alpha ignored). */
export function relativeLuminance(color: Color): number {
  const { r, g, b } = toRgb(color);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Alpha-composites `top` over an opaque `bottom` in sRGB (as browsers do). */
export function composite(top: Color, bottom: Color): Rgb {
  const t = toRgb(top);
  const b = toRgb(bottom);
  const a = t.alpha ?? 1;
  return { mode: 'rgb', r: t.r * a + b.r * (1 - a), g: t.g * a + b.g * (1 - a), b: t.b * a + b.b * (1 - a) };
}

const WHITE: Rgb = { mode: 'rgb', r: 1, g: 1, b: 1 };

/**
 * Contrast ratio between text and background, 1–21. A translucent background is
 * first placed on white; translucent text is composited over the background.
 * The ratio is not rounded (WCAG compares the exact value).
 */
export function contrastRatio(fg: Color, bg: Color): number {
  const solidBg = (toRgb(bg).alpha ?? 1) < 1 ? composite(bg, WHITE) : toRgb(bg);
  const solidFg = composite(fg, solidBg);
  const l1 = relativeLuminance(solidFg);
  const l2 = relativeLuminance(solidBg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Display rounding that never rounds a failing ratio up to a passing one. */
export function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;
}

export interface Criterion {
  id: 'aa-normal' | 'aa-large' | 'aaa-normal' | 'aaa-large' | 'ui';
  label: string;
  level: 'AA' | 'AAA';
  min: number;
  detail: string;
}

export const CRITERIA: Criterion[] = [
  { id: 'aa-normal', label: 'Normal text', level: 'AA', min: 4.5, detail: 'SC 1.4.3 · below 18pt (24px), or below 14pt (18.66px) bold' },
  { id: 'aa-large', label: 'Large text', level: 'AA', min: 3, detail: 'SC 1.4.3 · at least 18pt (24px), or 14pt (18.66px) bold' },
  { id: 'aaa-normal', label: 'Normal text', level: 'AAA', min: 7, detail: 'SC 1.4.6' },
  { id: 'aaa-large', label: 'Large text', level: 'AAA', min: 4.5, detail: 'SC 1.4.6' },
  { id: 'ui', label: 'UI components & graphics', level: 'AA', min: 3, detail: 'SC 1.4.11 · borders, icons, focus rings, chart lines' },
];

export function evaluate(ratio: number): Array<Criterion & { pass: boolean }> {
  return CRITERIA.map((c) => ({ ...c, pass: ratio >= c.min }));
}

export interface Suggestion {
  color: string;
  ratio: number;
  /** Change in OKLCH lightness (0–1 scale). */
  deltaL: number;
}

function withLightness(base: { l: number; c: number; h?: number; alpha?: number }, l: number): Color {
  const mapped = toRgb(mapToSrgb({ mode: 'oklch', l, c: base.c, h: base.h }));
  return {
    mode: 'rgb',
    r: Math.min(1, Math.max(0, mapped.r)),
    g: Math.min(1, Math.max(0, mapped.g)),
    b: Math.min(1, Math.max(0, mapped.b)),
    ...(base.alpha !== undefined && base.alpha < 1 ? { alpha: base.alpha } : {}),
  };
}

/**
 * Finds the color closest to `adjust` (by OKLCH lightness, keeping hue and as much
 * chroma as the sRGB gamut allows) whose contrast against `fixed` reaches `target`.
 * Returns null when neither lightening nor darkening can reach it.
 */
export function suggestPassing(adjust: Color, fixed: Color, target: number, adjustIsForeground = true): Suggestion | null {
  const base = toOklch(adjust);
  const baseForm = { l: base.l, c: base.c ?? 0, h: base.h, alpha: base.alpha };
  const ratioFor = (c: Color) => (adjustIsForeground ? contrastRatio(c, fixed) : contrastRatio(fixed, c));

  const candidates: Suggestion[] = [];
  for (const extreme of [0, 1]) {
    if (ratioFor(withLightness(baseForm, extreme)) < target) continue;
    // Binary search between the original lightness (failing side) and the extreme (passing side).
    let failL = Math.min(1, Math.max(0, base.l));
    let passL = extreme;
    if (ratioFor(withLightness(baseForm, failL)) >= target) {
      passL = failL;
    } else {
      for (let i = 0; i < 40; i++) {
        const mid = (failL + passL) / 2;
        if (ratioFor(withLightness(baseForm, mid)) >= target) passL = mid;
        else failL = mid;
      }
    }
    // Hex rounding can drop the ratio a hair below the target; nudge until the 8-bit color passes.
    let l = passL;
    for (let i = 0; i < 200; i++) {
      const hex = formatHex(withLightness(baseForm, l));
      const solid = parse(hex)!;
      const color = baseForm.alpha !== undefined && baseForm.alpha < 1 ? { ...solid, alpha: baseForm.alpha } : solid;
      const ratio = ratioFor(color);
      if (ratio >= target) {
        candidates.push({ color: color.alpha !== undefined && color.alpha < 1 ? formatHex8(color) : hex, ratio, deltaL: l - base.l });
        break;
      }
      l += extreme === 1 ? 0.001 : -0.001;
      if (l < 0 || l > 1) break;
    }
  }
  if (!candidates.length) return null;
  return candidates.sort((a, b) => Math.abs(a.deltaL) - Math.abs(b.deltaL))[0];
}
