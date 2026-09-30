/// <reference lib="webworker" />
/** Decodes barcodes off the main thread (zxing-wasm; the .wasm file is served by this app). */
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import { prepareZXingModule, readBarcodes, type ReaderOptions, type ReadResult } from 'zxing-wasm/reader';

export interface ScanHit {
  format: string;
  text: string;
  position: ReadResult['position'];
}

export interface ScanRequest {
  id: number;
  image: ImageData;
  options: ReaderOptions;
}

export type ScanResponse = { id: number; ok: true; hits: ScanHit[] } | { id: number; ok: false; error: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

let ready: Promise<unknown> | null = null;
function init() {
  ready ??= prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path) },
    fireImmediately: true,
  });
  return ready;
}

scope.onmessage = async (event: MessageEvent<ScanRequest>) => {
  const { id, image, options } = event.data;
  let msg: ScanResponse;
  try {
    await init();
    const results = await readBarcodes(image, options);
    msg = { id, ok: true, hits: results.filter((r) => r.isValid).map((r) => ({ format: r.format, text: r.text, position: r.position })) };
  } catch (error) {
    ready = null;
    msg = { id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  scope.postMessage(msg);
};
