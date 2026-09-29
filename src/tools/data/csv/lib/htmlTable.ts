import type { Table } from './csv';

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export interface HtmlTableOptions {
  /** Put the first row in <thead> with <th> cells. */
  thead?: boolean;
  /** Use <th scope="row"> for the first cell of each body row. */
  rowHeaders?: boolean;
  className?: string;
  id?: string;
  caption?: string;
  /** Escape cell text (recommended). When off, cells are inserted as raw HTML. */
  escape?: boolean;
  /** Convert line breaks inside cells to <br>. */
  lineBreaks?: boolean;
  /** Pretty-print with indentation; otherwise one line. */
  indent?: '2' | '4' | 'tab' | 'none';
  align?: Array<'none' | 'left' | 'center' | 'right'>;
}

/** Valid class list: space separated tokens without quotes or angle brackets. */
export function sanitizeClassName(value: string): string {
  return value
    .split(/\s+/)
    .map((t) => t.replace(/[^\w\-:/.[\]%]/g, ''))
    .filter(Boolean)
    .join(' ');
}

export function sanitizeId(value: string): string {
  return value.trim().replace(/[^\w\-:.]/g, '-');
}

export function toHtmlTable(table: Table, options: HtmlTableOptions = {}): string {
  const { thead = true, rowHeaders = false, escape = true, lineBreaks = true, indent = '2', align = [] } = options;
  const unit = indent === 'none' ? '' : indent === 'tab' ? '\t' : ' '.repeat(Number(indent));
  const nl = indent === 'none' ? '' : '\n';
  const ind = (level: number) => unit.repeat(level);
  const content = (v: string) => {
    let s = escape ? escapeHtml(v) : v;
    if (lineBreaks) s = s.replace(/\r\n|\r|\n/g, '<br>');
    return s;
  };
  const alignAttr = (i: number) => {
    const a = align[i];
    return a && a !== 'none' ? ` style="text-align: ${a}"` : '';
  };

  const attrs: string[] = [];
  const id = options.id ? sanitizeId(options.id) : '';
  const cls = options.className ? sanitizeClassName(options.className) : '';
  if (id) attrs.push(`id="${id}"`);
  if (cls) attrs.push(`class="${cls}"`);

  const out: string[] = [`<table${attrs.length ? ' ' + attrs.join(' ') : ''}>`];
  if (options.caption?.trim()) out.push(`${ind(1)}<caption>${escapeHtml(options.caption.trim())}</caption>`);
  const cols = table.headers.length;

  const bodyRows = thead ? table.rows : [table.headers, ...table.rows];
  if (thead && cols) {
    out.push(`${ind(1)}<thead>`, `${ind(2)}<tr>`);
    table.headers.forEach((h, i) => out.push(`${ind(3)}<th scope="col"${alignAttr(i)}>${content(h)}</th>`));
    out.push(`${ind(2)}</tr>`, `${ind(1)}</thead>`);
  }
  if (bodyRows.length) {
    out.push(`${ind(1)}<tbody>`);
    for (const row of bodyRows) {
      out.push(`${ind(2)}<tr>`);
      for (let i = 0; i < cols; i++) {
        const v = content(row[i] ?? '');
        if (rowHeaders && i === 0) out.push(`${ind(3)}<th scope="row"${alignAttr(i)}>${v}</th>`);
        else out.push(`${ind(3)}<td${alignAttr(i)}>${v}</td>`);
      }
      out.push(`${ind(2)}</tr>`);
    }
    out.push(`${ind(1)}</tbody>`);
  }
  out.push('</table>');
  return out.join(nl);
}
