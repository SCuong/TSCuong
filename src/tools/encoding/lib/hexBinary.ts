import { utf8DecodeStrict, utf8Encode } from './bytes';
import { t } from '@/lib/i18n';

export type HexSeparator = 'none' | 'space' | 'colon' | 'dash' | 'comma0x' | 'backslashX' | 'percent';

export const HEX_SEPARATORS: Array<{ value: HexSeparator; label: string; example: string }> = [
  { value: 'space', label: 'Space', example: '48 65 6c' },
  { value: 'none', label: t('None'), example: '48656c' },
  { value: 'colon', label: t('Colon'), example: '48:65:6c' },
  { value: 'dash', label: t('Dash'), example: '48-65-6c' },
  { value: 'comma0x', label: t('0x, list'), example: '0x48, 0x65' },
  { value: 'backslashX', label: '\\x', example: '\\x48\\x65' },
  { value: 'percent', label: '%XX', example: '%48%65' },
];

export interface HexEncodeOptions {
  separator: HexSeparator;
  uppercase: boolean;
  /** Bytes per line (0 = single line). */
  bytesPerLine: number;
}

const HEX_LOWER = Array.from({ length: 256 }, (_, b) => b.toString(16).padStart(2, '0'));
const HEX_UPPER = HEX_LOWER.map((h) => h.toUpperCase());
const BITS = Array.from({ length: 256 }, (_, b) => b.toString(2).padStart(8, '0'));

export function bytesToHex(bytes: Uint8Array, o: HexEncodeOptions): string {
  const fmt = (h: string) => (o.separator === 'comma0x' ? `0x${h}` : o.separator === 'backslashX' ? `\\x${h}` : o.separator === 'percent' ? `%${h}` : h);
  // One formatted string per byte value, looked up instead of formatted a million times.
  const table = (o.uppercase ? HEX_UPPER : HEX_LOWER).map(fmt);
  const sep = { none: '', space: ' ', colon: ':', dash: '-', comma0x: ', ', backslashX: '', percent: '' }[o.separator];
  const items = Array.from(bytes, (b) => table[b]);
  if (o.bytesPerLine > 0) {
    const lines: string[] = [];
    for (let i = 0; i < items.length; i += o.bytesPerLine) lines.push(items.slice(i, i + o.bytesPerLine).join(sep));
    return lines.join(o.separator === 'comma0x' ? ',\n' : '\n');
  }
  return items.join(sep);
}

export function textToHex(text: string, o: HexEncodeOptions): string {
  return bytesToHex(utf8Encode(text), o);
}

export type BytesResult = { ok: true; bytes: Uint8Array } | { ok: false; error: string };

/** Parse hex in any common notation: "48 65", "48:65", "0x48,0x65", "\x48\x65", "%48%65", "4865". */
export function parseHex(input: string): BytesResult {
  const cleaned = input
    .replace(/0x/gi, ' ')
    .replace(/\\x/gi, ' ')
    .replace(/%/g, ' ')
    .replace(/[\s,:;\-_|{}[\]()]+/g, ' ')
    .trim();
  if (!cleaned) return { ok: true, bytes: new Uint8Array(0) };
  const bad = /[^0-9a-fA-F ]/.exec(cleaned);
  if (bad) return { ok: false, error: `"${bad[0]}" is not a hexadecimal digit.` };
  const groups = cleaned.split(' ');
  // In code-style lists ("0x0, 0x1f") a single digit is a whole byte value; otherwise it is a typo.
  const prefixed = /0x|\\x/i.test(input);
  const digits: string[] = [];
  for (const g of groups) {
    if (g.length === 1 && prefixed) digits.push(`0${g}`);
    else if (g.length % 2 !== 0) return { ok: false, error: `"${g.length > 12 ? `${g.slice(0, 12)}…` : g}" has an odd number of hex digits, so it cannot be split into whole bytes.` };
    else for (let i = 0; i < g.length; i += 2) digits.push(g.slice(i, i + 2));
  }
  return { ok: true, bytes: Uint8Array.from(digits, (d) => parseInt(d, 16)) };
}

export type TextFromBytes = { ok: true; text: string; bytes: Uint8Array } | { ok: false; error: string; lossy?: string; bytes?: Uint8Array };

export function hexToText(input: string): TextFromBytes {
  const r = parseHex(input);
  if (!r.ok) return r;
  const t = utf8DecodeStrict(r.bytes);
  if (!t.ok) return { ok: false, error: t.error, lossy: t.lossy, bytes: r.bytes };
  return { ok: true, text: t.text, bytes: r.bytes };
}

/* ------------------------------------------------------------------------ */
/* Binary                                                                   */
/* ------------------------------------------------------------------------ */

export interface BinaryEncodeOptions {
  separator: 'space' | 'none' | 'newline';
}

export function textToBinary(text: string, o: BinaryEncodeOptions): string {
  const bits = Array.from(utf8Encode(text), (b) => BITS[b]);
  return bits.join(o.separator === 'space' ? ' ' : o.separator === 'newline' ? '\n' : '');
}

export function parseBinary(input: string): BytesResult {
  const trimmed = input.trim();
  if (!trimmed) return { ok: true, bytes: new Uint8Array(0) };
  const bad = /[^01\s,]/.exec(trimmed);
  if (bad) return { ok: false, error: `"${bad[0]}" is not a binary digit (only 0 and 1 are allowed).` };
  const groups = trimmed.split(/[\s,]+/);
  const byteStrings: string[] = [];
  if (groups.length > 1 && groups.every((g) => g.length <= 8)) {
    // Space-separated groups; short groups like "1000001" are left-padded.
    for (const g of groups) byteStrings.push(g.padStart(8, '0'));
  } else {
    const all = groups.join('');
    if (all.length % 8 !== 0) {
      return { ok: false, error: `The input has ${all.length} bits, which is not a multiple of 8. Each character byte needs exactly 8 bits.` };
    }
    for (let i = 0; i < all.length; i += 8) byteStrings.push(all.slice(i, i + 8));
  }
  return { ok: true, bytes: Uint8Array.from(byteStrings, (s) => parseInt(s, 2)) };
}

export function binaryToText(input: string): TextFromBytes {
  const r = parseBinary(input);
  if (!r.ok) return r;
  const t = utf8DecodeStrict(r.bytes);
  if (!t.ok) return { ok: false, error: t.error, lossy: t.lossy, bytes: r.bytes };
  return { ok: true, text: t.text, bytes: r.bytes };
}

/* ------------------------------------------------------------------------ */
/* One-call conversions (so large texts can be processed in a worker)       */
/* ------------------------------------------------------------------------ */

export type ConversionResult = { ok: true; text: string; bytes: number } | { ok: false; error: string; lossy?: string; bytes?: Uint8Array };

export function hexConvert(text: string, direction: 'encode' | 'decode', o: HexEncodeOptions): ConversionResult {
  if (direction === 'encode') {
    const bytes = utf8Encode(text);
    return { ok: true, text: bytesToHex(bytes, o), bytes: bytes.length };
  }
  const r = hexToText(text);
  return r.ok ? { ok: true, text: r.text, bytes: r.bytes.length } : r;
}

export function binaryConvert(text: string, direction: 'encode' | 'decode', o: BinaryEncodeOptions): ConversionResult {
  if (direction === 'encode') return { ok: true, text: textToBinary(text, o), bytes: utf8Encode(text).length };
  const r = binaryToText(text);
  return r.ok ? { ok: true, text: r.text, bytes: r.bytes.length } : r;
}
