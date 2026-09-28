/**
 * The shared image processing pipeline: decode → crop → resize → rotate/flip
 * → filters → flatten → encode. Runs unchanged in a Web Worker
 * (OffscreenCanvas) or on the main thread.
 */
import {
  checkDimensions,
  createCanvas,
  decodeImage,
  encodeCanvas,
  fillBackground,
  getContext,
  keepFormat,
  OUTPUT_INFO,
  sourceSize,
  type AnyCanvas,
  type Drawable,
  type OutputFormat,
} from './canvas';
import { computeResize, fitMaxDimension, rotatedBounds, type Rect, type ResizeSpec, type Size } from './geometry';
import { applyFiltersToPixels, filterString, isIdentity, supportsCanvasFilter, type FilterSettings } from './filters';
import type { ImageFormat } from './formats';

export interface ImageJob {
  crop?: Rect & { circle?: boolean };
  resize?: ResizeSpec;
  /** Limit the longest side (no upscaling). */
  maxDimension?: number | null;
  /** Degrees clockwise. */
  rotate?: number;
  /** Fill for the corners exposed by non-right-angle rotation; null = transparent. */
  rotateFill?: string | null;
  flipH?: boolean;
  flipV?: boolean;
  filters?: FilterSettings;
  output: {
    format: OutputFormat | 'keep';
    quality?: number;
    /** Used to flatten transparency for formats without alpha (and when `flatten` is set). */
    background?: string;
    flatten?: boolean;
  };
}

export interface JobResult {
  blob: Blob;
  width: number;
  height: number;
  format: OutputFormat;
  sourceFormat: ImageFormat;
  sourceWidth: number;
  sourceHeight: number;
}

/** High-quality resampling: halve repeatedly (box-like), then a final smooth draw. */
export function resample(src: Drawable, target: Size): AnyCanvas {
  let current: Drawable = src;
  let { width: cw, height: ch } = sourceSize(src);
  while (cw / 2 >= target.width && ch / 2 >= target.height && cw > 2 && ch > 2) {
    const nw = Math.max(target.width, Math.floor(cw / 2));
    const nh = Math.max(target.height, Math.floor(ch / 2));
    const step = createCanvas(nw, nh);
    const sctx = getContext(step);
    sctx.imageSmoothingEnabled = true;
    sctx.imageSmoothingQuality = 'high';
    sctx.drawImage(current as CanvasImageSource, 0, 0, cw, ch, 0, 0, nw, nh);
    current = step;
    cw = nw;
    ch = nh;
  }
  const out = createCanvas(target.width, target.height);
  const ctx = getContext(out);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(current as CanvasImageSource, 0, 0, cw, ch, 0, 0, target.width, target.height);
  return out;
}

function toCanvas(src: Drawable): AnyCanvas {
  const { width, height } = sourceSize(src);
  const c = createCanvas(width, height);
  getContext(c).drawImage(src as CanvasImageSource, 0, 0);
  return c;
}

/** Rotate by any angle (expanding the canvas) and/or flip. */
export function rotateFlip(src: Drawable, degrees: number, flipH = false, flipV = false, fill: string | null = null): AnyCanvas {
  const size = sourceSize(src);
  const norm = ((degrees % 360) + 360) % 360;
  const bounds = rotatedBounds(size, norm);
  const out = createCanvas(bounds.width, bounds.height);
  const ctx = getContext(out);
  if (fill && norm % 90 !== 0) {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, bounds.width, bounds.height);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.translate(bounds.width / 2, bounds.height / 2);
  ctx.rotate((norm * Math.PI) / 180);
  ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);
  ctx.drawImage(src as CanvasImageSource, -size.width / 2, -size.height / 2);
  return out;
}

export function applyFilters(src: AnyCanvas, filters: FilterSettings): AnyCanvas {
  if (isIdentity(filters)) return src;
  const out = createCanvas(src.width, src.height);
  const ctx = getContext(out, { willReadFrequently: true });
  if (supportsCanvasFilter()) {
    ctx.filter = filterString(filters);
    ctx.drawImage(src, 0, 0);
    ctx.filter = 'none';
  } else {
    ctx.drawImage(src, 0, 0);
    const data = ctx.getImageData(0, 0, out.width, out.height);
    applyFiltersToPixels(data.data, out.width, out.height, filters);
    ctx.putImageData(data, 0, 0);
  }
  return out;
}

/** Run a job against an already-decoded source. */
export async function runJobOnSource(
  source: Drawable,
  sourceFormat: ImageFormat,
  job: ImageJob,
): Promise<Omit<JobResult, 'sourceFormat' | 'sourceWidth' | 'sourceHeight'>> {
  let current: Drawable = source;
  let size = sourceSize(source);

  if (job.crop) {
    const { x, y, width, height, circle } = job.crop;
    checkDimensions(width, height);
    const c = createCanvas(width, height);
    const ctx = getContext(c);
    if (circle) {
      ctx.beginPath();
      ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
    }
    ctx.drawImage(current as CanvasImageSource, x, y, width, height, 0, 0, width, height);
    current = c;
    size = { width, height };
  }

  let target = job.resize ? computeResize(size, job.resize) : size;
  target = fitMaxDimension(target, job.maxDimension);
  if (target.width !== size.width || target.height !== size.height) {
    current = resample(current, target);
  }

  const angle = job.rotate ?? 0;
  if (angle % 360 !== 0 || job.flipH || job.flipV) {
    current = rotateFlip(current, angle, job.flipH, job.flipV, job.rotateFill ?? null);
  }

  let canvas = current === source ? toCanvas(current) : (current as AnyCanvas);
  if (job.filters) canvas = applyFilters(canvas, job.filters);

  const format = job.output.format === 'keep' ? keepFormat(sourceFormat) : job.output.format;
  if (!OUTPUT_INFO[format].alpha || job.output.flatten) {
    const ctx = getContext(canvas);
    fillBackground(ctx, canvas.width, canvas.height, job.output.background ?? '#ffffff');
  }
  const blob = await encodeCanvas(canvas, { format, quality: job.output.quality });
  return { blob, width: canvas.width, height: canvas.height, format };
}

/** Decode a file and run the job. */
export async function processImage(file: Blob, job: ImageJob): Promise<JobResult> {
  const decoded = await decodeImage(file);
  try {
    const result = await runJobOnSource(decoded.bitmap, decoded.header.format, job);
    return { ...result, sourceFormat: decoded.header.format, sourceWidth: decoded.width, sourceHeight: decoded.height };
  } finally {
    decoded.bitmap.close();
  }
}
