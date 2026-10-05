/**
 * pdf.js setup: worker, local font/wasm/cmap assets and friendly document loading.
 * Only import this module from tool components (it pulls in pdfjs-dist).
 */
// The "legacy" build ships polyfills for features that only the newest browsers have
// (e.g. Map.prototype.getOrInsertComputed), so the PDF tools also work on older Safari/iOS.
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { toPdfError } from './errors';
import { canvasToBlob, releaseCanvas } from './canvas';

export { canvasToBlob, releaseCanvas };
export { OPS, TextLayer } from 'pdfjs-dist/legacy/build/pdf.mjs';

GlobalWorkerOptions.workerSrc = workerUrl;

/** Versioned folder with pdf.js fonts, cmaps and wasm decoders (see scripts/engine-assets.mjs). */
const ASSETS = `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}${__PDFJS_ASSET_DIR__}`;

export type { PDFDocumentProxy, PDFPageProxy };

export interface OpenedPdf {
  doc: PDFDocumentProxy;
  /** Destroys the document and its worker-side resources. Safe to call more than once. */
  destroy: () => void;
}

/**
 * Open PDF bytes with pdf.js. The bytes are copied first because pdf.js
 * transfers (detaches) the buffer it is given.
 * Throws PdfError('password' | 'wrong-password' | 'corrupt' | ...).
 */
export async function openPdf(bytes: Uint8Array, options: { password?: string; fileName?: string } = {}): Promise<OpenedPdf> {
  const task = getDocument({
    data: bytes.slice(),
    password: options.password,
    standardFontDataUrl: `${ASSETS}standard_fonts/`,
    wasmUrl: `${ASSETS}wasm/`,
    cMapUrl: `${ASSETS}cmaps/`,
    cMapPacked: true,
    isEvalSupported: false,
    enableXfa: false,
    verbosity: 0,
  } as Parameters<typeof getDocument>[0]);
  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    void task.destroy().catch(() => {});
  };
  try {
    const doc = await task.promise;
    return { doc, destroy };
  } catch (error) {
    destroy();
    throw toPdfError(error, options.fileName);
  }
}

/** Visual page size in PDF points, after the page's own /Rotate is applied. */
export function pageSize(page: PDFPageProxy): { width: number; height: number } {
  const vp = page.getViewport({ scale: 1 });
  return { width: vp.width, height: vp.height };
}

export interface RenderOptions {
  /** Scale relative to 72 DPI. */
  scale: number;
  /** Extra rotation in degrees (added to the page's own rotation). */
  rotation?: number;
  background?: string;
  signal?: AbortSignal;
  /** 'print' renders form fields and print-only annotations like a printer would. */
  intent?: 'display' | 'print';
  maxPixels?: number;
  maxSide?: number;
}

/** Hard canvas limits shared by all major browsers (Safari is the tightest). */
export const MAX_CANVAS_SIDE = 16384;
export const MAX_CANVAS_AREA = 16384 * 16384 * 0.25; // ~67 MP keeps Safari/iOS happy

/** Render a page into a new canvas. Cancels the render if the signal aborts. */
export async function renderPageToCanvas(page: PDFPageProxy, options: RenderOptions): Promise<HTMLCanvasElement> {
  if (options.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  const rotation = (((page.rotate + (options.rotation ?? 0)) % 360) + 360) % 360;
  let viewport = page.getViewport({ scale: options.scale, rotation });
  const maxArea = options.maxPixels ?? MAX_CANVAS_AREA;
  const maxSide = options.maxSide ?? MAX_CANVAS_SIDE;
  const area = viewport.width * viewport.height;
  if (viewport.width > maxSide || viewport.height > maxSide || area > maxArea) {
    const factor = Math.min(
      maxSide / viewport.width,
      maxSide / viewport.height,
      Math.sqrt(maxArea / area),
    );
    viewport = page.getViewport({ scale: options.scale * factor * 0.999, rotation });
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const task = page.render({
    canvas,
    viewport,
    background: options.background ?? 'rgb(255,255,255)',
    intent: options.intent ?? 'display',
  });
  const onAbort = () => task.cancel();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  try {
    await task.promise;
  } catch (error) {
    releaseCanvas(canvas);
    throw toPdfError(error);
  } finally {
    options.signal?.removeEventListener('abort', onAbort);
  }
  return canvas;
}
