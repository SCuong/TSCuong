import type * as XLSXTypes from 'xlsx';

export interface SheetData {
  name: string;
  hidden: boolean;
  /** Cell text as displayed by the spreadsheet (number formats applied). */
  records: string[][];
  /** A1-style used range, e.g. "A1:F120". Empty for an empty sheet. */
  range: string;
  /** Column letter where `records[i][0]` sits, e.g. "A" or "C". */
  firstColumn: string;
  firstRow: number;
}

export const SPREADSHEET_ACCEPT = '.xlsx,.xlsm,.xlsb,.xls,.ods,.fods';

/** Drop trailing rows and columns that are entirely empty. */
export function trimRecords(records: string[][]): string[][] {
  let last = records.length - 1;
  while (last >= 0 && records[last].every((c) => c === '')) last--;
  const rows = records.slice(0, last + 1);
  let width = 0;
  for (const r of rows) {
    for (let i = r.length - 1; i >= width; i--) {
      if (r[i] !== '') {
        width = i + 1;
        break;
      }
    }
  }
  return rows.map((r) => {
    const out = r.slice(0, width);
    while (out.length < width) out.push('');
    return out;
  });
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString();
  return String(value);
}

/** Convert a parsed workbook into plain string grids, one per sheet. */
export function workbookToSheets(XLSX: typeof XLSXTypes, wb: XLSXTypes.WorkBook): SheetData[] {
  return wb.SheetNames.map((name, i) => {
    const ws = wb.Sheets[name];
    const hidden = Boolean(wb.Workbook?.Sheets?.[i]?.Hidden);
    const ref = ws?.['!ref'];
    if (!ws || !ref) return { name, hidden, records: [], range: '', firstColumn: 'A', firstRow: 1 };
    const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: '', blankrows: true });
    const records = trimRecords(raw.map((r) => (Array.isArray(r) ? r.map(cellText) : [])));
    const decoded = XLSX.utils.decode_range(ref);
    return {
      name,
      hidden,
      records,
      range: ref,
      firstColumn: XLSX.utils.encode_col(decoded.s.c),
      firstRow: decoded.s.r + 1,
    };
  });
}

/** Turn SheetJS's errors into plain sentences. */
export function describeWorkbookError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (/password|encrypt/i.test(msg) && !/zip/i.test(msg))
    return 'This workbook is password-protected. Remove the password in your spreadsheet app and try again.';
  if (/unsupported|corrupt|invalid|zip|signature|cfb|unrecognized|not a/i.test(msg)) {
    return 'This file could not be read as a spreadsheet. It may be corrupt or in an unsupported format.';
  }
  if (/memory|allocation|array buffer/i.test(msg)) return 'The workbook is too large to open in this browser (out of memory).';
  return msg || 'Could not read the workbook.';
}

const ZIP_FORMATS = ['.xlsx', '.xlsm', '.xlsb', '.ods'];

/**
 * Check that a file's bytes match its extension before handing it to SheetJS,
 * which otherwise happily reads any text file as a one-column sheet.
 * Returns an error sentence, or null when the file looks right.
 */
export function checkSignature(fileName: string, bytes: Uint8Array): string | null {
  const name = fileName.toLowerCase();
  const ext = ZIP_FORMATS.find((e) => name.endsWith(e));
  if (!bytes.length) return 'This file is empty.';
  if (ext && !(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    const ole = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
    // Password-protected XLSX files are OLE containers; SheetJS explains those itself.
    if (ole && ext !== '.ods') return null;
    return `This is not a valid ${ext.slice(1).toUpperCase()} file (the content is not a spreadsheet package). It may be corrupt or renamed.`;
  }
  return null;
}
