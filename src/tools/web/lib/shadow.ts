import { hexToRgb } from './gradient';

export interface ShadowLayer {
  id: string;
  x: number;
  y: number;
  blur: number;
  spread: number;
  /** #rrggbb */
  color: string;
  /** 0–1 */
  opacity: number;
  inset: boolean;
  visible: boolean;
}

const px = (n: number) => {
  const r = Math.round(n * 10) / 10;
  return r === 0 ? '0' : `${r}px`;
};

export function layerColor(layer: Pick<ShadowLayer, 'color' | 'opacity'>): string {
  const a = Math.min(1, Math.max(0, layer.opacity));
  const [r, g, b] = hexToRgb(layer.color);
  return a >= 1 ? layer.color.toLowerCase() : `rgb(${r} ${g} ${b} / ${Math.round(a * 100) / 100})`;
}

export function layerCss(layer: ShadowLayer): string {
  const parts = [layer.inset ? 'inset' : '', px(layer.x), px(layer.y), px(Math.max(0, layer.blur)), px(layer.spread), layerColor(layer)];
  return parts.filter(Boolean).join(' ');
}

/** The box-shadow value. Hidden layers are skipped; no layers gives "none". */
export function shadowCss(layers: ShadowLayer[]): string {
  const visible = layers.filter((l) => l.visible);
  return visible.length ? visible.map(layerCss).join(', ') : 'none';
}

let n = 0;
export function layerId(): string {
  n += 1;
  return `l${Date.now().toString(36)}${n}`;
}

const L = (x: number, y: number, blur: number, spread: number, color: string, opacity: number, inset = false): ShadowLayer => ({
  id: `p${x}${y}${blur}${spread}${color}${opacity}${inset}`,
  x,
  y,
  blur,
  spread,
  color,
  opacity,
  inset,
  visible: true,
});

export const SHADOW_PRESETS: Array<{ name: string; layers: ShadowLayer[] }> = [
  { name: 'Subtle', layers: [L(0, 1, 2, 0, '#101828', 0.06), L(0, 1, 3, 0, '#101828', 0.1)] },
  { name: 'Soft', layers: [L(0, 10, 30, -10, '#0f172a', 0.25)] },
  {
    name: 'Layered',
    layers: [L(0, 1, 1, 0, '#000000', 0.08), L(0, 2, 2, 0, '#000000', 0.08), L(0, 4, 4, 0, '#000000', 0.08), L(0, 8, 8, 0, '#000000', 0.08), L(0, 16, 16, 0, '#000000', 0.08)],
  },
  { name: 'Floating', layers: [L(0, 24, 48, -12, '#0f172a', 0.35)] },
  { name: 'Inset', layers: [L(0, 2, 4, 0, '#000000', 0.15, true)] },
  { name: 'Pressed', layers: [L(0, 1, 2, 0, '#000000', 0.2, true), L(0, 0, 0, 1, '#000000', 0.06)] },
  { name: 'Glow', layers: [L(0, 0, 24, 4, '#6366f1', 0.6)] },
  { name: 'Neon', layers: [L(0, 0, 4, 0, '#22d3ee', 1), L(0, 0, 16, 2, '#22d3ee', 0.7), L(0, 0, 40, 8, '#22d3ee', 0.4)] },
  { name: 'Hard', layers: [L(6, 6, 0, 0, '#111827', 1)] },
  { name: 'Outline', layers: [L(0, 0, 0, 2, '#2563eb', 1)] },
];
