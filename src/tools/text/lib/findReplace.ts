import { describeRegexError } from '../../regex/lib/errors';
import { escapeRegExp } from './common';

export interface FindOptions {
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
  /** Regex only: ^ and $ match at line breaks. */
  multiline: boolean;
  /** Regex only: . matches line breaks. */
  dotAll: boolean;
  /** Interpret \n, \t and \\ in the replacement text. */
  escapes: boolean;
}

export const DEFAULT_FIND_OPTIONS: FindOptions = {
  regex: false,
  caseSensitive: false,
  wholeWord: false,
  multiline: true,
  dotAll: false,
  escapes: true,
};

export interface MatchRange {
  start: number;
  end: number;
}

export type CompileResult = { ok: true; re: RegExp } | { ok: false; error: string };

/** Build the global RegExp for a search. Tries Unicode mode first and falls back to legacy mode. */
export function compileSearch(find: string, o: FindOptions): CompileResult {
  const body = o.regex ? find : escapeRegExp(find);
  const flags = 'g' + (o.caseSensitive ? '' : 'i') + (o.regex && o.multiline ? 'm' : '') + (o.regex && o.dotAll ? 's' : '');
  const wrap = (b: string, unicode: boolean) =>
    o.wholeWord ? (unicode ? `(?<![\\p{L}\\p{N}_])(?:${b})(?![\\p{L}\\p{N}_])` : `(?<![\\w])(?:${b})(?![\\w])`) : b;
  try {
    return { ok: true, re: new RegExp(wrap(body, true), flags + 'u') };
  } catch {
    try {
      return { ok: true, re: new RegExp(wrap(body, false), flags) };
    } catch (legacyError) {
      return { ok: false, error: describeRegexError(legacyError, flags) };
    }
  }
}

/** All match ranges (zero-length matches are skipped for highlighting but still safe). */
export function findMatches(text: string, re: RegExp, limit = Infinity): { ranges: MatchRange[]; total: number } {
  const ranges: MatchRange[] = [];
  let total = 0;
  re.lastIndex = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    total++;
    if (ranges.length < limit && end > start) ranges.push({ start, end });
  }
  return { ranges, total };
}

/** Turn \n, \t, \r and \\ sequences into real characters. `$` sequences are left for the regex engine. */
export function interpretEscapes(text: string): string {
  return text.replace(/\\([ntr\\])/g, (_m, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : '\\'));
}

export type ReplaceResult = { ok: true; text: string; count: number; ranges: MatchRange[] } | { ok: false; error: string };

/**
 * Replace every match. `maxRanges` limits how many match positions are returned for
 * highlighting (the count and the replaced text always cover every match).
 */
export function findAndReplace(
  text: string,
  find: string,
  replacement: string,
  opts: Partial<FindOptions> = {},
  maxRanges = Infinity,
): ReplaceResult {
  const o = { ...DEFAULT_FIND_OPTIONS, ...opts };
  if (!find) return { ok: true, text, count: 0, ranges: [] };
  const compiled = compileSearch(find, o);
  if (!compiled.ok) return compiled;
  const { re } = compiled;
  const repl = o.escapes ? interpretEscapes(replacement) : replacement;
  const { ranges, total } = findMatches(text, re, maxRanges);
  re.lastIndex = 0;
  const output = o.regex ? text.replace(re, repl) : text.replace(re, () => repl);
  return { ok: true, text: output, count: total, ranges };
}
