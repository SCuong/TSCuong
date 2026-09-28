/**
 * Browser-side image preparation for Images → PDF and watermark images:
 * decodes any format the browser supports and produces PNG/JPEG bytes that
 * pdf-lib can embed, applying EXIF orientation.
 */
import { jpegOrientation, sniffImage, type ImageKind } from './files';
import { PdfError } from './errors';
import { canvasToBlob, releaseCanvas } from './canvas';

export interface PreparedImage {
  bytes: Uint8Array;
  format: 'png' | 'jpg';
  width: number;
  height: number;
}

export interface ImageProbe {
  kind: ImageKind;
  width: number;
  height: number;
}

const LABELS: Partial<Record<ImageKind, string>> = { avif: 'AVIF', webp: 'WebP', gif: 'GIF', bmp: 'BMP' };

async function decode(file: Blob, kind: ImageKind): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    const label = LABELS[kind];
    throw new PdfError(
      'invalid-input',
      label ? `This browser cannot decode ${label} images. Convert it to PNG or JPEG first.` : 'This image could not be decoded. It may be damaged or in an unsupported format.',
    );
  }
}

/** Check that the browser can decode the image and read its size. */
export async function probeImage(file: File): Promise<ImageProbe> {
  const head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
  const kind = sniffImage(head);
  if (kind === 'unknown' || kind === 'svg') {
    throw new PdfError('invalid-input', `"${file.name}" is not a supported image (use JPG, PNG, WebP, GIF, BMP or AVIF).`);
  }
  const bitmap = await decode(file, kind);
  const result = { kind, width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return result;
}

function hasAlpha(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  // Sample in strips to keep memory bounded on large images.
  const strip = Math.max(1, Math.floor(4_000_000 / Math.max(1, width)));
  for (let y = 0; y < height; y += strip) {
    const h = Math.min(strip, height - y);
    const data = ctx.getImageData(0, y, width, h).data;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 255) return true;
  }
  return false;
}

/** Produce bytes pdf-lib can embed. JPEG and PNG are passed through untouched when possible. */
export async function prepareImage(file: File, jpegQuality = 0.92): Promise<PreparedImage> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (kind === 'jpg' && jpegOrientation(bytes) === 1) {
    const bitmap = await decode(file, kind);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return { bytes, format: 'jpg', ...size };
  }
  if (kind === 'png') {
    const bitmap = await decode(file, kind);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return { bytes, format: 'png', ...size };
  }
  if (kind === 'unknown' || kind === 'svg') {
    throw new PdfError('invalid-input', `"${file.name}" is not a supported image.`);
  }
  // Re-encode through a canvas (orientation already applied by createImageBitmap).
  const bitmap = await decode(file, kind);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new PdfError('memory', 'The image is too large to convert in this browser.');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const alpha = kind !== 'jpg' && hasAlpha(ctx, canvas.width, canvas.height);
  const blob = await canvasToBlob(canvas, alpha ? 'image/png' : 'image/jpeg', alpha ? undefined : jpegQuality);
  const out = { bytes: new Uint8Array(await blob.arrayBuffer()), format: alpha ? ('png' as const) : ('jpg' as const), width: canvas.width, height: canvas.height };
  releaseCanvas(canvas);
  return out;
}
