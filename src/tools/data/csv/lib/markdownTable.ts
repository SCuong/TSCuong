import { defaultColumnName, type Table } from './csv';

export type Align = 'none' | 'left' | 'center' | 'right';

const WIDE =
  /[\u1100-\u115f\u2e80-\u303e\u3041-\u33ff\u3400-\u4dbf\u4e00-\u9fff\ua000-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\uffe0-\uffe6]/;
const EMOJI = /\p{Extended_Pictographic}/u;
/** A lone zero-width character (combining mark, zero-width space/joiner, variation selector). */
function isZeroWidth(g: string): boolean {
  if (g.length !== 1) return false;
  const c = g.charCodeAt(0);
  return (c >= 0x300 && c <= 0x36f) || (c >= 0x200b && c <= 0x200f) || (c >= 0xfe00 && c <= 0xfe0f);
}

let segmenter: Intl.Segmenter | null | undefined;
function graphemes(text: string): string[] {
  if (segmenter === undefined) {
    segmenter = typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  }
  if (segmenter) return Array.from(segmenter.segment(text), (s) => s.segment);
  return Array.from(text);
}

/** Approximate monospace display width: CJK and emoji count as 2 columns. */
export function displayWidth(text: string): number {
  let w = 0;
  for (const g of graphemes(text)) {
    if (isZeroWidth(g)) continue;
    const cp = g.codePointAt(0) ?? 0;
    if (EMOJI.test(g) && (cp > 0x2000 || g.length > 1)) w += 2;
    else if (WIDE.test(g) || (cp >= 0x20000 && cp <= 0x3fffd)) w += 2;
    else w += 1;
  }
  return w;
}

/** Escape a cell for a GFM table: pipes, backslashes before pipes, and line breaks (→ <br>). */
export function escapeMarkdownCell(value: string): string {
  return value
    .replace(/\\\|/g, '\\\\|')
    .replace(/\|/g, '\\|')
    .replace(/\r\n|\r|\n/g, '<br>');
}

export interface MarkdownTableOptions {
  align?: Align[];
  /** Pad columns so the source lines up in a monospace font. */
  pretty?: boolean;
}

function separator(align: Align, width: number): string {
  // Columns are at least 3 wide, so there is always at least one dash and the row lines up with the cells.
  const dashes = '-'.repeat(Math.max(1, width - (align === 'center' ? 2 : align === 'none' ? 0 : 1)));
  switch (align) {
    case 'left':
      return `:${dashes}`;
    case 'right':
      return `${dashes}:`;
    case 'center':
      return `:${dashes}:`;
    default:
      return dashes;
  }
}

function pad(text: string, width: number, align: Align): string {
  const gap = width - displayWidth(text);
  if (gap <= 0) return text;
  if (align === 'right') return ' '.repeat(gap) + text;
  if (align === 'center') {
    const left = Math.floor(gap / 2);
    return ' '.repeat(left) + text + ' '.repeat(gap - left);
  }
  return text + ' '.repeat(gap);
}

/** Render a GitHub Flavored Markdown table. */
export function toMarkdownTable(table: Table, options: MarkdownTableOptions = {}): string {
  const { pretty = true } = options;
  const cols = table.headers.length;
  if (!cols) return '';
  const align = Array.from({ length: cols }, (_, i) => options.align?.[i] ?? 'none');
  const head = table.headers.map((h, i) => escapeMarkdownCell(h) || defaultColumnName(i));
  const body = table.rows.map((r) => Array.from({ length: cols }, (_, i) => escapeMarkdownCell(r[i] ?? '')));
  const widths = head.map((h, i) => {
    if (!pretty) return 3;
    let w = Math.max(3, displayWidth(h));
    for (const r of body) w = Math.max(w, displayWidth(r[i]));
    return w;
  });
  const line = (cells: string[]) =>
    pretty ? `| ${cells.map((c, i) => pad(c, widths[i], align[i])).join(' | ')} |` : `| ${cells.join(' | ')} |`;
  const sep = pretty
    ? `| ${align.map((a, i) => separator(a, widths[i])).join(' | ')} |`
    : `| ${align.map((a) => separator(a, 3)).join(' | ')} |`;
  return [line(head), sep, ...body.map(line)].join('\n');
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let current = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') {
      current += '|';
      i++;
    } else if (ch === '|') {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells.map((c) => c.trim().replace(/<br\s*\/?>/gi, '\n'));
}

const SEPARATOR_CELL = /^:?-{1,}:?$/;

/** Parse a GFM table (the first one found in the text). Returns null if there is none. */
export function parseMarkdownTable(text: string): { table: Table; align: Align[] } | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i + 1 < lines.length; i++) {
    if (!lines[i].includes('|')) continue;
    const sepCells = splitRow(lines[i + 1]);
    if (!sepCells.length || !sepCells.every((c) => SEPARATOR_CELL.test(c.replace(/\s+/g, '')))) continue;
    const headers = splitRow(lines[i]);
    const align: Align[] = sepCells.map((c) => {
      const t = c.replace(/\s+/g, '');
      const l = t.startsWith(':');
      const r = t.endsWith(':');
      return l && r ? 'center' : r ? 'right' : l ? 'left' : 'none';
    });
    const width = headers.length;
    const rows: string[][] = [];
    for (let j = i + 2; j < lines.length; j++) {
      const line = lines[j];
      if (!line.trim() || !line.includes('|')) break;
      const cells = splitRow(line).slice(0, width);
      while (cells.length < width) cells.push('');
      rows.push(cells);
    }
    while (align.length < width) align.push('none');
    return { table: { headers, rows }, align: align.slice(0, width) };
  }
  return null;
}
