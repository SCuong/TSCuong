/** Match highlighting and line snippets for search results. */

export interface Segment {
  text: string;
  hit: boolean;
}

export interface Snippet {
  /** 1-based line number. */
  line: number;
  segments: Segment[];
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A case-insensitive regex that matches whole index terms (as produced by the
 * MiniSearch tokenizer, which splits on whitespace and punctuation).
 */
export function termsPattern(terms: string[]): RegExp | null {
  const unique = [...new Set(terms.map((t) => t.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!unique.length) return null;
  return new RegExp(`(?<![\\p{L}\\p{N}\\p{M}])(?:${unique.map(escapeRegExp).join('|')})(?![\\p{L}\\p{N}\\p{M}])`, 'giu');
}

/** A case-insensitive regex for plain substrings (filename search). */
export function substringsPattern(words: string[]): RegExp | null {
  const unique = [...new Set(words.map((t) => t.trim()).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!unique.length) return null;
  return new RegExp(unique.map(escapeRegExp).join('|'), 'giu');
}

export type RegexResult = { ok: true; regex: RegExp } | { ok: false; error: string };

/** Compile a user regex for content search; rejects invalid and empty-matching patterns. */
export function compileUserRegex(pattern: string, caseSensitive: boolean): RegexResult {
  if (!pattern) return { ok: false, error: 'Enter a regular expression.' };
  if (pattern.length > 1000) return { ok: false, error: 'The regular expression is too long (1000 characters max).' };
  const flags = `g${caseSensitive ? '' : 'i'}`;
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, `${flags}u`);
  } catch {
    try {
      regex = new RegExp(pattern, flags);
    } catch (error) {
      const message = error instanceof Error ? error.message.replace(/^Invalid regular expression: /, '') : 'invalid pattern';
      return { ok: false, error: `Invalid regular expression: ${message}` };
    }
  }
  for (const sample of ['', 'a', ' ', 'ab c\n1_2']) {
    regex.lastIndex = 0;
    const m = regex.exec(sample);
    if (m && m[0].length === 0) {
      regex.lastIndex = 0;
      return { ok: false, error: 'This pattern can match empty text. Make it more specific (for example use + instead of *).' };
    }
  }
  regex.lastIndex = 0;
  return { ok: true, regex };
}

/** Split text into highlighted / plain segments. Zero-length matches are skipped. */
export function highlightSegments(text: string, regex: RegExp | null, maxHits = 200): Segment[] {
  if (!regex || !text) return [{ text, hit: false }];
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
  const out: Segment[] = [];
  let last = 0;
  let hits = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && hits < maxHits) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    if (m.index > last) out.push({ text: text.slice(last, m.index), hit: false });
    out.push({ text: m[0], hit: true });
    last = m.index + m[0].length;
    hits++;
  }
  if (last < text.length) out.push({ text: text.slice(last), hit: false });
  return out.length ? out : [{ text, hit: false }];
}

/** Cut a long line to a window around `index`, marking the cuts with ellipses. */
export function windowAround(line: string, index: number, max = 160): { text: string; offset: number } {
  if (line.length <= max) return { text: line, offset: 0 };
  const start = Math.max(0, Math.min(index - Math.floor(max / 3), line.length - max));
  const end = Math.min(line.length, start + max);
  return { text: `${start > 0 ? '…' : ''}${line.slice(start, end)}${end < line.length ? '…' : ''}`, offset: start };
}

export interface LineMatches {
  /** Number of lines containing at least one match (counted up to `countLimit`). */
  matchingLines: number;
  snippets: Snippet[];
}

/**
 * Find lines of `text` matching `regex` and build highlighted snippets for the
 * first `maxSnippets` of them. `deadline` (ms timestamp) stops scanning early.
 */
export function matchLines(
  text: string,
  regex: RegExp,
  options: { maxSnippets?: number; countLimit?: number; maxLineLength?: number; deadline?: number } = {},
): LineMatches {
  const { maxSnippets = 3, countLimit = 1000, maxLineLength = 160, deadline } = options;
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
  const snippets: Snippet[] = [];
  let matchingLines = 0;
  let lineNo = 0;
  let pos = 0;
  while (pos <= text.length) {
    lineNo++;
    let nl = text.indexOf('\n', pos);
    if (nl === -1) nl = text.length;
    const line = text.slice(pos, nl).replace(/\r$/, '');
    re.lastIndex = 0;
    let m = re.exec(line);
    while (m && m[0].length === 0) {
      re.lastIndex++;
      m = re.lastIndex <= line.length ? re.exec(line) : null;
    }
    if (m) {
      matchingLines++;
      if (snippets.length < maxSnippets) {
        const win = windowAround(line, m.index, maxLineLength);
        snippets.push({ line: lineNo, segments: highlightSegments(win.text, re) });
      }
      if (matchingLines >= countLimit) break;
    }
    if (deadline !== undefined && (lineNo & 255) === 0 && performance.now() > deadline) break;
    pos = nl + 1;
  }
  return { matchingLines, snippets };
}

/** Terms of the query as the default MiniSearch tokenizer sees them. */
export function queryTerms(query: string): string[] {
  return query
    .split(/[\n\r\p{Z}\p{P}]+/u)
    .map((t) => t.toLowerCase())
    .filter(Boolean);
}

/** Split identifiers into their camelCase / PascalCase parts: "parseHTTPResponse" → parse, HTTP, Response. */
export function camelParts(token: string): string[] {
  const parts = token.match(/\p{Lu}+(?=\p{Lu}\p{Ll})|\p{Lu}?\p{Ll}+|\p{Lu}+|\p{N}+/gu);
  return parts && parts.length > 1 ? parts : [];
}

/** "5 minutes ago", "yesterday", … */
export function timeAgo(ms: number, now = Date.now()): string {
  const diff = ms - now;
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 365 * 86_400_000],
    ['month', 30 * 86_400_000],
    ['week', 7 * 86_400_000],
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];
  for (const [unit, size] of units) {
    if (abs >= size) return rtf.format(Math.round(diff / size), unit);
  }
  return rtf.format(0, 'minute');
}
