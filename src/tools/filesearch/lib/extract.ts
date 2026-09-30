import { isKnownBinaryFile, isTextFile } from './textFormats';

/** Bytes inspected for the NUL-byte binary check. */
export const BINARY_SNIFF_BYTES = 8192;

export type Encoding = 'utf-8' | 'utf-16le' | 'utf-16be';

export function detectBom(bytes: Uint8Array): { encoding: Encoding; skip: number } | null {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { encoding: 'utf-8', skip: 3 };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { encoding: 'utf-16le', skip: 2 };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { encoding: 'utf-16be', skip: 2 };
  return null;
}

/** A file is binary when its first bytes contain a NUL byte (UTF-16 files with a BOM are not). */
export function isBinary(bytes: Uint8Array, sniff = BINARY_SNIFF_BYTES): boolean {
  const bom = detectBom(bytes);
  if (bom && bom.encoding !== 'utf-8') return false;
  const len = Math.min(sniff, bytes.length);
  for (let i = 0; i < len; i++) if (bytes[i] === 0) return true;
  return false;
}

/**
 * Decode text, honouring a BOM. Without one, UTF-8 is tried first; bytes that
 * are not valid UTF-8 are decoded as Windows-1252 (the usual encoding of older
 * Western files), so "café" in a Latin-1 file stays searchable instead of
 * losing the é to a replacement character.
 */
export function decodeText(bytes: Uint8Array): string {
  const bom = detectBom(bytes);
  if (bom) return new TextDecoder(bom.encoding, { fatal: false, ignoreBOM: true }).decode(bytes.subarray(bom.skip));
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/**
 * Content check for files whose extension says nothing: no NUL bytes and few
 * control characters in the first bytes. Used to find text in unlisted
 * formats such as .gradle, .jsonl or .cmake.
 */
export function looksLikeText(bytes: Uint8Array): boolean {
  if (detectBom(bytes)) return true;
  const len = Math.min(bytes.length, BINARY_SNIFF_BYTES);
  let control = 0;
  for (let i = 0; i < len; i++) {
    const b = bytes[i];
    if (b === 0) return false;
    // Tab, LF, VT, FF and CR are normal in text; other C0 controls are not.
    if (b < 32 && (b < 9 || b > 13) && b !== 27) control++;
  }
  return len === 0 || control / len < 0.05;
}

export type ExtractStatus = 'text' | 'binary' | 'too-large' | 'not-text' | 'empty';

export interface ExtractResult {
  status: ExtractStatus;
  text: string | null;
  /** True when only the first `maxBytes` were read. */
  truncated: boolean;
}

/**
 * Decide whether a file's content should be indexed and extract its text.
 * Known text formats are read; known binary formats (images, archives,
 * Office files …) are indexed by name only; anything else is read when its
 * first bytes look like text. Files over `maxBytes` are not read at all
 * (their name and path are still indexed).
 */
export async function extractText(
  file: { name: string; size: number; slice: (start?: number, end?: number) => Blob },
  maxBytes: number,
): Promise<ExtractResult> {
  const known = isTextFile(file.name);
  if (!known && isKnownBinaryFile(file.name)) return { status: 'not-text', text: null, truncated: false };
  if (file.size === 0) return known ? { status: 'empty', text: '', truncated: false } : { status: 'not-text', text: null, truncated: false };
  if (file.size > maxBytes) return { status: known ? 'too-large' : 'not-text', text: null, truncated: false };
  if (!known) {
    const head = new Uint8Array(await file.slice(0, BINARY_SNIFF_BYTES).arrayBuffer());
    if (!looksLikeText(head)) return { status: 'binary', text: null, truncated: false };
  }
  const bytes = new Uint8Array(await file.slice(0, maxBytes).arrayBuffer());
  return extractFromBytes(bytes, file.size > maxBytes);
}

export function extractFromBytes(bytes: Uint8Array, truncated = false): ExtractResult {
  if (bytes.length === 0) return { status: 'empty', text: '', truncated };
  if (isBinary(bytes)) return { status: 'binary', text: null, truncated };
  return { status: 'text', text: decodeText(bytes), truncated };
}
