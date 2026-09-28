export interface GradientStop {
  id: string;
  /** #rrggbb */
  color: string;
  /** 0–1 */
  alpha: number;
  /** 0–100 */
  position: number;
}

export type GradientType = 'linear' | 'radial' | 'conic';
export type RadialShape = 'circle' | 'ellipse';
export type RadialSize = 'farthest-corner' | 'closest-side' | 'closest-corner' | 'farthest-side';

export interface Gradient {
  type: GradientType;
  /** Linear direction or conic start angle, in degrees. */
  angle: number;
  shape: RadialShape;
  size: RadialSize;
  /** Center for radial/conic, in %. */
  x: number;
  y: number;
  repeating: boolean;
  stops: GradientStop[];
}

const round = (n: number, d = 1) => {
  const r = Number(n.toFixed(d));
  return Object.is(r, -0) ? 0 : r;
};

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const n = parseInt(h.slice(0, 6), 16);
  if (!/^[0-9a-f]{6}$/i.test(h.slice(0, 6)) || Number.isNaN(n)) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A CSS color for a stop: hex when opaque, rgb() with alpha otherwise. */
export function stopColor(stop: Pick<GradientStop, 'color' | 'alpha'>): string {
  const a = Math.min(1, Math.max(0, stop.alpha));
  if (a >= 1) return stop.color.toLowerCase();
  const [r, g, b] = hexToRgb(stop.color);
  return `rgb(${r} ${g} ${b} / ${round(a, 2)})`;
}

export function sortStops(stops: GradientStop[]): GradientStop[] {
  return [...stops].sort((a, b) => a.position - b.position);
}

export function normalizeAngle(a: number): number {
  return ((Math.round(a) % 360) + 360) % 360;
}

/** The CSS <image> value, e.g. `linear-gradient(90deg, #f00 0%, #00f 100%)`. */
export function gradientCss(g: Gradient): string {
  const stops = sortStops(g.stops)
    .map((s) => `${stopColor(s)} ${round(Math.min(100, Math.max(0, s.position)))}%`)
    .join(', ');
  const prefix = g.repeating ? 'repeating-' : '';
  const at = `at ${round(g.x)}% ${round(g.y)}%`;
  if (g.type === 'linear') return `${prefix}linear-gradient(${normalizeAngle(g.angle)}deg, ${stops})`;
  if (g.type === 'radial') {
    const parts = [g.shape === 'ellipse' ? '' : 'circle', g.size === 'farthest-corner' ? '' : g.size, g.x === 50 && g.y === 50 ? '' : at]
      .filter(Boolean)
      .join(' ');
    return `${prefix}radial-gradient(${parts ? `${parts}, ` : ''}${stops})`;
  }
  const from = normalizeAngle(g.angle) === 0 ? '' : `from ${normalizeAngle(g.angle)}deg`;
  const conicAt = g.x === 50 && g.y === 50 ? '' : at;
  const head = [from, conicAt].filter(Boolean).join(' ');
  return `${prefix}conic-gradient(${head ? `${head}, ` : ''}${stops})`;
}

/** A full CSS declaration block with a solid fallback. */
export function gradientDeclaration(g: Gradient): string {
  const first = sortStops(g.stops)[0];
  const fallback = first ? stopColor({ ...first, alpha: 1 }) : '#000000';
  return `background-color: ${fallback};\nbackground-image: ${gradientCss(g)};`;
}

/** Interpolated color (hex) at a position between stops, for inserting a new stop. */
export function colorAt(stops: GradientStop[], position: number): { color: string; alpha: number } {
  const sorted = sortStops(stops);
  if (sorted.length === 0) return { color: '#000000', alpha: 1 };
  if (position <= sorted[0].position) return { color: sorted[0].color, alpha: sorted[0].alpha };
  const last = sorted[sorted.length - 1];
  if (position >= last.position) return { color: last.color, alpha: last.alpha };
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (position >= a.position && position <= b.position) {
      const t = b.position === a.position ? 0 : (position - a.position) / (b.position - a.position);
      const ca = hexToRgb(a.color);
      const cb = hexToRgb(b.color);
      const mix = ca.map((v, k) => Math.round(v + (cb[k] - v) * t));
      return { color: `#${mix.map((v) => v.toString(16).padStart(2, '0')).join('')}`, alpha: round(a.alpha + (b.alpha - a.alpha) * t, 2) };
    }
  }
  return { color: last.color, alpha: last.alpha };
}

let counter = 0;
export function stopId(): string {
  counter += 1;
  return `s${Date.now().toString(36)}${counter}`;
}

const s = (color: string, position: number, alpha = 1): GradientStop => ({ id: `p-${color}-${position}`, color, alpha, position });
const base = { angle: 90, shape: 'ellipse' as const, size: 'farthest-corner' as const, x: 50, y: 50, repeating: false };

export const GRADIENT_PRESETS: Array<{ name: string; gradient: Gradient }> = [
  { name: 'Ocean', gradient: { ...base, type: 'linear', angle: 135, stops: [s('#0ea5e9', 0), s('#6366f1', 100)] } },
  { name: 'Sunset', gradient: { ...base, type: 'linear', angle: 120, stops: [s('#f97316', 0), s('#ec4899', 55), s('#8b5cf6', 100)] } },
  { name: 'Mint', gradient: { ...base, type: 'linear', angle: 160, stops: [s('#d9f99d', 0), s('#34d399', 100)] } },
  { name: 'Night', gradient: { ...base, type: 'linear', angle: 180, stops: [s('#0f172a', 0), s('#1e3a8a', 100)] } },
  { name: 'Peach', gradient: { ...base, type: 'linear', angle: 45, stops: [s('#fed7aa', 0), s('#fda4af', 100)] } },
  { name: 'Aurora', gradient: { ...base, type: 'linear', angle: 100, stops: [s('#22d3ee', 0), s('#a3e635', 50), s('#e879f9', 100)] } },
  { name: 'Spotlight', gradient: { ...base, type: 'radial', shape: 'circle', stops: [s('#fef08a', 0), s('#f59e0b', 45), s('#7c2d12', 100)] } },
  { name: 'Glow', gradient: { ...base, type: 'radial', y: 0, stops: [s('#818cf8', 0, 0.9), s('#0f172a', 70)] } },
  { name: 'Color wheel', gradient: { ...base, type: 'conic', angle: 0, stops: [s('#ff0000', 0), s('#ffff00', 16.7), s('#00ff00', 33.3), s('#00ffff', 50), s('#0000ff', 66.7), s('#ff00ff', 83.3), s('#ff0000', 100)] } },
  { name: 'Pie', gradient: { ...base, type: 'conic', angle: 0, stops: [s('#6366f1', 0), s('#6366f1', 40), s('#f43f5e', 40), s('#f43f5e', 75), s('#facc15', 75), s('#facc15', 100)] } },
  { name: 'Stripes', gradient: { ...base, type: 'linear', angle: 45, repeating: true, stops: [s('#e2e8f0', 0), s('#e2e8f0', 5), s('#cbd5e1', 5), s('#cbd5e1', 10)] } },
  { name: 'Fade', gradient: { ...base, type: 'linear', angle: 180, stops: [s('#000000', 0, 0), s('#000000', 100, 0.8)] } },
];
