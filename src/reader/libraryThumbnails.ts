import { readerRepository, readerThumbnails } from './storage';
import { openPdf, renderPageToCanvas, canvasToBlob, releaseCanvas, type PDFDocumentProxy } from '@/tools/pdf/lib/pdfjs';

// One tiny canvas/temporary PDF at a time, including imports and lazy library renders.
let queue: Promise<unknown> = Promise.resolve();
const pending = new Map<string, Promise<Blob | undefined>>();
export function libraryThumbnail(id: string, doc?: PDFDocumentProxy): Promise<Blob | undefined> {
  const existing = pending.get(id);
  if (existing) return doc ? existing.then((blob) => blob ?? libraryThumbnail(id, doc)) : existing;
  const job = queue.catch(() => {}).then(async () => {
    const cached = await readerThumbnails.get(id);
    if (cached) return cached;
    let opened: Awaited<ReturnType<typeof openPdf>> | undefined;
    let canvas: HTMLCanvasElement | undefined;
    try {
      const render = async (source: PDFDocumentProxy) => {
        const page = await source.getPage(1);
        const base = page.getViewport({ scale: 1 });
        canvas = await renderPageToCanvas(page, { scale: Math.min(180 / base.width, 240 / base.height), maxPixels: 43_200, maxSide: 240 });
        const blob = await canvasToBlob(canvas, 'image/jpeg', 0.8);
        releaseCanvas(canvas); canvas = undefined;
        return blob;
      };
      let blob: Blob | undefined;
      if (doc) {
        // A fast import/back/import sequence can destroy the borrowed reader worker.
        // Fall back to an owned document so rows waiting on this same job still get a preview.
        try { blob = await render(doc); } catch { if (canvas) releaseCanvas(canvas); canvas = undefined; }
      }
      if (!blob) {
        const file = await readerRepository.readFile(id);
        // Large PDFs gain a preview when opened, without another background copy in RAM.
        if (file.size > 64 * 1024 * 1024) return undefined;
        // Never prompt for or persist passwords during background thumbnail loading.
        opened = await openPdf(new Uint8Array(await file.arrayBuffer()));
        blob = await render(opened.doc);
      }
      await readerThumbnails.put(id, blob);
      return blob;
    } finally {
      if (canvas) releaseCanvas(canvas);
      opened?.destroy();
      // A borrowed reader page may be in use; its owner manages cleanup.
    }
  }).catch(() => undefined);
  pending.set(id, job);
  queue = job;
  void job.finally(() => { if (pending.get(id) === job) pending.delete(id); });
  return job;
}
