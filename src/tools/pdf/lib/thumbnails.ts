/**
 * Thumbnail rendering with a small concurrency-limited queue and a per-document
 * cache of object URLs. URLs are revoked when the document is released.
 */
import { canvasToBlob, releaseCanvas, renderPageToCanvas, type PDFDocumentProxy } from './pdfjs';

const MAX_CONCURRENT = 2;

interface Job {
  doc: PDFDocumentProxy;
  run: () => Promise<void>;
  cancel: () => void;
  cancelled: boolean;
}

const queue: Job[] = [];
let active = 0;

function pump() {
  while (active < MAX_CONCURRENT && queue.length) {
    const job = queue.shift()!;
    if (job.cancelled) continue;
    active++;
    void job.run().finally(() => {
      active--;
      pump();
    });
  }
}

const cache = new WeakMap<PDFDocumentProxy, Map<string, Promise<string>>>();
const allUrls = new WeakMap<PDFDocumentProxy, Set<string>>();

/**
 * Render (or reuse) a thumbnail for a 0-based page index at a target CSS width.
 * Returns an object URL owned by the cache; the promise rejects with an
 * AbortError if the request is cancelled before it starts.
 */
export function getThumbnail(
  doc: PDFDocumentProxy,
  pageIndex: number,
  width: number,
  signal?: AbortSignal,
): Promise<string> {
  let docCache = cache.get(doc);
  if (!docCache) {
    docCache = new Map();
    cache.set(doc, docCache);
  }
  const key = `${pageIndex}@${width}`;
  const existing = docCache.get(key);
  if (existing) return existing;

  const promise = new Promise<string>((resolve, reject) => {
    const job: Job = {
      doc,
      cancelled: false,
      cancel: () => {
        job.cancelled = true;
        docCache!.delete(key);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      run: async () => {
        try {
          const page = await doc.getPage(pageIndex + 1);
          const base = page.getViewport({ scale: 1 });
          const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
          const scale = (width * dpr) / base.width;
          const canvas = await renderPageToCanvas(page, { scale });
          const blob = await canvasToBlob(canvas, 'image/png');
          releaseCanvas(canvas);
          page.cleanup();
          if (cache.get(doc) !== docCache) throw new DOMException('Aborted', 'AbortError'); // released meanwhile
          const url = URL.createObjectURL(blob);
          let urls = allUrls.get(doc);
          if (!urls) {
            urls = new Set();
            allUrls.set(doc, urls);
          }
          urls.add(url);
          resolve(url);
        } catch (error) {
          docCache!.delete(key);
          reject(error);
        }
      },
    };
    signal?.addEventListener(
      'abort',
      () => {
        const at = queue.indexOf(job);
        if (at !== -1) {
          queue.splice(at, 1);
          job.cancel();
        }
      },
      { once: true },
    );
    queue.push(job);
    pump();
  });
  docCache.set(key, promise);
  return promise;
}

/** Revoke every thumbnail URL created for a document. Call before destroying it. */
export function releaseThumbnails(doc: PDFDocumentProxy) {
  for (let i = queue.length - 1; i >= 0; i--) {
    if (queue[i].doc === doc) queue.splice(i, 1)[0].cancel();
  }
  const urls = allUrls.get(doc);
  if (urls) for (const url of urls) URL.revokeObjectURL(url);
  allUrls.delete(doc);
  cache.delete(doc);
}

const docIds = new WeakMap<PDFDocumentProxy, number>();
let nextDocId = 1;
/** A stable per-instance id for keys (two opens of the same file get different ids). */
export function docId(doc: PDFDocumentProxy | null): number {
  if (!doc) return 0;
  let id = docIds.get(doc);
  if (!id) {
    id = nextDocId++;
    docIds.set(doc, id);
  }
  return id;
}
