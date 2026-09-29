/// <reference lib="webworker" />
import * as XLSX from 'xlsx';
import { checkSignature, describeWorkbookError, workbookToSheets, type SheetData } from '../lib/spreadsheet';

export type SpreadsheetWorkerResponse = { ok: true; sheets: SheetData[] } | { ok: false; error: string };

self.onmessage = (event: MessageEvent<{ buffer: ArrayBuffer; name: string }>) => {
  try {
    const bytes = new Uint8Array(event.data.buffer);
    const invalid = checkSignature(event.data.name, bytes);
    if (invalid) {
      (self as unknown as Worker).postMessage({ ok: false, error: invalid } satisfies SpreadsheetWorkerResponse);
      return;
    }
    const wb = XLSX.read(bytes, { type: 'array', dense: true, cellDates: true });
    const sheets = workbookToSheets(XLSX, wb);
    (self as unknown as Worker).postMessage({ ok: true, sheets } satisfies SpreadsheetWorkerResponse);
  } catch (error) {
    (self as unknown as Worker).postMessage({ ok: false, error: describeWorkbookError(error) } satisfies SpreadsheetWorkerResponse);
  }
};
