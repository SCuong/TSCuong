/** Favicon/ICO rendering helpers (main thread or worker). */
import { canvasToBlob, createCanvas, getContext, sourceSize, type AnyCanvas, type Drawable } from './canvas';
import { encodeIco } from './encoders';
import { containDestRect } from './geometry';
import { resample } from './pipeline';

export interface SquareOptions {
  /** Fraction of the size left as padding on each side (0–0.4). */
  padding?: number;
  background?: string | null;
  /** Corner radius as a fraction of the size (0–0.5), applied to the background. */
  radius?: number;
}

/** Render `src` into a size×size square, contained and centered. */
export function renderSquare(src: Drawable, size: number, { padding = 0, background = null, radius = 0 }: SquareOptions = {}): AnyCanvas {
  const c = createCanvas(size, size);
  const ctx = getContext(c);
  if (background) {
    ctx.fillStyle = background;
    const r = Math.min(0.5, Math.max(0, radius)) * size;
    if (r > 0) {
      ctx.beginPath();
      ctx.roundRect(0, 0, size, size, r);
      ctx.fill();
    } else ctx.fillRect(0, 0, size, size);
  }
  const inner = Math.max(1, Math.round(size * (1 - 2 * Math.min(0.4, Math.max(0, padding)))));
  const s = sourceSize(src);
  const dest = containDestRect(s, { width: inner, height: inner });
  const w = Math.max(1, Math.round(dest.width));
  const h = Math.max(1, Math.round(dest.height));
  const scaled = w === s.width && h === s.height ? src : resample(src, { width: w, height: h });
  const off = (size - inner) / 2;
  ctx.drawImage(scaled as CanvasImageSource, Math.round(off + dest.x), Math.round(off + dest.y), w, h);
  return c;
}

export async function canvasToPngBytes(c: AnyCanvas): Promise<Uint8Array> {
  return new Uint8Array(await (await canvasToBlob(c, 'image/png')).arrayBuffer());
}

/** Multi-size .ico with PNG entries. */
export async function buildIco(src: Drawable, sizes: number[], opts: SquareOptions = {}): Promise<Blob> {
  const unique = [...new Set(sizes)].filter((s) => s >= 1 && s <= 256).sort((a, b) => a - b);
  const entries = [];
  for (const size of unique) {
    entries.push({ width: size, height: size, png: await canvasToPngBytes(renderSquare(src, size, opts)) });
  }
  return new Blob([encodeIco(entries) as Uint8Array<ArrayBuffer>], { type: 'image/x-icon' });
}

/** Default ICO sizes for a source: 16/32/48 plus larger ones the source can fill. */
export function icoSizesFor(width: number, height: number): number[] {
  const min = Math.min(width, height);
  return [16, 32, 48, 64, 128, 256].filter((s) => s <= 48 || s <= min);
}
