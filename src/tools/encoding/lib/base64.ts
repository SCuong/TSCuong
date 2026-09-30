import { bytesToBinaryString, utf8DecodeStrict, utf8Encode } from './bytes';

export interface Base64EncodeOptions {
  urlSafe: boolean;
  padding: boolean;
  /** Line length for wrapping (76 = MIME, 64 = PEM); 0 = no wrapping. */
  wrap: number;
}

export const DEFAULT_B64_OPTIONS: Base64EncodeOptions = { urlSafe: false, padding: true, wrap: 0 };

/** Standard Base64 of raw bytes (chunked so large inputs do not overflow the call stack). */
export function bytesToBase64(bytes: Uint8Array): string {
  return btoa(bytesToBinaryString(bytes));
}

export function formatBase64(b64: string, o: Partial<Base64EncodeOptions> = {}): string {
  const opts = { ...DEFAULT_B64_OPTIONS, ...o };
  let out = b64;
  if (opts.urlSafe) out = out.replace(/\+/g, '-').replace(/\//g, '_');
  if (!opts.padding) out = out.replace(/=+$/, '');
  if (opts.wrap > 0 && out.length > opts.wrap) {
    const lines: string[] = [];
    for (let i = 0; i < out.length; i += opts.wrap) lines.push(out.slice(i, i + opts.wrap));
    // MIME (RFC 2045) and PEM both use CRLF line breaks.
    out = lines.join('\r\n');
  }
  return out;
}

export function encodeBase64Text(text: string, o: Partial<Base64EncodeOptions> = {}): string {
  return formatBase64(bytesToBase64(utf8Encode(text)), o);
}

export type Base64DecodeResult = { ok: true; bytes: Uint8Array; urlSafe: boolean } | { ok: false; error: string };

const DATA_URL = /^data:([^,]*?)(;base64)?,/i;

/**
 * Decode Base64 or Base64url. Whitespace is ignored, missing padding is accepted,
 * and a leading `data:...;base64,` prefix is stripped. Returns a clear error for bad input.
 */
/** 1-based line and column of a UTF-16 offset, for error messages. */
function lineAndColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
}

/** "unexpected character "%" at position 12 (line 2, column 3)" for the first invalid Base64 character. */
export function describeBadBase64Char(input: string, offset: number): string {
  const ch = String.fromCodePoint(input.codePointAt(offset)!);
  // Invisible characters (zero-width space, controls…) are named by code point.
  const shown =
    ch === '%'
      ? '"%" (the text looks URL-encoded)'
      : /[\p{C}\p{Z}]/u.test(ch)
        ? `U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')} (an invisible character)`
        : `"${ch}"`;
  const { line, column } = lineAndColumn(input, offset);
  const where = line > 1 ? `line ${line}, column ${column}` : `position ${column}`;
  return `Invalid Base64: unexpected character ${shown} at ${where}.`;
}

export function decodeBase64(input: string): Base64DecodeResult {
  const leading = input.length - input.trimStart().length;
  let text = input.trim();
  let prefix = leading;
  const data = DATA_URL.exec(text);
  if (data) {
    if (!data[2]) return { ok: false, error: 'This data URL is not Base64-encoded (it has no ";base64" marker).' };
    text = text.slice(data[0].length);
    prefix += data[0].length;
  }
  const clean = text.replace(/[\s]+/g, '');
  if (!clean) return { ok: true, bytes: new Uint8Array(0), urlSafe: false };

  // Search the text as typed (whitespace is allowed) so the position matches what the user sees.
  const bad = /[^A-Za-z0-9+/\-_=\s]/.exec(text);
  if (bad) return { ok: false, error: describeBadBase64Char(input, prefix + bad.index) };
  const hasStd = /[+/]/.test(clean);
  const hasUrl = /[-_]/.test(clean);
  if (hasStd && hasUrl) return { ok: false, error: 'Invalid Base64: mixes the standard (+ /) and URL-safe (- _) alphabets.' };

  const firstPad = clean.indexOf('=');
  let body = clean;
  if (firstPad !== -1) {
    const pad = clean.slice(firstPad);
    if (!/^=+$/.test(pad) || pad.length > 2) {
      return { ok: false, error: 'Invalid Base64: padding "=" can only appear at the end (at most two).' };
    }
    if (clean.length % 4 !== 0) return { ok: false, error: 'Invalid Base64: padded input must have a length that is a multiple of 4.' };
    body = clean.slice(0, firstPad);
  }
  if (body.length % 4 === 1) {
    return { ok: false, error: 'Invalid Base64: the length is not valid (one character too many or missing). The text may be truncated.' };
  }
  const std = (hasUrl ? body.replace(/-/g, '+').replace(/_/g, '/') : body).padEnd(Math.ceil(body.length / 4) * 4, '=');
  let binary: string;
  try {
    binary = atob(std);
  } catch {
    return { ok: false, error: 'Invalid Base64 input.' };
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { ok: true, bytes, urlSafe: hasUrl };
}

export type Base64TextResult =
  | { ok: true; text: string; bytes: Uint8Array; urlSafe: boolean }
  | { ok: false; error: string; bytes?: Uint8Array; lossy?: string };

export function decodeBase64Text(input: string): Base64TextResult {
  const r = decodeBase64(input);
  if (!r.ok) return r;
  const text = utf8DecodeStrict(r.bytes);
  if (!text.ok) {
    return {
      ok: false,
      error: 'The Base64 decodes to binary data, not UTF-8 text. Use the Base64 File Encoder to save it as a file.',
      bytes: r.bytes,
      lossy: text.lossy,
    };
  }
  return { ok: true, text: text.text, bytes: r.bytes, urlSafe: r.urlSafe };
}

/** Exact decoded size in bytes for a Base64 string (ignores whitespace and data URL prefix). */
export function decodedSize(input: string): number {
  const clean = input.replace(DATA_URL, '').replace(/[\s=]+/g, '');
  return Math.floor((clean.length * 3) / 4);
}

export type Base64Conversion =
  | { ok: true; text: string; urlSafe: boolean }
  | { ok: false; error: string; bytes?: Uint8Array; lossy?: string };

/** Encode or decode in one call, so large texts can be processed in a worker. */
export function convertBase64(input: string, direction: 'encode' | 'decode', o: Partial<Base64EncodeOptions>): Base64Conversion {
  if (direction === 'encode') return { ok: true, text: encodeBase64Text(input, o), urlSafe: Boolean(o.urlSafe) };
  const r = decodeBase64Text(input);
  return r.ok ? { ok: true, text: r.text, urlSafe: r.urlSafe } : r;
}
