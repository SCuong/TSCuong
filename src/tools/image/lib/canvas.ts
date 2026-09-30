/**
 * Canvas helpers that work both on the main thread and inside a Web Worker
 * (OffscreenCanvas), plus image decoding with validation and encoding to
 * every output format the image tools offer.
 */
import { DECODABLE, FORMAT_INFO, readImageHeader, svgDimensions, type ImageFormat, type ImageHeader } from './formats';
import { encodeBmp, hexToRgb } from './encoders';
import { quantizeRgba } from './quantize';
import { t } from '@/lib/i18n';

export type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;
export type Ctx2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
export type Drawable = ImageBitmap | HTMLImageElement | AnyCanvas;

/** Browsers refuse (or silently fail) canvases above roughly these limits. */
export const MAX_SIDE = 32767;
export const MAX_AREA = 268_435_456; // 16384 × 16384

export class ImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImageError';
  }
}

export const UNSUPPORTED_MESSAGE = 'This file is an unsupported or corrupt image.';

export function checkDimensions(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new ImageError('The image has no pixels (width or height is 0).');
  }
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_AREA) {
    throw new ImageError(
      `The image is too large to process in the browser (${width.toLocaleString()} × ${height.toLocaleString()} px). ` +
        `The limit is about ${Math.round(MAX_AREA / 1e6)} megapixels (16,384 × 16,384) and ${MAX_SIDE.toLocaleString()} px per side.`,
    );
  }
}

const hasOffscreen = () => typeof OffscreenCanvas !== 'undefined';
const hasDocument = () => typeof document !== 'undefined';

export function createCanvas(width: number, height: number): AnyCanvas {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  checkDimensions(w, h);
  if (hasDocument()) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  if (hasOffscreen()) return new OffscreenCanvas(w, h);
  throw new ImageError('Canvas is not available in this environment.');
}

export function getContext(canvas: AnyCanvas, opts?: CanvasRenderingContext2DSettings): Ctx2D {
  const ctx = canvas.getContext('2d', opts) as Ctx2D | null;
  if (!ctx) {
    throw new ImageError(
      `Your browser could not allocate a ${canvas.width} × ${canvas.height} canvas. Try a smaller image or close other tabs.`,
    );
  }
  return ctx;
}

export function sourceSize(src: Drawable): { width: number; height: number } {
  if (typeof HTMLImageElement !== 'undefined' && src instanceof HTMLImageElement) {
    return { width: src.naturalWidth, height: src.naturalHeight };
  }
  return { width: src.width, height: src.height };
}

export async function canvasToBlob(canvas: AnyCanvas, type: string, quality?: number): Promise<Blob> {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type, quality });
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new ImageError('The browser failed to encode the image.'))), type, quality),
  );
}

const nativeSupport = new Map<string, Promise<boolean>>();

/** Whether this browser's canvas can encode `mime` (canvas silently falls back to PNG otherwise). */
export function canEncodeNatively(mime: string): Promise<boolean> {
  if (mime === 'image/png') return Promise.resolve(true);
  let p = nativeSupport.get(mime);
  if (!p) {
    p = (async () => {
      try {
        const c = createCanvas(2, 2);
        getContext(c).fillRect(0, 0, 1, 1);
        const blob = await canvasToBlob(c, mime, 0.8);
        return blob.type === mime;
      } catch {
        return false;
      }
    })();
    nativeSupport.set(mime, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Decoding
// ---------------------------------------------------------------------------

export interface DecodedImage {
  bitmap: ImageBitmap;
  width: number;
  height: number;
  header: ImageHeader;
}

const HEAD_BYTES = 512 * 1024;

export async function readHeader(blob: Blob): Promise<ImageHeader | null> {
  const head = new Uint8Array(await blob.slice(0, HEAD_BYTES).arrayBuffer());
  return readImageHeader(head);
}

function friendlyUnsupported(format: ImageFormat | undefined): string {
  if (format === 'heic') return 'HEIC/HEIF photos cannot be decoded by this browser. Export the photo as JPEG first (on iPhone: Settings → Camera → Formats → Most Compatible).';
  if (format === 'tiff') return 'TIFF images cannot be decoded by this browser.';
  if (format === 'psd') return 'Photoshop PSD files are not supported. Export a PNG or JPEG first.';
  if (format === 'jxl') return 'JPEG XL images cannot be decoded by this browser.';
  if (format === 'avif') return 'This browser cannot decode AVIF images.';
  return UNSUPPORTED_MESSAGE;
}

export const TAINTED_SVG_MESSAGE =
  'The browser refuses to turn this SVG into pixels because it embeds HTML (<foreignObject>). Remove those elements and try again.';

/**
 * An SVG with no width, height or viewBox has no intrinsic size, so browsers draw
 * its content unscaled whatever the target size. Give it the assumed size.
 */
export function withAssumedSize(svg: string, width: number, height: number): string {
  const m = /<svg\b[^>]*>/i.exec(svg);
  if (!m) return svg;
  const has = (name: string) => new RegExp(`\\s${name}\\s*=`, 'i').test(m[0]);
  if (has('viewBox') || has('width') || has('height')) return svg;
  const tag = m[0].replace(/^<svg\b/i, `<svg width="${width}" height="${height}"`);
  return svg.slice(0, m.index) + tag + svg.slice(m.index + m[0].length);
}

/** Load an SVG (main thread only) and rasterize it at the given size. */
export async function rasterizeSvg(svg: Blob | string, width: number, height: number): Promise<ImageBitmap> {
  if (!hasDocument()) throw new ImageError('SVG images can only be rendered on the main thread.');
  checkDimensions(Math.round(width), Math.round(height));
  const text = typeof svg === 'string' ? svg : await svg.text();
  const size = svgIntrinsicSize(text);
  const blob = new Blob([withAssumedSize(text, Math.round(size.width), Math.round(size.height))], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw new ImageError('The SVG could not be rendered. It may be invalid XML or reference external resources.');
    }
    const c = createCanvas(width, height);
    const ctx = getContext(c);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    try {
      // SVGs with <foreignObject> taint the canvas: nothing could be exported from it.
      ctx.getImageData(0, 0, 1, 1);
    } catch {
      throw new ImageError(TAINTED_SVG_MESSAGE);
    }
    return await createImageBitmap(c);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Intrinsic size of an SVG document (falls back to its viewBox, then 512×512). */
export function svgIntrinsicSize(text: string): { width: number; height: number; fromViewBox: boolean; missing: boolean } {
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0];
  const dims = tag ? svgDimensions(tag) : null;
  if (!dims) return { width: 512, height: 512, fromViewBox: false, missing: true };
  return { ...dims, missing: false };
}

/**
 * Decode an image file into an ImageBitmap with validation: magic bytes,
 * decode failures and dimension limits all produce clear messages.
 */
export async function decodeImage(blob: Blob): Promise<DecodedImage> {
  if (blob.size === 0) throw new ImageError('The file is empty.');
  const header = await readHeader(blob);
  if (!header) throw new ImageError(UNSUPPORTED_MESSAGE);
  if (header.width && header.height) checkDimensions(header.width, header.height);
  let bitmap: ImageBitmap;
  if (header.format === 'svg') {
    const text = await blob.text();
    const size = svgIntrinsicSize(text);
    bitmap = await rasterizeSvg(text, Math.max(1, Math.round(size.width)), Math.max(1, Math.round(size.height)));
  } else {
    try {
      bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    } catch {
      throw new ImageError(DECODABLE.has(header.format) ? UNSUPPORTED_MESSAGE : friendlyUnsupported(header.format));
    }
  }
  if (bitmap.width === 0 || bitmap.height === 0) {
    bitmap.close();
    throw new ImageError(UNSUPPORTED_MESSAGE);
  }
  try {
    checkDimensions(bitmap.width, bitmap.height);
  } catch (e) {
    bitmap.close();
    throw e;
  }
  return { bitmap, width: bitmap.width, height: bitmap.height, header };
}

/** Size that fits `maxSide` (never upscales). */
export function fitWithin(width: number, height: number, maxSide: number): { width: number; height: number } {
  const k = Math.min(1, maxSide / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

export type OutputFormat = 'png' | 'jpeg' | 'webp' | 'avif' | 'png-lossy' | 'bmp';

export const OUTPUT_INFO: Record<OutputFormat, { label: string; mime: string; ext: string; alpha: boolean; lossy: boolean }> = {
  png: { label: 'PNG', mime: 'image/png', ext: 'png', alpha: true, lossy: false },
  'png-lossy': { label: t('PNG (lossy)'), mime: 'image/png', ext: 'png', alpha: true, lossy: true },
  jpeg: { label: 'JPEG', mime: 'image/jpeg', ext: 'jpg', alpha: false, lossy: true },
  webp: { label: t('WebP'), mime: 'image/webp', ext: 'webp', alpha: true, lossy: true },
  avif: { label: 'AVIF', mime: 'image/avif', ext: 'avif', alpha: true, lossy: true },
  bmp: { label: 'BMP', mime: 'image/bmp', ext: 'bmp', alpha: false, lossy: false },
};

/** The output format used for "keep original format". */
export function keepFormat(format: ImageFormat | undefined): OutputFormat {
  if (format === 'jpeg' || format === 'webp' || format === 'avif' || format === 'bmp') return format;
  return 'png';
}

/** Map quality 0–1 to a palette size for lossy PNG (upng-js quantization). */
export function paletteSizeForQuality(quality: number): number {
  const q = Math.min(1, Math.max(0, quality));
  return Math.max(8, Math.min(256, Math.round(2 ** (3 + 5 * q))));
}

type AvifFactory = (opts: Record<string, unknown>) => Promise<{
  encode(data: Uint8Array, w: number, h: number, opts: Record<string, unknown>): Uint8Array | null;
}>;
let avifModule: ReturnType<AvifFactory> | null = null;

async function encodeAvifWasm(data: ImageData, quality: number): Promise<Blob> {
  if (!avifModule) {
    avifModule = (async () => {
      const [{ default: factory }, { default: wasmUrl }] = await Promise.all([
        import('@jsquash/avif/codec/enc/avif_enc.js') as unknown as Promise<{ default: AvifFactory }>,
        import('@jsquash/avif/codec/enc/avif_enc.wasm?url'),
      ]);
      return factory({ noInitialRun: true, locateFile: (path: string) => (path.endsWith('.wasm') ? wasmUrl : path) });
    })();
    avifModule.catch(() => {
      avifModule = null;
    });
  }
  const mod = await avifModule;
  const out = mod.encode(new Uint8Array(data.data.buffer, data.data.byteOffset, data.data.byteLength), data.width, data.height, {
    quality: Math.round(Math.min(1, Math.max(0, quality)) * 100),
    qualityAlpha: -1,
    denoiseLevel: 0,
    tileRowsLog2: 0,
    tileColsLog2: 0,
    speed: 6,
    subsample: 1,
    chromaDeltaQ: false,
    sharpness: 0,
    enableSharpYUV: false,
    tune: 0,
    bitDepth: 8,
  });
  if (!out) throw new ImageError('The AVIF encoder failed.');
  return new Blob([new Uint8Array(out)], { type: 'image/avif' });
}

/** Whether `format` can be produced here (AVIF falls back to a WebAssembly encoder). */
export async function canEncode(format: OutputFormat): Promise<boolean> {
  if (format === 'webp') return canEncodeNatively('image/webp');
  if (format === 'avif') return (await canEncodeNatively('image/avif')) || typeof WebAssembly !== 'undefined';
  return true;
}

export interface EncodeOptions {
  format: OutputFormat;
  /** 0–1 for lossy formats. */
  quality?: number;
}

/** Encode a canvas. Formats without alpha must be flattened by the caller first. */
export async function encodeCanvas(canvas: AnyCanvas, { format, quality = 0.82 }: EncodeOptions): Promise<Blob> {
  const q = Math.min(1, Math.max(0, quality));
  switch (format) {
    case 'png':
      return canvasToBlob(canvas, 'image/png');
    case 'jpeg':
      return canvasToBlob(canvas, 'image/jpeg', q);
    case 'webp': {
      const blob = await canvasToBlob(canvas, 'image/webp', q);
      if (blob.type !== 'image/webp') throw new ImageError('This browser cannot encode WebP images.');
      return blob;
    }
    case 'avif': {
      if (await canEncodeNatively('image/avif')) return canvasToBlob(canvas, 'image/avif', q);
      const ctx = getContext(canvas);
      return encodeAvifWasm(ctx.getImageData(0, 0, canvas.width, canvas.height), q);
    }
    case 'png-lossy': {
      const ctx = getContext(canvas);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const { default: UPNG } = await import('upng-js');
      // Quantize ourselves (upng's quantizer merges distinct hues), then let upng write an
      // indexed PNG: with ≤ 255 colors it picks a palette (it reserves one entry itself).
      const reduced = quantizeRgba(data.data, Math.min(255, paletteSizeForQuality(q)));
      const png = UPNG.encode([reduced.buffer as ArrayBuffer], canvas.width, canvas.height, 0);
      return new Blob([png], { type: 'image/png' });
    }
    case 'bmp': {
      const ctx = getContext(canvas);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      return new Blob([encodeBmp(data.data, canvas.width, canvas.height) as Uint8Array<ArrayBuffer>], { type: 'image/bmp' });
    }
  }
}

/** Fill a canvas background (used to flatten transparency). */
export function fillBackground(ctx: Ctx2D, width: number, height: number, color: string) {
  ctx.save();
  // Always fill the whole canvas, even if a caller left a transform or clip behind.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.filter = 'none';
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = hexToRgb(color) ? color : '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
}

export function formatLabel(format: ImageFormat | undefined): string {
  return format ? FORMAT_INFO[format].label : 'Unknown';
}

/** Result note for animated sources: browsers decode only their first frame. */
export function firstFrameNote(animated: boolean | undefined, format?: ImageFormat): string | undefined {
  if (!animated) return undefined;
  const kind = format === 'gif' ? 'an animated GIF' : format === 'png' ? 'an animated PNG' : format === 'webp' ? 'an animated WebP' : 'an animation';
  return `The source is ${kind}: only its first frame was used, so the result is a still image.`;
}

/** Join optional result notes into one sentence list. */
export function joinNotes(...notes: Array<string | undefined | null | false>): string | undefined {
  const list = notes.filter((n): n is string => Boolean(n));
  return list.length ? list.join(' ') : undefined;
}
