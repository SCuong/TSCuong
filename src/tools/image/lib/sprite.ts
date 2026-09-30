/** Sprite sheet layout (grid and packed) plus CSS/JSON output. Pure functions. */

export interface SpriteInput {
  name: string;
  width: number;
  height: number;
}

export interface Placed extends SpriteInput {
  x: number;
  y: number;
}

export interface SpriteLayout {
  width: number;
  height: number;
  items: Placed[];
}

/** Uniform grid: every cell is as large as the largest image; images are centered in their cell. */
export function gridLayout(inputs: SpriteInput[], columns: number, padding: number): SpriteLayout {
  if (inputs.length === 0) return { width: 0, height: 0, items: [] };
  const cols = Math.max(1, Math.min(Math.floor(columns) || 1, inputs.length));
  const rows = Math.ceil(inputs.length / cols);
  const cw = Math.max(...inputs.map((i) => i.width));
  const ch = Math.max(...inputs.map((i) => i.height));
  const pad = Math.max(0, Math.floor(padding));
  const items = inputs.map((it, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      ...it,
      x: pad + col * (cw + pad) + Math.floor((cw - it.width) / 2),
      y: pad + row * (ch + pad) + Math.floor((ch - it.height) / 2),
    };
  });
  return { width: pad + cols * (cw + pad), height: pad + rows * (ch + pad), items };
}

/**
 * Shelf packing: sort by height, fill rows up to a target width chosen from the
 * total area. Keeps input order in `items`.
 */
export function packLayout(inputs: SpriteInput[], padding: number): SpriteLayout {
  if (inputs.length === 0) return { width: 0, height: 0, items: [] };
  const pad = Math.max(0, Math.floor(padding));
  const area = inputs.reduce((n, i) => n + (i.width + pad) * (i.height + pad), 0);
  const widest = Math.max(...inputs.map((i) => i.width));
  const targetWidth = Math.max(widest + 2 * pad, Math.ceil(Math.sqrt(area) * 1.15));
  const order = inputs.map((_, i) => i).sort((a, b) => inputs[b].height - inputs[a].height || inputs[b].width - inputs[a].width);
  const placed: Placed[] = new Array(inputs.length);
  let x = pad;
  let y = pad;
  let shelf = 0;
  let maxX = 0;
  for (const idx of order) {
    const it = inputs[idx];
    if (x + it.width + pad > targetWidth && x > pad) {
      y += shelf + pad;
      x = pad;
      shelf = 0;
    }
    placed[idx] = { ...it, x, y };
    x += it.width + pad;
    shelf = Math.max(shelf, it.height);
    maxX = Math.max(maxX, x);
  }
  return { width: maxX, height: y + shelf + pad, items: placed };
}

/** A safe, unique CSS class suffix from a file name. */
export function classNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const base =
      n
        .replace(/\.[^.]+$/, '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/^(\d)/, 'i$1') || 'sprite';
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count ? `${base}-${count + 1}` : base;
  });
}

/** A safe sheet file name that always ends in .png (used for the download, the ZIP, the CSS and the JSON). */
export function sheetFileName(name: string): string {
  const base =
    Array.from(name.trim(), (c) => (c.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(c) ? '-' : c))
      .join('')
      .replace(/-{2,}/g, '-')
      .replace(/^\.+/, '') || 'sprite';
  return /\.png$/i.test(base) ? base : `${base.replace(/\.+$/, '') || 'sprite'}.png`;
}

export function spriteCss(layout: SpriteLayout, prefix: string, sheetUrl: string): string {
  const p = prefix.trim().replace(/[^a-zA-Z0-9_-]/g, '') || 'sprite';
  const names = classNames(layout.items.map((i) => i.name));
  const url = sheetUrl.replace(/["\\]/g, '\\$&').replace(/[\n\r]/g, '');
  const lines = [
    `.${p} {`,
    `  display: inline-block;`,
    `  background-image: url("${url}");`,
    `  background-repeat: no-repeat;`,
    `}`,
    '',
  ];
  layout.items.forEach((it, i) => {
    lines.push(
      `.${p}-${names[i]} {`,
      `  width: ${it.width}px;`,
      `  height: ${it.height}px;`,
      `  background-position: ${it.x ? `-${it.x}px` : '0'} ${it.y ? `-${it.y}px` : '0'};`,
      `}`,
    );
  });
  return lines.join('\n') + '\n';
}

export function spriteJson(layout: SpriteLayout, sheetName: string): string {
  const names = classNames(layout.items.map((i) => i.name));
  const frames: Record<string, { frame: { x: number; y: number; w: number; h: number }; source: string }> = {};
  layout.items.forEach((it, i) => {
    frames[names[i]] = { frame: { x: it.x, y: it.y, w: it.width, h: it.height }, source: it.name };
  });
  return JSON.stringify({ frames, meta: { image: sheetName, size: { w: layout.width, h: layout.height }, format: 'RGBA8888' } }, null, 2);
}

/** True when no two placed rectangles overlap (used by tests). */
export function hasOverlap(items: Placed[]): boolean {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) return true;
    }
  }
  return false;
}
