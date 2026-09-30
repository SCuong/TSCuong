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

/** Letters without a decomposition that people still type without their stroke. */
const EXTRA_FOLDS: Record<string, string> = {
  đ: 'd',
  ð: 'd',
  ø: 'o',
  ł: 'l',
  ħ: 'h',
  ŧ: 't',
  ı: 'i',
  // Cyrillic small io → Cyrillic small ie (written as code points: the two look like Latin letters).
  [String.fromCharCode(0x451)]: String.fromCharCode(0x435),
};
const EXTRA_FOLD_RE = new RegExp(`[${Object.keys(EXTRA_FOLDS).join('')}]`, 'g');

/**
 * Lower-case a term and drop the accents of Latin and Greek letters, so that
 * "cafe" finds "café", "Nguyen" finds "Nguyễn" and "resume" finds "résumé".
 * Other scripts keep their marks (Japanese dakuten, Cyrillic й, …).
 */
export function foldTerm(term: string): string {
  // Fast path: most paths and code are ASCII, which has nothing to fold.
  let ascii = true;
  for (let i = 0; i < term.length && ascii; i++) ascii = term.charCodeAt(i) < 128;
  if (ascii) return term.toLowerCase();
  return term
    .toLowerCase()
    .normalize('NFD')
    .replace(/(\p{Script=Latin}|\p{Script=Greek})\p{M}+/gu, '$1')
    .normalize('NFC')
    .replace(EXTRA_FOLD_RE, (c) => EXTRA_FOLDS[c]);
}

let foldVariants: Map<string, string> | null = null;

/** For each folded letter, the precomposed letters that fold to it (e.g. "e" → "éèêëēė…"). */
function variantsOf(ch: string): string {
  if (!foldVariants) {
    const sets = new Map<string, Set<string>>();
    const ranges: Array<[number, number]> = [
      [0x00c0, 0x024f],
      [0x1e00, 0x1eff],
      [0x0370, 0x03ff],
      [0x1f00, 0x1fff],
      [0x0400, 0x04ff],
    ];
    for (const [from, to] of ranges) {
      for (let cp = from; cp <= to; cp++) {
        const c = String.fromCodePoint(cp);
        const folded = foldTerm(c);
        if ([...folded].length !== 1 || folded === c || folded === c.toLowerCase()) continue;
        const set = sets.get(folded) ?? new Set<string>();
        set.add(c);
        sets.set(folded, set);
      }
    }
    foldVariants = new Map([...sets].map(([k, v]) => [k, [...v].join('')]));
  }
  return foldVariants.get(ch) ?? '';
}

/** Every single-character case form of `chars` (e.g. "é" → "éÉ"). */
function withCases(chars: string): string {
  let out = '';
  for (const c of chars) {
    for (const form of [c, c.toLowerCase(), c.toUpperCase()]) {
      if ([...form].length === 1 && !out.includes(form)) out += form;
    }
  }
  return out;
}

/**
 * Regex source matching `folded` (a {@link foldTerm} result) in the original
 * text in any letter case and with any accents: each letter becomes a class of
 * its case and accented forms, and combining marks after it (decomposed text)
 * are allowed. Case is spelled out instead of using the `i` flag, because
 * under `i` the \p{Lu}/\p{Ll} tests of the term boundaries stop telling cases apart.
 */
export function accentInsensitiveSource(folded: string): string {
  let out = '';
  for (const ch of folded) {
    const forms = withCases(ch + variantsOf(ch));
    out += forms.length > 1 ? `[${forms.replace(/[\\\]^-]/g, '\\$&')}]` : escapeRegExp(ch);
    if (/\p{L}/u.test(ch)) out += '\\p{M}*';
  }
  return out;
}

// A term boundary: not inside a word, or at a camelCase transition (parse|HTTP|Response),
// matching how the index splits identifiers into parts.
const TERM_START = '(?:(?<![\\p{L}\\p{N}\\p{M}])|(?<=\\p{Ll})(?=\\p{Lu})|(?<=\\p{Lu})(?=\\p{Lu}\\p{Ll}))';
const TERM_END = '(?:(?![\\p{L}\\p{N}\\p{M}])|(?<=\\p{Ll})(?=\\p{Lu})|(?<=\\p{Lu})(?=\\p{Lu}\\p{Ll}))';

/**
 * A case- and accent-insensitive regex that matches whole index terms (as
 * produced by the tokenizer, which splits on whitespace, punctuation, symbols
 * and camelCase boundaries).
 */
export function termsPattern(terms: string[]): RegExp | null {
  const unique = [...new Set(terms.map((t) => foldTerm(t.trim())).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!unique.length) return null;
  return new RegExp(`${TERM_START}(?:${unique.map(accentInsensitiveSource).join('|')})${TERM_END}`, 'gu');
}

/** A case- and accent-insensitive regex for plain substrings (filename search). */
export function substringsPattern(words: string[]): RegExp | null {
  const unique = [...new Set(words.map((t) => foldTerm(t.trim())).filter(Boolean))].sort((a, b) => b.length - a.length);
  if (!unique.length) return null;
  return new RegExp(unique.map(accentInsensitiveSource).join('|'), 'gu');
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
