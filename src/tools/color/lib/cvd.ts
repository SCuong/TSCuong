import { converter, differenceEuclidean, formatHex, type Color } from 'culori';

const toRgb = converter('rgb');
const deltaOk = differenceEuclidean('oklab');

export type Matrix3 = [[number, number, number], [number, number, number], [number, number, number]];

export type VisionType = 'normal' | 'protanopia' | 'deuteranopia' | 'tritanopia' | 'achromatopsia';

/**
 * Simulation matrices for dichromacy at severity 1.0 from Machado, Oliveira and
 * Fernandes, "A Physiologically-based Model for Simulation of Color Vision
 * Deficiency" (IEEE TVCG, 2009). They operate on linear-light RGB.
 */
export const MACHADO_2009: Record<'protanopia' | 'deuteranopia' | 'tritanopia', Matrix3> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

export const VISION_TYPES: Array<{ id: VisionType; label: string; description: string; prevalence: string }> = [
  { id: 'normal', label: 'Typical vision', description: 'Trichromatic color vision.', prevalence: '' },
  {
    id: 'protanopia',
    label: 'Protanopia',
    description: 'No functioning long-wavelength (red) cones. Reds look dark and are confused with greens.',
    prevalence: '≈1% of males',
  },
  {
    id: 'deuteranopia',
    label: 'Deuteranopia',
    description: 'No functioning medium-wavelength (green) cones. Red and green are confused.',
    prevalence: '≈1% of males',
  },
  {
    id: 'tritanopia',
    label: 'Tritanopia',
    description: 'No functioning short-wavelength (blue) cones. Blue/green and yellow/violet are confused.',
    prevalence: '<0.01% of people',
  },
  {
    id: 'achromatopsia',
    label: 'Achromatopsia',
    description: 'No color vision; only lightness is perceived.',
    prevalence: '≈0.003% of people',
  },
];

export function srgbToLinear(v: number): number {
  const c = Math.min(1, Math.max(0, v));
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function linearToSrgb(v: number): number {
  const c = Math.min(1, Math.max(0, v));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

/** Simulates a vision type for one color. Returns an sRGB hex string. */
export function simulate(color: Color, type: VisionType): string {
  const rgb = toRgb(color);
  const lin = [srgbToLinear(rgb.r), srgbToLinear(rgb.g), srgbToLinear(rgb.b)];
  let out: number[];
  if (type === 'normal') out = lin;
  else if (type === 'achromatopsia') {
    const y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
    out = [y, y, y];
  } else {
    const m = MACHADO_2009[type];
    out = m.map((row) => row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2]);
  }
  return formatHex({ mode: 'rgb', r: linearToSrgb(out[0]), g: linearToSrgb(out[1]), b: linearToSrgb(out[2]) });
}

export interface ConfusablePair {
  a: number;
  b: number;
  /** OKLab distance under the simulation. */
  distance: number;
  /** OKLab distance with typical vision. */
  normalDistance: number;
}

/** Threshold (OKLab Euclidean distance) below which two colors are hard to tell apart. */
export const CONFUSION_THRESHOLD = 0.05;

/** Pairs that are distinct for typical vision but hard to distinguish under `type`. */
export function confusablePairs(colors: Color[], type: VisionType, threshold = CONFUSION_THRESHOLD): ConfusablePair[] {
  if (type === 'normal') return [];
  const sims = colors.map((c) => simulate(c, type));
  const pairs: ConfusablePair[] = [];
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      const normalDistance = deltaOk(toRgb(colors[i]), toRgb(colors[j]));
      if (normalDistance < threshold) continue;
      const distance = deltaOk(sims[i], sims[j]);
      if (distance < threshold) pairs.push({ a: i, b: j, distance, normalDistance });
    }
  }
  return pairs.sort((x, y) => x.distance - y.distance);
}

/** Extracts colors from free text: hex codes, CSS color functions and names, separated by commas, spaces or new lines. */
export function extractColorTokens(text: string): string[] {
  const tokens: string[] = [];
  const re = /#[0-9a-f]{3,8}\b|(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)|\b[a-z]{3,}\b/gi;
  for (const m of text.matchAll(re)) tokens.push(m[0]);
  return tokens;
}
