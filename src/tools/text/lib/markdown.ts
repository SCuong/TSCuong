import { lexer, type Token, type Tokens } from 'marked';

export interface MarkdownToTextOptions {
  /** Append link targets: "text (https://…)". */
  linkUrls: boolean;
  /** Keep "- " / "1. " markers in lists. */
  listMarkers: boolean;
  /** Keep fenced/indented code blocks (without fences). */
  codeBlocks: boolean;
  /** Keep image alt text. */
  imageAlt: boolean;
  /** Headings in UPPER CASE (useful for plain-text e-mails). */
  uppercaseHeadings: boolean;
}

export const DEFAULT_MD_OPTIONS: MarkdownToTextOptions = {
  linkUrls: false,
  listMarkers: true,
  codeBlocks: true,
  imageAlt: true,
  uppercaseHeadings: false,
};

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', copy: '©', reg: '®', trade: '™', hellip: '…', mdash: '—', ndash: '–' };

/** Decode character references that commonly appear in Markdown source. */
export function decodeBasicEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (m, ref: string) => {
    if (ref[0] === '#') {
      const cp = ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    return NAMED[ref.toLowerCase()] ?? m;
  });
}

function stripTags(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre|section|article)\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '');
}

function inline(tokens: Token[] | undefined, o: MarkdownToTextOptions): string {
  if (!tokens) return '';
  let out = '';
  for (const t of tokens) {
    switch (t.type) {
      case 'text': {
        const tt = t as Tokens.Text;
        out += tt.tokens ? inline(tt.tokens, o) : decodeBasicEntities(tt.text);
        break;
      }
      case 'escape':
        out += decodeBasicEntities((t as Tokens.Escape).text);
        break;
      case 'strong':
      case 'em':
      case 'del':
        out += inline((t as Tokens.Strong).tokens, o);
        break;
      case 'codespan':
        out += decodeBasicEntities((t as Tokens.Codespan).text);
        break;
      case 'br':
        out += '\n';
        break;
      case 'link': {
        const link = t as Tokens.Link;
        const text = inline(link.tokens, o);
        const href = link.href;
        const showUrl = o.linkUrls && href && href !== text && `mailto:${text}` !== href;
        out += showUrl ? `${text} (${href})` : text;
        break;
      }
      case 'image': {
        const img = t as Tokens.Image;
        if (o.imageAlt && img.text) out += img.text;
        break;
      }
      case 'html':
        out += decodeBasicEntities(stripTags((t as Tokens.HTML).text));
        break;
      case 'checkbox':
        break;
      default:
        if ('tokens' in t && Array.isArray(t.tokens)) out += inline(t.tokens, o);
        else if ('text' in t && typeof t.text === 'string') out += t.text;
    }
  }
  return out;
}

function blocks(tokens: Token[], o: MarkdownToTextOptions, depth = 0): string[] {
  const out: string[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case 'space':
      case 'def':
        break;
      case 'hr':
        break;
      case 'heading': {
        const text = inline((t as Tokens.Heading).tokens, o);
        out.push(o.uppercaseHeadings ? text.toUpperCase() : text);
        break;
      }
      case 'paragraph':
        out.push(inline((t as Tokens.Paragraph).tokens, o));
        break;
      case 'text': {
        const tt = t as Tokens.Text;
        out.push(tt.tokens ? inline(tt.tokens, o) : decodeBasicEntities(tt.text));
        break;
      }
      case 'blockquote':
        out.push(blocks((t as Tokens.Blockquote).tokens, o, depth).join('\n\n'));
        break;
      case 'code':
        if (o.codeBlocks) out.push((t as Tokens.Code).text);
        break;
      case 'html': {
        const text = decodeBasicEntities(stripTags((t as Tokens.HTML).text)).trim();
        if (text) out.push(text);
        break;
      }
      case 'list': {
        const list = t as Tokens.List;
        const start = typeof list.start === 'number' ? list.start : 1;
        const indent = '  '.repeat(depth);
        const items = list.items.map((item, i) => {
          const body = blocks(item.tokens, o, depth + 1)
            .filter((s) => s !== '')
            .join(item.loose ? '\n\n' : '\n');
          const task = item.task ? (item.checked ? '[x] ' : '[ ] ') : '';
          const marker = o.listMarkers ? (list.ordered ? `${start + i}. ` : '- ') : '';
          const pad = ' '.repeat(marker.length);
          const [first, ...rest] = body.split('\n');
          return [indent + marker + task + (first ?? ''), ...rest.map((l) => (l.startsWith(indent + '  ') || !l ? l : indent + pad + l))].join('\n');
        });
        out.push(items.join(list.loose ? '\n\n' : '\n'));
        break;
      }
      case 'table': {
        const table = t as Tokens.Table;
        const rows = [table.header, ...table.rows].map((row) => row.map((cell) => inline(cell.tokens, o)));
        out.push(rows.map((r) => r.join('\t')).join('\n'));
        break;
      }
      default:
        if ('tokens' in t && Array.isArray(t.tokens)) out.push(inline(t.tokens, o));
        else if ('text' in t && typeof t.text === 'string') out.push(t.text);
    }
  }
  return out;
}

/** Convert Markdown to readable plain text using marked's lexer (no regex guessing at syntax). */
export function markdownToText(markdown: string, opts: Partial<MarkdownToTextOptions> = {}): string {
  const o = { ...DEFAULT_MD_OPTIONS, ...opts };
  if (!markdown.trim()) return '';
  const tokens = lexer(markdown.replace(/\r\n?/g, '\n'), { gfm: true });
  return blocks(tokens, o)
    .filter((b) => b.trim() !== '')
    .join('\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
