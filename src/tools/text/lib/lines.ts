import { describeRegexError } from '../../regex/lib/errors';
import { compareCodePoints, countGraphemes, escapeRegExp, foldCase, joinLines, secureShuffle, splitLines, type Eol } from './common';

/* ------------------------------------------------------------------------ */
/* Sort                                                                     */
/* ------------------------------------------------------------------------ */

export type SortMode = 'alpha' | 'natural' | 'codepoint' | 'length' | 'reverse' | 'shuffle';

export interface SortOptions {
  mode: SortMode;
  descending: boolean;
  caseInsensitive: boolean;
  unique: boolean;
  trim: boolean;
  removeEmpty: boolean;
}

export const DEFAULT_SORT_OPTIONS: SortOptions = {
  mode: 'natural',
  descending: false,
  caseInsensitive: true,
  unique: false,
  trim: false,
  removeEmpty: false,
};

export function sortLines(text: string, opts: Partial<SortOptions> = {}): { text: string; count: number; removed: number } {
  const o = { ...DEFAULT_SORT_OPTIONS, ...opts };
  const { lines: raw, trailingNewline, eol } = splitLines(text);
  let lines = o.trim ? raw.map((l) => l.trim()) : raw.slice();
  if (o.removeEmpty) lines = lines.filter((l) => l.trim() !== '');
  if (o.unique) {
    const seen = new Set<string>();
    lines = lines.filter((l) => {
      const key = o.caseInsensitive ? foldCase(l) : l;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const collator = new Intl.Collator(undefined, {
    numeric: o.mode === 'natural',
    sensitivity: o.caseInsensitive ? 'accent' : 'variant',
    caseFirst: o.caseInsensitive ? undefined : 'upper',
  });
  const dir = o.descending ? -1 : 1;
  switch (o.mode) {
    case 'alpha':
    case 'natural':
      lines = lines
        .map((line, index) => ({ line, index }))
        .sort((a, b) => dir * collator.compare(a.line, b.line) || a.index - b.index)
        .map((x) => x.line);
      break;
    case 'codepoint': {
      const decorated = lines.map((line, index) => ({ line, index, key: o.caseInsensitive ? foldCase(line) : line }));
      decorated.sort((a, b) => dir * compareCodePoints(a.key, b.key) || a.index - b.index);
      lines = decorated.map((x) => x.line);
      break;
    }
    case 'length': {
      const decorated = lines.map((line, index) => ({ line, index, len: countGraphemes(line) }));
      decorated.sort((a, b) => dir * (a.len - b.len) || a.index - b.index);
      lines = decorated.map((x) => x.line);
      break;
    }
    case 'reverse':
      lines = lines.slice().reverse();
      break;
    case 'shuffle':
      lines = secureShuffle(lines);
      break;
  }
  return { text: joinLines(lines, eol, trailingNewline), count: lines.length, removed: raw.length - lines.length };
}

/* ------------------------------------------------------------------------ */
/* Remove duplicates                                                        */
/* ------------------------------------------------------------------------ */

export interface DedupeOptions {
  caseInsensitive: boolean;
  /** 'none' compares exactly, 'trim' ignores leading/trailing whitespace, 'all' ignores all whitespace differences. */
  whitespace: 'none' | 'trim' | 'all';
  keep: 'first' | 'last';
  /** Blank lines are kept as they are and never treated as duplicates. */
  keepBlank: boolean;
}

export const DEFAULT_DEDUPE_OPTIONS: DedupeOptions = {
  caseInsensitive: false,
  whitespace: 'none',
  keep: 'first',
  keepBlank: false,
};

export interface DuplicateInfo {
  line: string;
  count: number;
}

export interface DedupeResult {
  text: string;
  total: number;
  kept: number;
  removed: number;
  duplicates: DuplicateInfo[];
}

export function dedupeKey(line: string, o: Pick<DedupeOptions, 'caseInsensitive' | 'whitespace'>): string {
  let key = line;
  if (o.whitespace === 'trim') key = key.trim();
  else if (o.whitespace === 'all') key = key.replace(/\s+/gu, ' ').trim();
  if (o.caseInsensitive) key = foldCase(key);
  return key;
}

export function removeDuplicateLines(text: string, opts: Partial<DedupeOptions> = {}): DedupeResult {
  const o = { ...DEFAULT_DEDUPE_OPTIONS, ...opts };
  const { lines, trailingNewline, eol } = splitLines(text);
  const counts = new Map<string, { line: string; count: number }>();
  const keys = lines.map((line) => {
    if (o.keepBlank && line.trim() === '') return null;
    const key = dedupeKey(line, o);
    const entry = counts.get(key);
    if (entry) entry.count++;
    else counts.set(key, { line, count: 1 });
    return key;
  });

  const keepIndex = new Map<string, number>();
  keys.forEach((key, i) => {
    if (key === null) return;
    if (o.keep === 'last' || !keepIndex.has(key)) keepIndex.set(key, i);
  });

  const out: string[] = [];
  keys.forEach((key, i) => {
    if (key === null || keepIndex.get(key) === i) out.push(lines[i]);
  });

  const duplicates = Array.from(counts.values())
    .filter((e) => e.count > 1)
    .sort((a, b) => b.count - a.count);

  return {
    text: joinLines(out, eol, trailingNewline),
    total: lines.length,
    kept: out.length,
    removed: lines.length - out.length,
    duplicates,
  };
}

/* ------------------------------------------------------------------------ */
/* Whitespace cleaner                                                       */
/* ------------------------------------------------------------------------ */

export interface WhitespaceOptions {
  trim: 'none' | 'both' | 'start' | 'end';
  collapseSpaces: boolean;
  emptyLines: 'keep' | 'remove' | 'collapse';
  tabs: 'keep' | 'toSpaces' | 'toTabs';
  tabWidth: number;
  lineEndings: 'keep' | 'lf' | 'crlf' | 'cr';
  /** Replace NBSP and other Unicode spaces with a normal space; remove zero-width characters. */
  normalizeUnicodeSpaces: boolean;
  /** Remove blank lines at the very start and end of the text. */
  trimDocument: boolean;
}

export const DEFAULT_WHITESPACE_OPTIONS: WhitespaceOptions = {
  trim: 'end',
  collapseSpaces: false,
  emptyLines: 'keep',
  tabs: 'keep',
  tabWidth: 4,
  lineEndings: 'keep',
  normalizeUnicodeSpaces: false,
  trimDocument: false,
};

/** Expand tabs to spaces, honouring tab stops. */
export function expandTabs(line: string, width: number): string {
  if (!line.includes('\t')) return line;
  const w = Math.max(1, width);
  let out = '';
  let col = 0;
  for (const ch of line) {
    if (ch === '\t') {
      const n = w - (col % w);
      out += ' '.repeat(n);
      col += n;
    } else {
      out += ch;
      col++;
    }
  }
  return out;
}

/** Convert leading indentation to tabs (spaces inside the line are left alone). */
export function leadingSpacesToTabs(line: string, width: number): string {
  const w = Math.max(1, width);
  const match = /^[ \t]+/.exec(line);
  if (!match) return line;
  const indent = expandTabs(match[0], w);
  const tabs = Math.floor(indent.length / w);
  const rest = indent.length % w;
  return '\t'.repeat(tabs) + ' '.repeat(rest) + line.slice(match[0].length);
}

const UNICODE_SPACES = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g;
const ZERO_WIDTH = /[\u200b\u2060\ufeff]/g;

export interface WhitespaceResult {
  text: string;
  linesBefore: number;
  linesAfter: number;
  charsRemoved: number;
}

export function cleanWhitespace(text: string, opts: Partial<WhitespaceOptions> = {}): WhitespaceResult {
  const o = { ...DEFAULT_WHITESPACE_OPTIONS, ...opts };
  const { lines: input, trailingNewline, eol: detected } = splitLines(text);
  let lines = input.map((raw) => {
    let line = raw;
    if (o.normalizeUnicodeSpaces) line = line.replace(UNICODE_SPACES, ' ').replace(ZERO_WIDTH, '');
    if (o.tabs === 'toSpaces') line = expandTabs(line, o.tabWidth);
    if (o.collapseSpaces) {
      // Keep indentation intact; collapse runs of spaces/tabs inside the line.
      const indent = /^[ \t]*/.exec(line)![0];
      line = indent + line.slice(indent.length).replace(/[ \t]{2,}/g, ' ');
    }
    if (o.trim === 'both') line = line.trim();
    else if (o.trim === 'start') line = line.replace(/^\s+/u, '');
    else if (o.trim === 'end') line = line.replace(/\s+$/u, '');
    if (o.tabs === 'toTabs') line = leadingSpacesToTabs(line, o.tabWidth);
    return line;
  });

  const blank = (l: string) => l.trim() === '';
  if (o.emptyLines === 'remove') lines = lines.filter((l) => !blank(l));
  else if (o.emptyLines === 'collapse') lines = lines.filter((l, i) => !(blank(l) && i > 0 && blank(lines[i - 1])));

  let keepTrailing = trailingNewline;
  if (o.trimDocument) {
    while (lines.length && blank(lines[0])) lines.shift();
    while (lines.length && blank(lines[lines.length - 1])) lines.pop();
    keepTrailing = false;
  }
  if (lines.length === 0) keepTrailing = false;

  const eol: Eol = o.lineEndings === 'keep' ? detected : o.lineEndings === 'crlf' ? '\r\n' : o.lineEndings === 'cr' ? '\r' : '\n';
  const out = joinLines(lines, eol, keepTrailing);
  return { text: out, linesBefore: input.length, linesAfter: lines.length, charsRemoved: text.length - out.length };
}

/* ------------------------------------------------------------------------ */
/* Prefix / suffix                                                          */
/* ------------------------------------------------------------------------ */

export type QuoteStyle = 'none' | 'single' | 'double' | 'backtick';

export interface AffixOptions {
  prefix: string;
  suffix: string;
  quote: QuoteStyle;
  /** Backslash-escape the quote character when it appears inside a line. */
  escapeQuotes: boolean;
  skipEmpty: boolean;
  trim: boolean;
  /** When set, lines are joined with this string instead of line breaks (e.g. ", "). */
  joinWith: string | null;
}

export const DEFAULT_AFFIX_OPTIONS: AffixOptions = {
  prefix: '',
  suffix: '',
  quote: 'none',
  escapeQuotes: false,
  skipEmpty: true,
  trim: false,
  joinWith: null,
};

const QUOTES: Record<QuoteStyle, string> = { none: '', single: "'", double: '"', backtick: '`' };

export function addAffixes(text: string, opts: Partial<AffixOptions> = {}): string {
  const o = { ...DEFAULT_AFFIX_OPTIONS, ...opts };
  const { lines, trailingNewline, eol } = splitLines(text);
  const q = QUOTES[o.quote];
  const out: string[] = [];
  for (const raw of lines) {
    const line = o.trim ? raw.trim() : raw;
    if (o.skipEmpty && line.trim() === '') {
      if (o.joinWith === null) out.push(line);
      continue;
    }
    let body = line;
    if (q && o.escapeQuotes) body = body.replace(/\\/g, '\\\\').split(q).join(`\\${q}`);
    out.push(`${o.prefix}${q}${body}${q}${o.suffix}`);
  }
  if (o.joinWith !== null) return out.join(o.joinWith);
  return joinLines(out, eol, trailingNewline);
}

/* ------------------------------------------------------------------------ */
/* Number lines                                                             */
/* ------------------------------------------------------------------------ */

export interface NumberOptions {
  start: number;
  step: number;
  padding: 'none' | 'zeros' | 'spaces';
  separator: string;
  skipEmpty: boolean;
}

export const DEFAULT_NUMBER_OPTIONS: NumberOptions = {
  start: 1,
  step: 1,
  padding: 'none',
  separator: '. ',
  skipEmpty: false,
};

export function numberLines(text: string, opts: Partial<NumberOptions> = {}): string {
  const o = { ...DEFAULT_NUMBER_OPTIONS, ...opts };
  const { lines, trailingNewline, eol } = splitLines(text);
  const numbered = lines.filter((l) => !(o.skipEmpty && l.trim() === '')).length;
  const values: number[] = [];
  for (let i = 0; i < numbered; i++) values.push(o.start + i * o.step);
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1e9) / 1e9));
  const width = values.reduce((w, n) => Math.max(w, fmt(Math.abs(n)).length + (n < 0 ? 1 : 0)), 0);
  const pad = (n: number) => {
    const s = fmt(n);
    if (o.padding === 'spaces') return s.padStart(width, ' ');
    if (o.padding === 'zeros') return n < 0 ? `-${fmt(-n).padStart(width - 1, '0')}` : s.padStart(width, '0');
    return s;
  };
  let k = 0;
  const out = lines.map((line) => {
    if (o.skipEmpty && line.trim() === '') return line;
    return `${pad(values[k++])}${o.separator}${line}`;
  });
  return joinLines(out, eol, trailingNewline);
}

/* ------------------------------------------------------------------------ */
/* Line filter                                                              */
/* ------------------------------------------------------------------------ */

export type FilterCondition = 'contains' | 'startsWith' | 'endsWith' | 'equals' | 'regex' | 'empty';

export interface FilterOptions {
  action: 'keep' | 'remove';
  condition: FilterCondition;
  term: string;
  caseSensitive: boolean;
  wholeWord: boolean;
}

export type FilterResult =
  | { ok: true; text: string; matched: number; total: number; kept: number }
  | { ok: false; error: string };

export function buildLineMatcher(o: FilterOptions): ((line: string) => boolean) | string {
  if (o.condition === 'empty') return (line) => line.trim() === '';
  if (o.condition === 'regex') {
    try {
      const re = new RegExp(o.term, o.caseSensitive ? 'u' : 'iu');
      return (line) => re.test(line);
    } catch {
      try {
        const re = new RegExp(o.term, o.caseSensitive ? '' : 'i');
        return (line) => re.test(line);
      } catch (legacyError) {
        return describeRegexError(legacyError, o.caseSensitive ? '' : 'i');
      }
    }
  }
  if (o.wholeWord) {
    const body = escapeRegExp(o.term);
    const pattern =
      o.condition === 'contains'
        ? `(?<![\\p{L}\\p{N}_])${body}(?![\\p{L}\\p{N}_])`
        : o.condition === 'startsWith'
          ? `^${body}(?![\\p{L}\\p{N}_])`
          : o.condition === 'endsWith'
            ? `(?<![\\p{L}\\p{N}_])${body}$`
            : `^${body}$`;
    const re = new RegExp(pattern, o.caseSensitive ? 'u' : 'iu');
    return (line) => re.test(line);
  }
  const norm = (s: string) => (o.caseSensitive ? s : s.toLowerCase());
  const term = norm(o.term);
  switch (o.condition) {
    case 'contains':
      return (line) => norm(line).includes(term);
    case 'startsWith':
      return (line) => norm(line).startsWith(term);
    case 'endsWith':
      return (line) => norm(line).endsWith(term);
    default:
      return (line) => norm(line) === term;
  }
}

export function filterLines(text: string, o: FilterOptions): FilterResult {
  const matcher = buildLineMatcher(o);
  if (typeof matcher === 'string') return { ok: false, error: matcher };
  const { lines, trailingNewline, eol } = splitLines(text);
  let matched = 0;
  const out = lines.filter((line) => {
    const hit = matcher(line);
    if (hit) matched++;
    return o.action === 'keep' ? hit : !hit;
  });
  return { ok: true, text: joinLines(out, eol, trailingNewline && out.length > 0), matched, total: lines.length, kept: out.length };
}
