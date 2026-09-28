export interface Corner {
  /** Horizontal radius */
  x: number;
  /** Vertical radius (used when elliptical) */
  y: number;
}

export interface RadiusConfig {
  topLeft: Corner;
  topRight: Corner;
  bottomRight: Corner;
  bottomLeft: Corner;
  unit: 'px' | '%';
  elliptical: boolean;
}

export const CORNER_KEYS = ['topLeft', 'topRight', 'bottomRight', 'bottomLeft'] as const;
export type CornerKey = (typeof CORNER_KEYS)[number];

/** Shortest CSS list for four values in top-left, top-right, bottom-right, bottom-left order. */
export function shorten4(values: string[]): string[] {
  const [a, b, c, d] = values;
  if (b === d) {
    if (a === c) return a === b ? [a] : [a, b];
    return [a, b, c];
  }
  return [a, b, c, d];
}

function fmt(n: number, unit: string): string {
  const r = Math.round(Math.max(0, n) * 100) / 100;
  return r === 0 ? '0' : `${r}${unit}`;
}

/** The border-radius value, using the 8-value "h / v" syntax only when needed. */
export function borderRadiusValue(cfg: RadiusConfig): string {
  const h = CORNER_KEYS.map((k) => fmt(cfg[k].x, cfg.unit));
  const v = CORNER_KEYS.map((k) => fmt(cfg.elliptical ? cfg[k].y : cfg[k].x, cfg.unit));
  const hs = shorten4(h).join(' ');
  const vs = shorten4(v).join(' ');
  return !cfg.elliptical || hs === vs ? hs : `${hs} / ${vs}`;
}

/** Longhand declarations, one per corner. */
export function borderRadiusLonghand(cfg: RadiusConfig): string {
  const names: Record<CornerKey, string> = {
    topLeft: 'border-top-left-radius',
    topRight: 'border-top-right-radius',
    bottomRight: 'border-bottom-right-radius',
    bottomLeft: 'border-bottom-left-radius',
  };
  return CORNER_KEYS.map((k) => {
    const x = fmt(cfg[k].x, cfg.unit);
    const y = fmt(cfg.elliptical ? cfg[k].y : cfg[k].x, cfg.unit);
    return `${names[k]}: ${x === y ? x : `${x} ${y}`};`;
  }).join('\n');
}

const all = (x: number, y = x): Pick<RadiusConfig, CornerKey> => ({
  topLeft: { x, y },
  topRight: { x, y },
  bottomRight: { x, y },
  bottomLeft: { x, y },
});

export const RADIUS_PRESETS: Array<{ name: string; config: RadiusConfig }> = [
  { name: 'Rounded', config: { ...all(12), unit: 'px', elliptical: false } },
  { name: 'Pill', config: { ...all(9999), unit: 'px', elliptical: false } },
  { name: 'Circle', config: { ...all(50), unit: '%', elliptical: false } },
  { name: 'Leaf', config: { topLeft: { x: 0, y: 0 }, topRight: { x: 60, y: 60 }, bottomRight: { x: 0, y: 0 }, bottomLeft: { x: 60, y: 60 }, unit: '%', elliptical: false } },
  { name: 'Tab', config: { topLeft: { x: 16, y: 16 }, topRight: { x: 16, y: 16 }, bottomRight: { x: 0, y: 0 }, bottomLeft: { x: 0, y: 0 }, unit: 'px', elliptical: false } },
  { name: 'Blob', config: { topLeft: { x: 30, y: 30 }, topRight: { x: 70, y: 30 }, bottomRight: { x: 70, y: 70 }, bottomLeft: { x: 30, y: 70 }, unit: '%', elliptical: true } },
  { name: 'Egg', config: { ...all(50, 60), topLeft: { x: 50, y: 60 }, topRight: { x: 50, y: 60 }, bottomRight: { x: 50, y: 40 }, bottomLeft: { x: 50, y: 40 }, unit: '%', elliptical: true } },
  { name: 'Wobbly', config: { topLeft: { x: 63, y: 42 }, topRight: { x: 37, y: 55 }, bottomRight: { x: 58, y: 45 }, bottomLeft: { x: 42, y: 58 }, unit: '%', elliptical: true } },
];
