import type { SheetData } from '../lib/spreadsheet';
import type { SpreadsheetWorkerResponse } from '../workers/spreadsheet.worker';

/** Parse a workbook in a Web Worker. Rejects with AbortError (and terminates the worker) when the signal fires. */
export function parseWorkbook(file: File, signal: AbortSignal): Promise<SheetData[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/spreadsheet.worker.ts', import.meta.url), { type: 'module', name: 'spreadsheet-parse' });
    const onAbort = () => {
      worker.terminate();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (signal.aborted) return onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    const finish = () => {
      signal.removeEventListener('abort', onAbort);
      worker.terminate();
    };
    worker.onmessage = (event: MessageEvent<SpreadsheetWorkerResponse>) => {
      finish();
      if (event.data.ok) resolve(event.data.sheets);
      else reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || 'The spreadsheet reader stopped unexpectedly.'));
    };
    file
      .arrayBuffer()
      .then((buffer) => {
        if (!signal.aborted) worker.postMessage({ buffer, name: file.name }, [buffer]);
      })
      .catch((error: unknown) => {
        finish();
        reject(error instanceof Error ? error : new Error('Could not read the file.'));
      });
  });
}
