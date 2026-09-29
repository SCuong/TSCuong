import type { ParseIssue } from '../lib/csv';
import type { CsvParseMessage, CsvParseRequest } from '../workers/csvParse.worker';

export interface ParsedFile {
  records: string[][];
  delimiter: string;
  linebreak: string;
  issues: ParseIssue[];
  truncated: boolean;
}

export const MAX_ROWS = 2_000_000;

/** Parse a CSV file in a Web Worker. Rejects with AbortError when the signal fires (the worker is terminated). */
export function parseCsvFile(
  file: File,
  options: { delimiter: string; encoding: string; signal: AbortSignal; onProgress: (fraction: number, label: string) => void },
): Promise<ParsedFile> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/csvParse.worker.ts', import.meta.url), { type: 'module', name: 'csv-parse' });
    const records: string[][] = [];
    const stop = () => worker.terminate();
    const onAbort = () => {
      stop();
      reject(new DOMException('Aborted', 'AbortError'));
    };
    if (options.signal.aborted) return onAbort();
    options.signal.addEventListener('abort', onAbort, { once: true });
    const finish = () => {
      options.signal.removeEventListener('abort', onAbort);
      stop();
    };
    worker.onmessage = (event: MessageEvent<CsvParseMessage>) => {
      const msg = event.data;
      if (msg.type === 'progress') {
        options.onProgress(msg.progress, msg.label);
      } else if (msg.type === 'chunk') {
        for (const row of msg.rows) records.push(row);
        options.onProgress(msg.progress, `Parsing… ${records.length.toLocaleString()} rows`);
      } else if (msg.type === 'done') {
        finish();
        resolve({ records, delimiter: msg.delimiter, linebreak: msg.linebreak, issues: msg.issues, truncated: msg.truncated });
      } else {
        finish();
        reject(new Error(msg.message));
      }
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || 'The CSV parser stopped unexpectedly.'));
    };
    worker.postMessage({ file, delimiter: options.delimiter, encoding: options.encoding, maxRows: MAX_ROWS } satisfies CsvParseRequest);
  });
}
