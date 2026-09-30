/** Decoding text files in legacy encodings with the WHATWG Encoding API. */
import { detectFileType } from './magic';

export interface EncodingInfo {
  label: string;
  name: string;
  group: 'Unicode' | 'Western' | 'Central & Eastern European' | 'Cyrillic' | 'Other European' | 'East Asian' | 'Middle Eastern';
  /** True when every byte sequence decodes (so "valid" says little). */
  singleByte: boolean;
}

export const ENCODINGS: EncodingInfo[] = [
  { label: 'utf-8', name: 'UTF-8', group: 'Unicode', singleByte: false },
  { label: 'utf-16le', name: 'UTF-16 LE', group: 'Unicode', singleByte: false },
  { label: 'utf-16be', name: 'UTF-16 BE', group: 'Unicode', singleByte: false },
  { label: 'utf-32le', name: 'UTF-32 LE', group: 'Unicode', singleByte: false },
  { label: 'utf-32be', name: 'UTF-32 BE', group: 'Unicode', singleByte: false },
  { label: 'windows-1252', name: 'Windows-1252 / ISO-8859-1 (Western)', group: 'Western', singleByte: true },
  { label: 'iso-8859-15', name: 'ISO-8859-15 (Latin-9)', group: 'Western', singleByte: true },
  { label: 'macintosh', name: 'Mac OS Roman', group: 'Western', singleByte: true },
  { label: 'iso-8859-2', name: 'ISO-8859-2 (Latin-2)', group: 'Central & Eastern European', singleByte: true },
  { label: 'windows-1250', name: 'Windows-1250 (Central European)', group: 'Central & Eastern European', singleByte: true },
  { label: 'iso-8859-3', name: 'ISO-8859-3 (Latin-3)', group: 'Other European', singleByte: true },
  { label: 'iso-8859-4', name: 'ISO-8859-4 (Baltic)', group: 'Other European', singleByte: true },
  { label: 'iso-8859-13', name: 'ISO-8859-13 (Baltic)', group: 'Other European', singleByte: true },
  { label: 'windows-1257', name: 'Windows-1257 (Baltic)', group: 'Other European', singleByte: true },
  { label: 'iso-8859-14', name: 'ISO-8859-14 (Celtic)', group: 'Other European', singleByte: true },
  { label: 'iso-8859-16', name: 'ISO-8859-16 (South-Eastern European)', group: 'Other European', singleByte: true },
  { label: 'iso-8859-7', name: 'ISO-8859-7 (Greek)', group: 'Other European', singleByte: true },
  { label: 'windows-1253', name: 'Windows-1253 (Greek)', group: 'Other European', singleByte: true },
  { label: 'windows-1254', name: 'Windows-1254 (Turkish, ≈ ISO-8859-9)', group: 'Other European', singleByte: true },
  { label: 'iso-8859-10', name: 'ISO-8859-10 (Nordic)', group: 'Other European', singleByte: true },
  { label: 'iso-8859-5', name: 'ISO-8859-5 (Cyrillic)', group: 'Cyrillic', singleByte: true },
  { label: 'windows-1251', name: 'Windows-1251 (Cyrillic)', group: 'Cyrillic', singleByte: true },
  { label: 'koi8-r', name: 'KOI8-R (Russian)', group: 'Cyrillic', singleByte: true },
  { label: 'koi8-u', name: 'KOI8-U (Ukrainian)', group: 'Cyrillic', singleByte: true },
  { label: 'ibm866', name: 'IBM866 (DOS Cyrillic)', group: 'Cyrillic', singleByte: true },
  { label: 'iso-8859-6', name: 'ISO-8859-6 (Arabic)', group: 'Middle Eastern', singleByte: true },
  { label: 'windows-1256', name: 'Windows-1256 (Arabic)', group: 'Middle Eastern', singleByte: true },
  { label: 'iso-8859-8', name: 'ISO-8859-8 (Hebrew)', group: 'Middle Eastern', singleByte: true },
  { label: 'windows-1255', name: 'Windows-1255 (Hebrew)', group: 'Middle Eastern', singleByte: true },
  { label: 'shift_jis', name: 'Shift_JIS (Japanese)', group: 'East Asian', singleByte: false },
  { label: 'euc-jp', name: 'EUC-JP (Japanese)', group: 'East Asian', singleByte: false },
  { label: 'iso-2022-jp', name: 'ISO-2022-JP (Japanese)', group: 'East Asian', singleByte: false },
  { label: 'gbk', name: 'GBK (Simplified Chinese)', group: 'East Asian', singleByte: false },
  { label: 'gb18030', name: 'GB18030 (Simplified Chinese)', group: 'East Asian', singleByte: false },
  { label: 'big5', name: 'Big5 (Traditional Chinese)', group: 'East Asian', singleByte: false },
  { label: 'euc-kr', name: 'EUC-KR (Korean)', group: 'East Asian', singleByte: false },
  { label: 'windows-874', name: 'Windows-874 / ISO-8859-11 (Thai)', group: 'East Asian', singleByte: true },
  { label: 'windows-1258', name: 'Windows-1258 (Vietnamese)', group: 'East Asian', singleByte: true },
];

export type Bom = 'utf-8' | 'utf-16le' | 'utf-16be' | 'utf-32le' | 'utf-32be';

export function detectBom(bytes: Uint8Array): { bom: Bom; length: number } | null {
  const b = bytes;
  if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return { bom: 'utf-8', length: 3 };
  if (b[0] === 0xff && b[1] === 0xfe && b[2] === 0x00 && b[3] === 0x00) return { bom: 'utf-32le', length: 4 };
  if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0xfe && b[3] === 0xff) return { bom: 'utf-32be', length: 4 };
  if (b[0] === 0xff && b[1] === 0xfe) return { bom: 'utf-16le', length: 2 };
  if (b[0] === 0xfe && b[1] === 0xff) return { bom: 'utf-16be', length: 2 };
  return null;
}

/** UTF-32 is not part of the WHATWG Encoding standard, so browsers cannot decode it; we can. */
const UTF32 = new Set(['utf-32le', 'utf-32be']);

export function isSupported(label: string): boolean {
  if (UTF32.has(label)) return true;
  try {
    new TextDecoder(label);
    return true;
  } catch {
    return false;
  }
}

/** Decode UTF-32; invalid code points and a trailing partial unit become U+FFFD and make the result invalid. */
export function decodeUtf32(bytes: Uint8Array, littleEndian: boolean, stripBom = true): { text: string; valid: boolean } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const units = Math.floor(bytes.length / 4);
  let valid = bytes.length % 4 === 0;
  const parts: string[] = [];
  let chunk: number[] = [];
  for (let i = 0; i < units; i++) {
    const cp = view.getUint32(i * 4, littleEndian);
    if (i === 0 && stripBom && cp === 0xfeff) continue;
    if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      valid = false;
      chunk.push(0xfffd);
    } else chunk.push(cp);
    if (chunk.length >= 8192) {
      parts.push(String.fromCodePoint(...chunk));
      chunk = [];
    }
  }
  if (bytes.length % 4) chunk.push(0xfffd);
  parts.push(String.fromCodePoint(...chunk));
  return { text: parts.join(''), valid };
}

export interface DecodeAttempt {
  encoding: EncodingInfo;
  /** False when the decoder found byte sequences that are invalid in this encoding. */
  valid: boolean;
  text: string;
  /** Count of U+FFFD replacement characters in the lossy decode. */
  replacements: number;
  /** Heuristic 0–100: higher means the text looks more like real text. */
  score: number;
}

const JAPANESE = new Set(['shift_jis', 'euc-jp', 'iso-2022-jp']);
const CHINESE = new Set(['gbk', 'gb18030', 'big5']);

/** Popularity order used to break ties between equally plausible decodings. */
const PRIOR = ['utf-8', 'windows-1252', 'shift_jis', 'gbk', 'windows-1251', 'big5', 'euc-kr', 'windows-1250', 'euc-jp', 'gb18030', 'iso-8859-2', 'koi8-r'];

function isGoodNonAscii(cp: number, ch: string): boolean {
  if (cp >= 0x80 && cp < 0xa0) return false; // C1 controls
  if (cp >= 0xff61 && cp <= 0xff9f) return false; // half-width katakana: rare, typical of misdecoded CJK
  if (cp >= 0x2500 && cp <= 0x259f) return false; // box drawing / blocks: typical of misdecoded text
  if ((cp >= 0xe000 && cp <= 0xf8ff) || cp === 0xfffd) return false;
  if (cp === 0x02c6 || cp === 0x02dc) return false; // modifier circumflex / tilde from Windows-1252 0x88 / 0x98
  if (/[\p{L}\p{M}\p{N}]/u.test(ch)) return true;
  if (cp >= 0xa0 && cp <= 0xbf) return true; // Latin-1 punctuation and symbols (© ° « » ¿ …)
  if (cp >= 0x2010 && cp <= 0x2027) return true; // dashes, curly quotes, bullet, ellipsis
  if (cp === 0x20ac || cp === 0x2122) return true; // € ™
  if (cp >= 0x3000 && cp <= 0x303f) return true; // CJK punctuation
  if (cp >= 0xff01 && cp <= 0xff5e) return true; // full-width ASCII
  return false;
}

function scriptGroup(ch: string): string | null {
  if (/\p{Script=Latin}/u.test(ch)) return 'Latin';
  if (/\p{Script=Cyrillic}/u.test(ch)) return 'Cyrillic';
  if (/\p{Script=Greek}/u.test(ch)) return 'Greek';
  if (/\p{Script=Arabic}/u.test(ch)) return 'Arabic';
  if (/\p{Script=Hebrew}/u.test(ch)) return 'Hebrew';
  if (/\p{Script=Thai}/u.test(ch)) return 'Thai';
  if (/\p{Script=Hangul}/u.test(ch)) return 'Hangul';
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(ch)) return 'CJK';
  return null;
}

/** Characters that follow Ã, Â, â… when UTF-8 bytes are decoded as Windows-1252 or Latin-1. */
function isContinuationLookalike(cp: number): boolean {
  return (
    (cp >= 0x80 && cp <= 0xbf) ||
    [0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178].includes(cp)
  );
}

const isNonAsciiLetter = (cp: number | undefined) => cp !== undefined && cp >= 0xc0 && /\p{L}/u.test(String.fromCodePoint(cp));
const isAsciiLetter =(cp: number | undefined) => cp !== undefined && ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a));

/**
 * Heuristic score (higher = more like real text) based on the non-ASCII characters:
 * letters, common punctuation and a single script score high; control characters, box drawing,
 * half-width katakana, UTF-8 mojibake pairs (Ã©), runs of accented Latin letters, and CJK characters
 * glued to ASCII letters score low. Japanese decodings need kana to win.
 */
export function plausibility(text: string, label = ''): number {
  if (!text) return 0;
  const cps = Array.from(text, (c) => c.codePointAt(0)!);
  let nonAscii = 0;
  let good = 0;
  let controls = 0;
  let kana = 0;
  let cjk = 0;
  let nonLatin = 0;
  let glued = 0;
  let mojibake = 0;
  let latinRuns = 0;
  const groupCounts = new Map<string, number>();
  for (let i = 0; i < cps.length; i++) {
    const cp = cps[i];
    if (cp < 0x80) {
      if (cp < 0x20 && cp !== 9 && cp !== 10 && cp !== 13) controls++;
      continue;
    }
    const ch = String.fromCodePoint(cp);
    nonAscii++;
    if (isGoodNonAscii(cp, ch)) good++;
    if ((cp >= 0x3040 && cp <= 0x30ff) || (cp >= 0x31f0 && cp <= 0x31ff)) kana++;
    const group = scriptGroup(ch);
    if (group) groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1);
    if (group === 'CJK') cjk++;
    // Letters of another script glued to ASCII letters ("Grьяe", "Gr郞e") are a strong sign of a wrong decode.
    if (group && group !== 'Latin') {
      nonLatin++;
      if (isAsciiLetter(cps[i - 1]) || isAsciiLetter(cps[i + 1])) glued++;
    }
    // Three or more accented Latin letters in a row are rare in European languages.
    if (group === 'Latin' && isNonAsciiLetter(cps[i - 1]) && isNonAsciiLetter(cps[i - 2])) latinRuns++;
    if ((cp === 0xc2 || cp === 0xc3 || cp === 0xc5 || cp === 0xe2) && i + 1 < cps.length && isContinuationLookalike(cps[i + 1])) mojibake++;
  }
  if (nonAscii === 0) return controls ? Math.max(0, 100 - controls * 5) : 100;
  let score = (good / nonAscii) * 100;
  score -= Math.max(0, groupCounts.size - 1) * 20;
  score -= Math.min(50, controls * 5);
  score -= (mojibake * 2 * 100) / nonAscii;
  const dominant = Array.from(groupCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
  if (dominant === 'Latin') score -= (latinRuns / nonAscii) * 70;
  if (nonLatin) score -= (glued / nonLatin) * 60;
  if (JAPANESE.has(label) && cjk >= 5) score += kana / cjk > 0.05 ? 5 : -10;
  if (CHINESE.has(label) && kana > 0) score -= 10;
  return Math.max(0, Math.round(score));
}

function prior(label: string): number {
  const i = PRIOR.indexOf(label);
  return i === -1 ? PRIOR.length : i;
}

/** Valid decodings, most plausible first. */
export function rankAttempts(attempts: DecodeAttempt[]): DecodeAttempt[] {
  return attempts
    .filter((a) => a.valid)
    .slice()
    .sort((a, b) => b.score - a.score || prior(a.encoding.label) - prior(b.encoding.label));
}

export function decodeAs(bytes: Uint8Array, encoding: EncodingInfo, stripBom = true): DecodeAttempt {
  let valid = true;
  let text: string;
  if (UTF32.has(encoding.label)) {
    ({ text, valid } = decodeUtf32(bytes, encoding.label === 'utf-32le', stripBom));
  } else {
    try {
      text = new TextDecoder(encoding.label, { fatal: true, ignoreBOM: !stripBom }).decode(bytes);
    } catch {
      valid = false;
      text = new TextDecoder(encoding.label, { ignoreBOM: !stripBom }).decode(bytes);
    }
  }
  let replacements = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 0xfffd) replacements++;
  return { encoding, valid, text, replacements, score: valid ? plausibility(text.slice(0, 20000), encoding.label) : 0 };
}

/** Try every supported encoding on a sample of the bytes. */
export function tryAllEncodings(bytes: Uint8Array, sampleSize = 64 * 1024): DecodeAttempt[] {
  const sample = bytes.subarray(0, sampleSize);
  return ENCODINGS.filter((e) => isSupported(e.label)).map((e) => {
    const attempt = decodeAs(sample, e);
    // A multi-byte sequence may be cut at the end of the sample; retry without the last few bytes.
    if (!attempt.valid && sample.length < bytes.length) {
      const retry = decodeAs(sample.subarray(0, Math.max(0, sample.length - 4)), e);
      if (retry.valid) return { ...retry, text: attempt.text };
    }
    return attempt;
  });
}

/** Best guess: BOM first, then valid UTF-8, then the most plausible valid decoding. */
export function guessEncoding(bytes: Uint8Array, attempts: DecodeAttempt[]): string {
  const bom = detectBom(bytes);
  if (bom) return bom.bom;
  // UTF-16/UTF-32 without BOM: zero bytes at regular positions (checked first: NUL bytes are valid UTF-8).
  const n = Math.min(bytes.length, 4096);
  const zerosAt = [0, 0, 0, 0];
  for (let i = 0; i < n; i++) if (bytes[i] === 0) zerosAt[i % 4]++;
  const quarter = n / 4;
  if (n >= 16 && bytes.length % 4 === 0) {
    // Mostly-ASCII UTF-32: three zero bytes in every four.
    if (zerosAt[1] > quarter * 0.9 && zerosAt[2] > quarter * 0.9 && zerosAt[3] > quarter * 0.9 && zerosAt[0] < quarter * 0.1) return 'utf-32le';
    if (zerosAt[0] > quarter * 0.9 && zerosAt[1] > quarter * 0.9 && zerosAt[2] > quarter * 0.9 && zerosAt[3] < quarter * 0.1) return 'utf-32be';
  }
  const evenZeros = zerosAt[0] + zerosAt[2];
  const oddZeros = zerosAt[1] + zerosAt[3];
  if (n > 8 && oddZeros > n / 4 && evenZeros < n / 50) return 'utf-16le';
  if (n > 8 && evenZeros > n / 4 && oddZeros < n / 50) return 'utf-16be';
  const utf8 = attempts.find((a) => a.encoding.label === 'utf-8');
  if (utf8?.valid) return 'utf-8';
  const ranked = rankAttempts(attempts.filter((a) => a.encoding.group !== 'Unicode'));
  return ranked[0]?.encoding.label ?? 'windows-1252';
}

export type OutputEncoding = 'utf-8' | 'utf-8-bom' | 'utf-16le-bom' | 'utf-16be-bom';

/** Encode text for download. Only Unicode encodings can be produced in the browser. */
export function encodeOutput(text: string, enc: OutputEncoding): Uint8Array {
  if (enc === 'utf-8' || enc === 'utf-8-bom') {
    const body = new TextEncoder().encode(text);
    if (enc === 'utf-8') return body;
    const out = new Uint8Array(body.length + 3);
    out.set([0xef, 0xbb, 0xbf]);
    out.set(body, 3);
    return out;
  }
  const le = enc === 'utf-16le-bom';
  const out = new Uint8Array(2 + text.length * 2);
  out.set(le ? [0xff, 0xfe] : [0xfe, 0xff]);
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    const hi = unit >> 8;
    const lo = unit & 0xff;
    out[2 + i * 2] = le ? lo : hi;
    out[3 + i * 2] = le ? hi : lo;
  }
  return out;
}

const reverseTables = new Map<string, Map<string, number>>();

/** Character → byte table for a single-byte encoding, built from the browser's own decoder. */
function reverseTable(label: string): Map<string, number> {
  let table = reverseTables.get(label);
  if (!table) {
    table = new Map();
    const decoder = new TextDecoder(label);
    for (let b = 0; b < 256; b++) {
      const ch = decoder.decode(new Uint8Array([b]));
      if (ch !== '�' && !table.has(ch)) table.set(ch, b);
    }
    reverseTables.set(label, table);
  }
  return table;
}

export type ReencodeResult = { ok: true; bytes: Uint8Array } | { ok: false; error: string };

/**
 * Turn text back into the bytes a single-byte encoding would have produced. Used to repair
 * mojibake: text that was decoded with the wrong encoding (e.g. UTF-8 read as Windows-1252).
 */
export function encodeSingleByte(text: string, label: string): ReencodeResult {
  const table = reverseTable(label);
  const out = new Uint8Array(text.length);
  let n = 0;
  let index = 0;
  for (const ch of text) {
    const b = table.get(ch);
    if (b === undefined) {
      return { ok: false, error: `“${ch}” (position ${index + 1}) cannot come from ${label}, so the text was not decoded with that encoding.` };
    }
    out[n++] = b;
    index += ch.length;
  }
  return { ok: true, bytes: out.subarray(0, n) };
}

export type RepairResult = { ok: true; text: string } | { ok: false; error: string };

/** Re-interpret garbled text: encode with the wrong encoding, decode with the right one. */
export function repairMojibake(text: string, wrongLabel: string, rightLabel: string): RepairResult {
  const bytes = encodeSingleByte(text, wrongLabel);
  if (!bytes.ok) return bytes;
  try {
    return { ok: true, text: new TextDecoder(rightLabel, { fatal: true }).decode(bytes.bytes) };
  } catch {
    return { ok: false, error: `The recovered bytes are not valid ${rightLabel}. Try another pair of encodings.` };
  }
}

/**
 * A warning when the bytes look like binary data rather than text in any encoding: text files
 * (single-byte or East Asian) almost never contain C0 control bytes other than tab, line breaks,
 * form feed and ESC. UTF-16/32 files are expected to contain NUL bytes and are not flagged.
 */
export function binaryFileWarning(bytes: Uint8Array, guess: string): string | null {
  if (bytes.length === 0 || detectBom(bytes) || guess.startsWith('utf-16') || guess.startsWith('utf-32')) return null;
  const sample = bytes.subarray(0, 8192);
  let controls = 0;
  for (const b of sample) if (b < 0x09 || (b > 0x0d && b < 0x20 && b !== 0x1b)) controls++;
  if (controls === 0 || controls / sample.length < 0.01) return null;
  const type = detectFileType(bytes.subarray(0, 4100));
  const what = type && !type.weak ? `binary data (${type.label})` : 'binary data';
  return `This file looks like ${what}, not text. Converting it to UTF-8 would damage it.`;
}
