import { countGraphemes, words } from './common';
import { ENGLISH_STOP_WORDS } from './frequency';

export interface Position {
  start: number;
  end: number;
  line: number;
  column: number;
}

export interface ConsecutiveDuplicate {
  word: string;
  /** The repeated occurrence (the one you would delete). */
  position: Position;
  /** The first occurrence it repeats. */
  first: Position;
}

export interface RepeatedWord {
  word: string;
  count: number;
  positions: Position[];
}

/** Offsets where lines start (LF, CRLF and old Mac CR line endings). */
function lineIndex(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10 || (c === 13 && text.charCodeAt(i + 1) !== 10)) starts.push(i + 1);
  }
  return starts;
}

/** Positions kept per repeated word (enough to highlight; the count stays exact). */
export const MAX_POSITIONS = 5_001;

function locate(starts: number[], offset: number): { line: number; column: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - starts[lo] + 1 };
}

export interface DuplicateWordOptions {
  caseSensitive: boolean;
  /** Only whitespace may separate a consecutive duplicate (so "that, that" is not flagged). */
  whitespaceOnly: boolean;
  /** For the repeated-words list. */
  excludeStopWords: boolean;
  minLength: number;
}

export const DEFAULT_DUPLICATE_OPTIONS: DuplicateWordOptions = {
  caseSensitive: false,
  whitespaceOnly: true,
  excludeStopWords: true,
  minLength: 3,
};

export interface DuplicateWordResult {
  consecutive: ConsecutiveDuplicate[];
  repeated: RepeatedWord[];
  totalWords: number;
}

export function findDuplicateWords(text: string, opts: Partial<DuplicateWordOptions> = {}): DuplicateWordResult {
  const o = { ...DEFAULT_DUPLICATE_OPTIONS, ...opts };
  const starts = lineIndex(text);
  const tokens = words(text).filter((w) => /[\p{L}\p{N}]/u.test(w.word));
  const key = (w: string) => (o.caseSensitive ? w : w.toLowerCase());
  const pos = (start: number, word: string): Position => ({ start, end: start + word.length, ...locate(starts, start) });

  const consecutive: ConsecutiveDuplicate[] = [];
  for (let i = 1; i < tokens.length; i++) {
    const prev = tokens[i - 1];
    const cur = tokens[i];
    if (key(prev.word) !== key(cur.word)) continue;
    const between = text.slice(prev.index + prev.word.length, cur.index);
    if (o.whitespaceOnly ? !/^\s+$/u.test(between) : !/^[\s\p{P}]*$/u.test(between)) continue;
    // Numbers like "1 1" and single letters in lists are usually intentional; words only.
    if (!/\p{L}/u.test(cur.word)) continue;
    consecutive.push({ word: cur.word, position: pos(cur.index, cur.word), first: pos(prev.index, prev.word) });
  }

  const map = new Map<string, RepeatedWord>();
  for (const t of tokens) {
    if (!/\p{L}/u.test(t.word)) continue;
    const lower = t.word.toLowerCase();
    if (o.excludeStopWords && ENGLISH_STOP_WORDS.has(lower.replace(/’/g, "'"))) continue;
    if (countGraphemes(t.word) < o.minLength) continue;
    const k = key(t.word);
    let entry = map.get(k);
    if (!entry) {
      entry = { word: o.caseSensitive ? t.word : lower, count: 0, positions: [] };
      map.set(k, entry);
    }
    entry.count++;
    if (entry.positions.length < MAX_POSITIONS) entry.positions.push(pos(t.index, t.word));
  }
  const compare = new Intl.Collator().compare;
  const repeated = Array.from(map.values())
    .filter((e) => e.count > 1)
    .sort((a, b) => b.count - a.count || compare(a.word, b.word));

  return { consecutive, repeated, totalWords: tokens.length };
}

/** Remove the second word (and the whitespace before it) of every consecutive duplicate. */
export function removeConsecutiveDuplicates(text: string, dups: ConsecutiveDuplicate[]): string {
  let out = '';
  let last = 0;
  for (const d of dups) {
    out += text.slice(last, d.first.end);
    last = d.position.end;
  }
  return out + text.slice(last);
}
