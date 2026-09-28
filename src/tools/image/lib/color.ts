/** Small color formatting helpers for the picker tools. */
import { rgbToHex } from './palette';

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
  }
  return [Math.round(h) % 360, Math.round(s * 100), Math.round(l * 100)];
}

export interface ColorFormats {
  hex: string;
  rgb: string;
  hsl: string;
  rgba?: string;
}

export function formatColor(r: number, g: number, b: number, a = 255): ColorFormats {
  const [h, s, l] = rgbToHsl(r, g, b);
  const alpha = Math.round((a / 255) * 1000) / 1000;
  return {
    hex: a < 255 ? `${rgbToHex([r, g, b])}${a.toString(16).padStart(2, '0')}` : rgbToHex([r, g, b]),
    rgb: a < 255 ? `rgb(${r} ${g} ${b} / ${alpha})` : `rgb(${r}, ${g}, ${b})`,
    hsl: a < 255 ? `hsl(${h} ${s}% ${l}% / ${alpha})` : `hsl(${h}, ${s}%, ${l}%)`,
  };
}

/** Relative luminance-based choice of black/white text on a color. */
export function readableTextOn(r: number, g: number, b: number): '#000000' | '#ffffff' {
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  return L > 0.179 ? '#000000' : '#ffffff';
}
