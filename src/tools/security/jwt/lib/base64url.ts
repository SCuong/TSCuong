/** Base64URL (RFC 4648 §5) analysis for JOSE compact serialization, with precise diagnostics. */

import { bytesToBase64Url, utf8 } from '../../shared-a/bytes';

const VALUES = new Int16Array(128).fill(-1);
for (let i = 0; i < 64; i++) {
  VALUES['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'.charCodeAt(i)] = i;
}
// The standard alphabet's 62/63 characters are decoded too, but reported.
VALUES['+'.charCodeAt(0)] = 62;
VALUES['/'.charCodeAt(0)] = 63;

export interface Base64UrlAnalysis {
  /** Decoded bytes, or null when the text cannot be decoded at all. */
  bytes: Uint8Array | null;
  /** First character that is not part of any Base64 alphabet. */
  invalid?: { char: string; index: number };
  /** Trailing "=" padding was present (not allowed in JWS/JWE compact form). */
  padded: boolean;
  /** "+" or "/" from standard Base64 were used instead of "-" and "_". */
  standardAlphabet: boolean;
  /** Length leaves 1 dangling character (4n+1), which no encoder produces. */
  badLength: boolean;
  /** The last character carries non-zero leftover bits (a non-canonical encoding). */
  nonCanonical: boolean;
}

/** Decodes and inspects one Base64URL segment. Never throws. */
export function analyzeBase64Url(segment: string): Base64UrlAnalysis {
  let text = segment;
  let padded = false;
  const padMatch = /=+$/.exec(text);
  if (padMatch) {
    padded = true;
    text = text.slice(0, padMatch.index);
  }
  let standardAlphabet = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const value = code < 128 ? VALUES[code] : -1;
    if (value === -1) {
      // Report the code point (not a lone surrogate) for readability.
      const char = String.fromCodePoint(text.codePointAt(i) ?? code);
      return { bytes: null, invalid: { char, index: i }, padded, standardAlphabet, badLength: false, nonCanonical: false };
    }
    if (code === 43 || code === 47) standardAlphabet = true;
  }
  if (text.length % 4 === 1) {
    return { bytes: null, padded, standardAlphabet, badLength: true, nonCanonical: false };
  }
  const out = new Uint8Array(Math.floor((text.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < text.length; i++) {
    buffer = (buffer << 6) | VALUES[text.charCodeAt(i)];
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 0xff;
    }
  }
  const leftover = bits > 0 ? buffer & ((1 << bits) - 1) : 0;
  return { bytes: out, padded, standardAlphabet, badLength: false, nonCanonical: leftover !== 0 };
}

export function encodeBase64Url(bytes: Uint8Array): string {
  return bytesToBase64Url(bytes);
}

export function encodeBase64UrlText(text: string): string {
  return bytesToBase64Url(utf8(text));
}

/** Decodes UTF-8 strictly; returns null for invalid sequences. */
export function decodeUtf8Strict(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}
