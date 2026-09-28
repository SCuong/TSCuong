/** Text search helpers for the viewer (pure, unit tested). */

export interface SearchItem {
  str: string;
  hasEOL?: boolean;
}

export interface PageTextIndex {
  /** Lowercased searchable text of the page. */
  text: string;
  /** Start offset of each item in `text` (same order as the items). */
  starts: number[];
}

/** Join items like pdf.js does for find: items run together, EOL items add a line break. */
export function buildPageIndex(items: readonly SearchItem[]): PageTextIndex {
  let text = '';
  const starts: number[] = [];
  for (const item of items) {
    starts.push(text.length);
    text += item.str.toLowerCase();
    if (item.hasEOL) text += '\n';
  }
  return { text, starts };
}

function normalizeQuery(query: string): string {
  return query.toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Start offsets of every (non-overlapping) match. Whitespace in the query matches any whitespace run. */
export function findMatches(index: PageTextIndex, query: string): Array<{ start: number; end: number }> {
  const q = normalizeQuery(query);
  if (!q) return [];
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+');
  const re = new RegExp(escaped, 'g');
  const out: Array<{ start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(index.text)) && out.length < 10000) {
    out.push({ start: m.index, end: m.index + m[0].length });
    if (m[0].length === 0) re.lastIndex++;
  }
  return out;
}

/** Indices of the items that overlap [start, end). */
export function itemsInRange(index: PageTextIndex, start: number, end: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < index.starts.length; i++) {
    const s = index.starts[i];
    const e = i + 1 < index.starts.length ? index.starts[i + 1] : index.text.length;
    if (s < end && e > start && e > s) result.push(i);
  }
  return result;
}

/** A short excerpt around a match for result lists. */
export function snippet(index: PageTextIndex, start: number, end: number, radius = 40): string {
  const from = Math.max(0, start - radius);
  const to = Math.min(index.text.length, end + radius);
  return `${from > 0 ? '…' : ''}${index.text.slice(from, to).replace(/\s+/g, ' ')}${to < index.text.length ? '…' : ''}`;
}
