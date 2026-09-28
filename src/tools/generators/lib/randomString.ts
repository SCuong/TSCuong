import { RandomReader, randomFromAlphabet, symbols } from './random';

export type CharsetId = 'alphanumeric' | 'alnumSymbols' | 'letters' | 'lower' | 'upper' | 'digits' | 'hex' | 'base58' | 'symbols' | 'custom';

const LOWER = 'abcdefghijklmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';

export const CHARSETS: Array<{ id: CharsetId; label: string; chars: string }> = [
  { id: 'alphanumeric', label: 'Alphanumeric', chars: UPPER + LOWER + DIGITS },
  { id: 'alnumSymbols', label: 'Alphanumeric + symbols', chars: UPPER + LOWER + DIGITS + SYMBOLS },
  { id: 'letters', label: 'Letters (A–Z, a–z)', chars: UPPER + LOWER },
  { id: 'lower', label: 'Lowercase letters', chars: LOWER },
  { id: 'upper', label: 'Uppercase letters', chars: UPPER },
  { id: 'digits', label: 'Digits (0–9)', chars: DIGITS },
  { id: 'hex', label: 'Hex (0–9, a–f)', chars: '0123456789abcdef' },
  { id: 'base58', label: 'Base58 (Bitcoin)', chars: '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz' },
  { id: 'symbols', label: 'Symbols only', chars: SYMBOLS },
  { id: 'custom', label: 'Custom…', chars: '' },
];

/** Characters that are easy to confuse when read or typed. */
export const AMBIGUOUS = new Set(['0', 'O', 'o', '1', 'l', 'L', 'I', 'i', '|']);

export type AlphabetResult = { ok: true; alphabet: string[] } | { ok: false; error: string };

/** Build the unique symbol list for a charset (custom text is de-duplicated, preserving order). */
export function buildAlphabet(id: CharsetId, custom: string, excludeAmbiguous: boolean): AlphabetResult {
  const source = id === 'custom' ? custom : (CHARSETS.find((c) => c.id === id)?.chars ?? '');
  const unique = [...new Set(symbols(source))];
  const list = excludeAmbiguous ? unique.filter((c) => !AMBIGUOUS.has(c)) : unique;
  if (id === 'custom' && unique.length === 0) return { ok: false, error: 'Type the characters to draw from.' };
  if (list.length < 2) {
    return { ok: false, error: 'The character set needs at least 2 distinct characters' + (excludeAmbiguous ? ' after removing look-alikes.' : '.') };
  }
  return { ok: true, alphabet: list };
}

export function generateStrings(alphabet: readonly string[], length: number, count: number, reader = new RandomReader()): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(randomFromAlphabet(alphabet, length, reader));
  return out;
}

// ---------------------------------------------------------------------------
// Bytes
// ---------------------------------------------------------------------------

export type ByteEncoding = 'hex' | 'base64' | 'base64url' | 'array';

export function bytesToHex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function encodeBytes(bytes: Uint8Array, encoding: ByteEncoding): string {
  switch (encoding) {
    case 'hex':
      return bytesToHex(bytes);
    case 'base64':
      return bytesToBase64(bytes);
    case 'base64url':
      return bytesToBase64Url(bytes);
    case 'array':
      return `[${Array.from(bytes).join(', ')}]`;
  }
}
