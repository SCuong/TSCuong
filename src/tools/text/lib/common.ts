/** Shared helpers for text tools: line splitting, graphemes and words. */

export type Eol = '\n' | '\r\n' | '\r';

export interface SplitResult {
  lines: string[];
  /** True when the text ended with a line break (the empty last "line" is not included in `lines`). */
  trailingNewline: boolean;
  /** The most common line ending in the input (LF when there is none). */
  eol: Eol;
}

/** Split text into lines on LF, CRLF or CR. An empty string has zero lines. */
export function splitLines(text: string): SplitResult {
  if (text === '') return { lines: [], trailingNewline: false, eol: '\n' };
  const lines = text.split(/\r\n|\r|\n/);
  const trailingNewline = lines.length > 1 && lines[lines.length - 1] === '';
  if (trailingNewline) lines.pop();
  return { lines, trailingNewline, eol: detectEol(text) };
}

/** Join lines back, restoring a trailing line break when the input had one. */
export function joinLines(lines: string[], eol: Eol = '\n', trailingNewline = false): string {
  if (lines.length === 0) return '';
  return lines.join(eol) + (trailingNewline ? eol : '');
}

export function detectEol(text: string): Eol {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        crlf++;
        i++;
      } else cr++;
    } else if (c === 10) lf++;
  }
  if (crlf > lf && crlf >= cr) return '\r\n';
  if (cr > lf && cr > crlf) return '\r';
  return '\n';
}

/** Number of lines (same as `splitLines(text).lines.length`), counted without allocating. */
export function countLines(text: string): number {
  const n = text.length;
  if (n === 0) return 0;
  let breaks = 0;
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === 10) breaks++;
    else if (c === 13) {
      breaks++;
      if (text.charCodeAt(i + 1) === 10) i++;
    }
  }
  const last = text.charCodeAt(n - 1);
  // A final line break ends the last line instead of starting a new one.
  return breaks + 1 - (last === 10 || last === 13 ? 1 : 0);
}

/** Number of code points (lone surrogates count as one), counted without allocating. */
export function countCodePoints(text: string): number {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) i++;
    }
    n++;
  }
  return n;
}

/** Apply a function to every line, keeping line endings and the trailing newline. */
export function mapLines(text: string, fn: (line: string, index: number) => string): string {
  const { lines, trailingNewline, eol } = splitLines(text);
  return joinLines(lines.map(fn), eol, trailingNewline);
}

let graphemeSegmenter: Intl.Segmenter | null = null;
let wordSegmenter: Intl.Segmenter | null = null;
let sentenceSegmenter: Intl.Segmenter | null = null;

function hasSegmenter(): boolean {
  return typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function';
}

/*
 * Grapheme clusters (UAX #29). Code units below U+0300 are never Extend, SpacingMark, Prepend,
 * ZWJ, regional indicators or Hangul, so between two of them there is always a boundary (except
 * CR LF). Runs of such "simple" text are split without Intl.Segmenter, which is slow per call;
 * only the regions around other characters (accents, emoji, CJK…) go through the segmenter.
 * The result is identical to segmenting the whole string, just much faster on mostly-Latin text.
 */
const SIMPLE_LIMIT = 0x300;

/** End (exclusive) of the complex region starting at `start`: the next guaranteed boundary. */
function complexRegionEnd(text: string, start: number): number {
  let j = start + 1;
  while (j < text.length) {
    const prev = text.charCodeAt(j - 1);
    const cur = text.charCodeAt(j);
    if (prev < SIMPLE_LIMIT && cur < SIMPLE_LIMIT && !(prev === 13 && cur === 10)) break;
    j++;
  }
  return j;
}

/** Visit every grapheme cluster with its UTF-16 offset. */
export function forEachGrapheme(text: string, visit: (segment: string, index: number) => void) {
  const n = text.length;
  if (!hasSegmenter()) {
    let index = 0;
    for (const ch of text) {
      visit(ch, index);
      index += ch.length;
    }
    return;
  }
  graphemeSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let i = 0;
  while (i < n) {
    const c = text.charCodeAt(i);
    const next = i + 1 < n ? text.charCodeAt(i + 1) : 0;
    if (c < SIMPLE_LIMIT && next < SIMPLE_LIMIT) {
      if (c === 13 && next === 10) {
        visit('\r\n', i);
        i += 2;
      } else {
        visit(text[i], i);
        i++;
      }
      continue;
    }
    const end = complexRegionEnd(text, i);
    for (const s of graphemeSegmenter.segment(text.slice(i, end))) visit(s.segment, i + s.index);
    i = end;
  }
}

/** Split into user-perceived characters (grapheme clusters), so emoji and combining marks stay intact. */
export function graphemes(text: string): string[] {
  const out: string[] = [];
  const n = text.length;
  if (!n) return out;
  if (!hasSegmenter()) return Array.from(text);
  graphemeSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let i = 0;
  while (i < n) {
    const c = text.charCodeAt(i);
    const next = i + 1 < n ? text.charCodeAt(i + 1) : 0;
    if (c < SIMPLE_LIMIT && next < SIMPLE_LIMIT) {
      if (c === 13 && next === 10) {
        out.push('\r\n');
        i += 2;
      } else {
        out.push(text[i]);
        i++;
      }
      continue;
    }
    const end = complexRegionEnd(text, i);
    for (const s of graphemeSegmenter.segment(text.slice(i, end))) out.push(s.segment);
    i = end;
  }
  return out;
}

/** Grapheme segments with their UTF-16 offsets. */
export function graphemeSegments(text: string): Array<{ segment: string; index: number }> {
  const out: Array<{ segment: string; index: number }> = [];
  if (text) forEachGrapheme(text, (segment, index) => out.push({ segment, index }));
  return out;
}

export function countGraphemes(text: string): number {
  if (!text) return 0;
  if (!hasSegmenter()) return countCodePoints(text);
  let simple = true;
  let crlf = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= SIMPLE_LIMIT) {
      simple = false;
      break;
    }
    if (c === 13 && text.charCodeAt(i + 1) === 10) crlf++;
  }
  if (simple) return text.length - crlf;
  let n = 0;
  forEachGrapheme(text, () => n++);
  return n;
}

export interface WordToken {
  word: string;
  index: number;
}

const FALLBACK_WORD = /[\p{L}\p{N}\p{M}]+(?:['’][\p{L}\p{N}\p{M}]+)*/gu;

/** Word-like segments (letters/numbers, including CJK words and contractions like "don't"). */
export function words(text: string): WordToken[] {
  if (!text) return [];
  if (!hasSegmenter()) {
    return Array.from(text.matchAll(FALLBACK_WORD), (m) => ({ word: m[0], index: m.index ?? 0 }));
  }
  wordSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'word' });
  const out: WordToken[] = [];
  for (const s of wordSegmenter.segment(text)) {
    if (s.isWordLike) out.push({ word: s.segment, index: s.index });
  }
  return out;
}

/** Sentence segments that contain at least one letter or number. */
export function sentences(text: string): string[] {
  if (!text.trim()) return [];
  if (!hasSegmenter()) {
    return text.split(/(?<=[.!?…])\s+/u).filter((s) => /[\p{L}\p{N}]/u.test(s));
  }
  sentenceSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'sentence' });
  const out: string[] = [];
  for (const s of sentenceSegmenter.segment(text)) {
    if (/[\p{L}\p{N}]/u.test(s.segment)) out.push(s.segment);
  }
  return out;
}

/** Number of UTF-8 bytes needed for a string, computed without allocating. Lone surrogates count as U+FFFD (3 bytes). */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * Case-insensitive comparison key. Uppercasing first applies the full Unicode case mappings,
 * so "Straße" and "STRASSE", or "ǅ" and "ǆ", get the same key (plain toLowerCase does not).
 */
export function foldCase(text: string): string {
  return text.toUpperCase().toLowerCase();
}

/** Remap a UTF-16 code unit so that comparing remapped units orders strings by code point. */
function codePointOrderUnit(u: number): number {
  if (u < 0xd800) return u;
  return u >= 0xe000 ? u - 0x800 : u + 0x2000;
}

/**
 * Compare by Unicode code point (like Python or Rust), not by UTF-16 code unit (like JavaScript's
 * `<`): an emoji (U+1F600) sorts after "～" (U+FF5E).
 */
export function compareCodePoints(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a.charCodeAt(i);
    const y = b.charCodeAt(i);
    if (x !== y) return codePointOrderUnit(x) - codePointOrderUnit(y);
  }
  return a.length - b.length;
}

/**
 * Combining accents used by Latin, Greek and Cyrillic (the Combining Diacritical Marks blocks).
 * Deliberately narrower than \p{Mn}: Devanagari vowel signs and viramas, Hebrew points, Japanese
 * voicing marks (が = か + \u3099) and emoji variation selectors are nonspacing marks too, but removing
 * them changes or breaks the text.
 */
export const DIACRITIC_MARKS = /[\u0300-\u036f\u1dc0-\u1dff\ufe20-\ufe2f\u1ab0-\u1aff]/g;

/** "Crème brûlée" → "Creme brulee" without touching other scripts or emoji. */
export function stripDiacritics(text: string): string {
  return text.normalize('NFD').replace(DIACRITIC_MARKS, '').normalize('NFC');
}

export function escapeRegExp(text: string): string {
  // Only syntax characters (and "/"), so the result is valid with and without the `u` flag.
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** Unbiased random integer in [0, max) using the Web Crypto API. */
export function secureRandomInt(max: number): number {
  if (max <= 1) return 0;
  const limit = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

/** Fisher–Yates shuffle with crypto randomness (returns a new array). */
export function secureShuffle<T>(items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Make whitespace characters visible for display in tables. */
export function visibleChar(ch: string): string {
  switch (ch) {
    case ' ':
      return '␠';
    case '\n':
      return '↵';
    case '\r':
      return '␍';
    case '\r\n':
      return '␍↵';
    case '\t':
      return '⇥';
    case '\u00a0':
      return '⍽';
    default:
      return ch;
  }
}

export function codePointLabel(text: string): string {
  return Array.from(text, (c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`).join(' ');
}

/** Name for common whitespace/invisible characters, for table labels. */
export function whitespaceName(ch: string): string | null {
  const names: Record<string, string> = {
    ' ': 'Space',
    '\n': 'Line feed',
    '\r': 'Carriage return',
    '\r\n': 'CRLF line break',
    '\t': 'Tab',
    '\u00a0': 'No-break space',
    '\u200b': 'Zero-width space',
    '\u3000': 'Ideographic space',
    '\u2009': 'Thin space',
    '\u202f': 'Narrow no-break space',
  };
  return names[ch] ?? null;
}
