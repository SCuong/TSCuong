import { isTextFile } from './textFormats';

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

/** Decode text, honouring a BOM; invalid UTF-8 sequences become U+FFFD instead of throwing. */
export function decodeText(bytes: Uint8Array): string {
  const bom = detectBom(bytes);
  const encoding = bom?.encoding ?? 'utf-8';
  const body = bom ? bytes.subarray(bom.skip) : bytes;
  const text = new TextDecoder(encoding, { fatal: false, ignoreBOM: true }).decode(body);
  // A cut in the middle of a multi-byte sequence leaves a trailing replacement character.
  return text;
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
 * Files over `maxBytes` are not read at all (their name and path are still indexed).
 */
export async function extractText(
  file: { name: string; size: number; slice: (start?: number, end?: number) => Blob },
  maxBytes: number,
): Promise<ExtractResult> {
  if (!isTextFile(file.name)) return { status: 'not-text', text: null, truncated: false };
  if (file.size === 0) return { status: 'empty', text: '', truncated: false };
  if (file.size > maxBytes) return { status: 'too-large', text: null, truncated: false };
  const bytes = new Uint8Array(await file.slice(0, maxBytes).arrayBuffer());
  return extractFromBytes(bytes, file.size > maxBytes);
}

export function extractFromBytes(bytes: Uint8Array, truncated = false): ExtractResult {
  if (bytes.length === 0) return { status: 'empty', text: '', truncated };
  if (isBinary(bytes)) return { status: 'binary', text: null, truncated };
  return { status: 'text', text: decodeText(bytes), truncated };
}

/** 1-based line number of a character offset. */
export function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) line++;
  return line;
}
