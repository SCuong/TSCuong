/**
 * Barcode decoding with zxing-wasm in a Web Worker (the WebAssembly binary is
 * served from this app, never from a CDN). Decoding a large photo takes a second
 * or more, so it must not run on the main thread.
 */
import type { ReaderOptions } from 'zxing-wasm/reader';
import type { ScanHit, ScanRequest, ScanResponse } from './zxing.worker';

export type { ScanHit };

export const SCAN_FORMATS: NonNullable<ReaderOptions['formats']> = [
  'QRCode',
  'MicroQRCode',
  'RMQRCode',
  'DataMatrix',
  'Aztec',
  'PDF417',
  'EAN13',
  'EAN8',
  'UPCA',
  'UPCE',
  'Code128',
  'Code39',
  'Code93',
  'ITF',
  'Codabar',
  'DataBar',
  'DataBarExp',
];

export const READER_LOAD_ERROR = 'The code reader failed to load. Check your connection and reload the page.';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (hits: ScanHit[]) => void; reject: (error: Error) => void }>();

function failAll(message: string) {
  for (const p of pending.values()) p.reject(new Error(message));
  pending.clear();
}

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./zxing.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (event: MessageEvent<ScanResponse>) => {
    const msg = event.data;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.hits);
    else p.reject(new Error(READER_LOAD_ERROR));
  };
  w.onerror = (event) => {
    event.preventDefault();
    w.terminate();
    if (worker === w) worker = null;
    failAll(READER_LOAD_ERROR);
  };
  worker = w;
  return w;
}

/** Start loading the decoder in the background (e.g. while the camera starts). */
export function warmUpScanner() {
  void scan(new ImageData(1, 1), true).catch(() => {});
}

/** Stop the decoder worker (pending scans fail); it restarts on the next scan. */
export function disposeScanner() {
  worker?.terminate();
  worker = null;
  failAll('The scan was stopped.');
}

/** Decode every valid code in the image. The pixel buffer is transferred to the worker. */
export function scan(image: ImageData, fast = false): Promise<ScanHit[]> {
  const w = getWorker();
  const id = ++seq;
  const options: ReaderOptions = {
    formats: SCAN_FORMATS,
    tryHarder: !fast,
    tryRotate: !fast,
    tryInvert: true,
    tryDownscale: true,
    maxNumberOfSymbols: fast ? 4 : 16,
  };
  return new Promise<ScanHit[]>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const request: ScanRequest = { id, image, options };
    w.postMessage(request, [image.data.buffer]);
  });
}

export function formatLabel(format: string): string {
  const labels: Record<string, string> = {
    QRCode: 'QR Code',
    MicroQRCode: 'Micro QR',
    RMQRCode: 'rMQR',
    DataMatrix: 'Data Matrix',
    Aztec: 'Aztec',
    PDF417: 'PDF417',
    EAN13: 'EAN-13',
    EAN8: 'EAN-8',
    UPCA: 'UPC-A',
    UPCE: 'UPC-E',
    Code128: 'Code 128',
    Code39: 'Code 39',
    Code93: 'Code 93',
    ITF: 'ITF',
    Codabar: 'Codabar',
    DataBar: 'DataBar',
    DataBarExp: 'DataBar Expanded',
  };
  return labels[format] ?? format;
}
