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

export function countLines(text: string): number {
  return splitLines(text).lines.length;
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

/** Split into user-perceived characters (grapheme clusters), so emoji and combining marks stay intact. */
export function graphemes(text: string): string[] {
  if (!text) return [];
  if (!hasSegmenter()) return Array.from(text);
  graphemeSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const out: string[] = [];
  for (const s of graphemeSegmenter.segment(text)) out.push(s.segment);
  return out;
}

/** Grapheme segments with their UTF-16 offsets. */
export function graphemeSegments(text: string): Array<{ segment: string; index: number }> {
  if (!text) return [];
  if (!hasSegmenter()) {
    const out: Array<{ segment: string; index: number }> = [];
    let index = 0;
    for (const ch of text) {
      out.push({ segment: ch, index });
      index += ch.length;
    }
    return out;
  }
  graphemeSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return Array.from(graphemeSegmenter.segment(text), (s) => ({ segment: s.segment, index: s.index }));
}

export function countGraphemes(text: string): number {
  if (!text) return 0;
  if (!hasSegmenter()) return Array.from(text).length;
  graphemeSegmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  let n = 0;
  for (const _ of graphemeSegmenter.segment(text)) n++;
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
