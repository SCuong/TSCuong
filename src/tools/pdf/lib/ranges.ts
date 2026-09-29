/**
 * Page-range parsing for PDF tools. Pages are 1-based everywhere in this module.
 *
 * Accepted syntax (case-insensitive, separated by commas or semicolons):
 *   5          a single page
 *   1-3        an inclusive range (en/em dashes and "to" also work: 1–3, 1 to 3)
 *   8-         from page 8 to the last page
 *   -4         from the first page to page 4
 *   7-3        a descending range (7, 6, 5, 4, 3)
 *   last       the last page; also usable inside ranges: 5-last, last-2
 *   all        every page
 *   odd, even  odd or even pages
 */

export type RangeResult = { ok: true; pages: number[] } | { ok: false; error: string };
export type RangeGroupsResult = { ok: true; groups: number[][] } | { ok: false; error: string };

export interface RangeOptions {
  /** Remove repeated pages, keeping the first occurrence (default true). */
  unique?: boolean;
}

function normalize(input: string): string {
  return input
    .normalize('NFKC') // full-width digits and punctuation (e.g. typed with a CJK input method)
    .toLowerCase()
    .replace(/[‐-―−﹣－]/g, '-') // hyphens (e.g. pasted from a word processor), figure/en/em dashes, minus signs
    .replace(/\s+to\s+/g, '-')
    .replace(/\s*-\s*/g, '-')
    .trim();
}

function splitTokens(input: string): string[] {
  return input
    .split(/[,;]+/)
    .flatMap((part) => part.trim().split(/\s+/))
    .map((t) => t.trim())
    .filter(Boolean);
}

function resolveNumber(raw: string, total: number): number | string {
  if (raw === 'last' || raw === 'end') return total;
  if (raw === 'first' || raw === 'start') return 1;
  if (!/^\d+$/.test(raw)) return `"${raw}" is not a page number.`;
  const n = Number(raw);
  if (n < 1) return 'Page numbers start at 1.';
  if (n > total) return `Page ${n} does not exist: the document has ${total} ${total === 1 ? 'page' : 'pages'}.`;
  return n;
}

function expandToken(token: string, total: number): number[] | string {
  if (token === 'all' || token === '*') return seq(1, total);
  if (token === 'odd') return seq(1, total).filter((n) => n % 2 === 1);
  if (token === 'even') return seq(1, total).filter((n) => n % 2 === 0);

  const dash = token.indexOf('-');
  if (dash === -1) {
    const n = resolveNumber(token, total);
    return typeof n === 'string' ? n : [n];
  }
  if (token.indexOf('-', dash + 1) !== -1) return `"${token}" is not a valid range.`;
  const left = token.slice(0, dash);
  const right = token.slice(dash + 1);
  if (!left && !right) return `"${token}" is not a valid range.`;
  const from = left ? resolveNumber(left, total) : 1;
  const to = right ? resolveNumber(right, total) : total;
  if (typeof from === 'string') return from;
  if (typeof to === 'string') return to;
  return from <= to ? seq(from, to) : seq(to, from).reverse();
}

function seq(from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) out.push(i);
  return out;
}

/** Parse a page selection into an ordered list of 1-based page numbers. */
export function parsePageRange(input: string, total: number, options: RangeOptions = {}): RangeResult {
  const { unique = true } = options;
  if (!Number.isInteger(total) || total < 1) return { ok: false, error: 'The document has no pages.' };
  const text = normalize(input);
  if (!text) return { ok: false, error: 'Enter the pages to use, for example 1-3, 5, 8-.' };
  const pages: number[] = [];
  const seen = new Set<number>();
  for (const token of splitTokens(text)) {
    const expanded = expandToken(token, total);
    if (typeof expanded === 'string') return { ok: false, error: expanded };
    for (const page of expanded) {
      if (unique) {
        if (seen.has(page)) continue;
        seen.add(page);
      }
      pages.push(page);
    }
  }
  if (pages.length === 0) return { ok: false, error: 'That selection contains no pages.' };
  return { ok: true, pages };
}

/**
 * Parse comma/semicolon separated groups, each becoming one output file.
 * "1-3, 4-6, 7-" → [[1,2,3],[4,5,6],[7..total]]. Whitespace inside a group is not a separator here.
 */
export function parseRangeGroups(input: string, total: number): RangeGroupsResult {
  if (!Number.isInteger(total) || total < 1) return { ok: false, error: 'The document has no pages.' };
  const text = normalize(input);
  if (!text) return { ok: false, error: 'Enter one or more ranges, for example 1-3, 4-6, 7-.' };
  const groups: number[][] = [];
  for (const part of text.split(/[,;]+/)) {
    const token = part.trim();
    if (!token) continue;
    if (/\s/.test(token)) return { ok: false, error: `"${token}" is not a valid range. Separate ranges with commas.` };
    const expanded = expandToken(token, total);
    if (typeof expanded === 'string') return { ok: false, error: expanded };
    if (expanded.length) groups.push(expanded);
  }
  if (groups.length === 0) return { ok: false, error: 'That selection contains no pages.' };
  return { ok: true, groups };
}

/** Groups of `size` consecutive pages: every N pages. */
export function chunkPages(total: number, size: number): number[][] {
  if (!Number.isInteger(size) || size < 1 || total < 1) return [];
  const groups: number[][] = [];
  for (let start = 1; start <= total; start += size) groups.push(seq(start, Math.min(total, start + size - 1)));
  return groups;
}

/** Compact, human readable form of a page list: [1,2,3,5,7,8] → "1-3, 5, 7-8". Keeps the given order. */
export function formatPageList(pages: readonly number[]): string {
  const parts: string[] = [];
  let i = 0;
  while (i < pages.length) {
    let j = i;
    while (j + 1 < pages.length && pages[j + 1] === pages[j] + 1) j++;
    parts.push(j > i ? `${pages[i]}-${pages[j]}` : String(pages[i]));
    i = j + 1;
  }
  return parts.join(', ');
}
