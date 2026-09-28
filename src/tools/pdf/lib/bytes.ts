import { PdfError } from './errors';

/** Largest PDF we attempt to open. Browsers generally cannot hold much more in memory alongside rendering. */
export const MAX_PDF_BYTES = 512 * 1024 * 1024;

function latin1(bytes: Uint8Array, start: number, end: number): string {
  let out = '';
  const stop = Math.min(end, bytes.length);
  for (let i = Math.max(0, start); i < stop; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, Math.min(stop, i + 8192)));
  }
  return out;
}

/** The PDF spec allows junk before the header; readers accept "%PDF-" within the first 1024 bytes. */
export function findPdfHeader(bytes: Uint8Array): number {
  const head = latin1(bytes, 0, 1024);
  return head.indexOf('%PDF-');
}

export function hasPdfHeader(bytes: Uint8Array): boolean {
  return findPdfHeader(bytes) !== -1;
}

/** Header version, e.g. "1.7" or "2.0". The catalog /Version may override it; see inspector. */
export function headerVersion(bytes: Uint8Array): string | null {
  const at = findPdfHeader(bytes);
  if (at === -1) return null;
  const m = /^%PDF-(\d+\.\d+)/.exec(latin1(bytes, at, at + 16));
  return m ? m[1] : null;
}

/** True when the first object is a linearization dictionary ("fast web view"). */
export function isLinearized(bytes: Uint8Array): boolean {
  return /\/Linearized[\s\d]/.test(latin1(bytes, 0, 2048));
}

/**
 * Fast heuristic for an /Encrypt entry in the trailer or cross-reference stream.
 * Looks at the start (linearized files) and the end of the file where trailers live.
 */
export function looksEncrypted(bytes: Uint8Array): boolean {
  const tailStart = Math.max(0, bytes.length - 1024 * 1024);
  const re = /\/Encrypt\s*(\d+\s+\d+\s+R|<<)/;
  return re.test(latin1(bytes, tailStart, bytes.length)) || (tailStart > 0 && re.test(latin1(bytes, 0, 64 * 1024)));
}

/** Validate that bytes look like a PDF; throws a friendly PdfError otherwise. */
export function assertPdfBytes(bytes: Uint8Array, fileName?: string): void {
  const subject = fileName ? `"${fileName}"` : 'This file';
  if (bytes.length === 0) throw new PdfError('empty', `${subject} is empty (0 bytes).`);
  if (!hasPdfHeader(bytes)) {
    const guess = sniffType(bytes);
    throw new PdfError(
      'not-pdf',
      guess
        ? `${subject} is not a PDF: it looks like ${guess}.`
        : `${subject} is not a PDF (it does not start with the "%PDF" header).`,
    );
  }
}

function sniffType(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'a PNG image';
  if (b[0] === 0xff && b[1] === 0xd8) return 'a JPEG image';
  if (b[0] === 0x50 && b[1] === 0x4b) return 'a ZIP archive (or a Word/Excel document)';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'a GIF image';
  if (latin1(b, 0, 5).toLowerCase() === '<!doc' || latin1(b, 0, 5).toLowerCase() === '<html') return 'an HTML page';
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) return 'an old Microsoft Office document';
  return null;
}

/** Read a File into bytes with size and header validation. */
export async function readPdfFile(file: File): Promise<Uint8Array> {
  if (file.size > MAX_PDF_BYTES) {
    throw new PdfError('memory', `"${file.name}" is larger than 512 MB, which is more than this browser tool can safely process.`);
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    throw new PdfError('unknown', `"${file.name}" could not be read. It may have been moved or deleted.`);
  }
  assertPdfBytes(bytes, file.name);
  return bytes;
}
