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
import { computeResize, fitMaxDimension, rotateFlipTransform, type Rect, type ResizeSpec, type Size } from './geometry';
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
  /** The source is an animation (GIF, APNG, animated WebP/AVIF): only its first frame was used. */
  sourceAnimated: boolean;
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

/**
 * A downscaled copy of `src`. Uses createImageBitmap's resize options, which
 * browsers run off the main thread (a 144-megapixel photo scales in ~0.1 s
 * without freezing the page); falls back to {@link resample} elsewhere.
 */
export async function scaledBitmap(src: ImageBitmap, width: number, height: number): Promise<ImageBitmap> {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  try {
    const out = await createImageBitmap(src, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high' });
    if (out.width === w && out.height === h) return out;
    out.close();
  } catch {
    // Resize options unsupported: resample on this thread instead.
  }
  return createImageBitmap(resample(src, { width: w, height: h }));
}

function toCanvas(src: Drawable): AnyCanvas {
  const { width, height } = sourceSize(src);
  const c = createCanvas(width, height);
  getContext(c).drawImage(src as CanvasImageSource, 0, 0);
  return c;
}

/**
 * Rotate clockwise by any angle (expanding the canvas), then mirror in screen space:
 * "horizontal" always flips the result left↔right, whatever the rotation.
 * The returned canvas has an identity transform, so later drawing is not skewed.
 */
export function rotateFlip(src: Drawable, degrees: number, flipH = false, flipV = false, fill: string | null = null): AnyCanvas {
  const size = sourceSize(src);
  const norm = ((degrees % 360) + 360) % 360;
  const { matrix, width, height } = rotateFlipTransform(size, norm, flipH, flipV);
  const out = createCanvas(width, height);
  const ctx = getContext(out);
  if (fill && norm % 90 !== 0) {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.setTransform(...matrix);
  ctx.drawImage(src as CanvasImageSource, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  return out;
}

/**
 * A copy of `src` surrounded by `pad` pixels that repeat its edge pixels, so a
 * blur does not fade the borders towards transparent (or white/black after flattening).
 */
function edgeExtended(src: AnyCanvas, pad: number): AnyCanvas {
  const { width: w, height: h } = src;
  const out = createCanvas(w + pad * 2, h + pad * 2);
  const ctx = getContext(out);
  ctx.imageSmoothingEnabled = false;
  const img = src as CanvasImageSource;
  ctx.drawImage(img, pad, pad);
  ctx.drawImage(img, 0, 0, w, 1, pad, 0, w, pad); // top
  ctx.drawImage(img, 0, h - 1, w, 1, pad, pad + h, w, pad); // bottom
  ctx.drawImage(img, 0, 0, 1, h, 0, pad, pad, h); // left
  ctx.drawImage(img, w - 1, 0, 1, h, pad + w, pad, pad, h); // right
  ctx.drawImage(img, 0, 0, 1, 1, 0, 0, pad, pad);
  ctx.drawImage(img, w - 1, 0, 1, 1, pad + w, 0, pad, pad);
  ctx.drawImage(img, 0, h - 1, 1, 1, 0, pad + h, pad, pad);
  ctx.drawImage(img, w - 1, h - 1, 1, 1, pad + w, pad + h, pad, pad);
  return out;
}

export function applyFilters(src: AnyCanvas, filters: FilterSettings): AnyCanvas {
  if (isIdentity(filters)) return src;
  const out = createCanvas(src.width, src.height);
  const ctx = getContext(out, { willReadFrequently: true });
  if (supportsCanvasFilter()) {
    // Canvas blur samples transparent pixels outside the image: extend the edges first.
    const pad = filters.blur > 0 ? Math.ceil(filters.blur * 3) : 0;
    ctx.filter = filterString(filters);
    if (pad > 0) ctx.drawImage(edgeExtended(src, pad), -pad, -pad);
    else ctx.drawImage(src, 0, 0);
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
): Promise<Omit<JobResult, 'sourceFormat' | 'sourceWidth' | 'sourceHeight' | 'sourceAnimated'>> {
  let current: Drawable = source;
  let size = sourceSize(source);

  if (job.crop) {
    const { x, y, width, height, circle } = job.crop;
    checkDimensions(width, height);
    const c = createCanvas(width, height);
    const ctx = getContext(c);
    ctx.save();
    if (circle) {
      ctx.beginPath();
      ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
      ctx.closePath();
      ctx.clip();
    }
    ctx.drawImage(current as CanvasImageSource, x, y, width, height, 0, 0, width, height);
    ctx.restore();
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
    return {
      ...result,
      sourceFormat: decoded.header.format,
      sourceWidth: decoded.width,
      sourceHeight: decoded.height,
      sourceAnimated: Boolean(decoded.header.animated),
    };
  } finally {
    decoded.bitmap.close();
  }
}
