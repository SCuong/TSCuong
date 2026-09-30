import DOMPurify, { type Config } from 'dompurify';
import { Marked, type Token, type Tokens } from 'marked';

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** GitHub-style heading slug: lowercase, punctuation removed, spaces to dashes. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

// ---------------------------------------------------------------------------
// Source preparation
// ---------------------------------------------------------------------------

const MAX_FRONT_MATTER_LINES = 200;
/** Lines that can appear in simple YAML front matter: `key: value`, list items, indented continuations, comments. */
const YAML_LINE = /^(?:\s*$|\s*#|\s*-\s|\s*-$|[ \t]+\S|["']?[\w$@.-][^:]*["']?\s*:(?:\s|$))/;

/**
 * Length of leading YAML front matter (`---` … `---` or `...`), including the
 * closing line and its newline, or 0 when the text does not start with front matter.
 * A leading `---` followed by ordinary text is a rule, not front matter.
 */
export function frontMatterLength(text: string): number {
  if (!text.startsWith('---')) return 0;
  let pos = text.indexOf('\n');
  if (pos === -1 || text.slice(3, pos).trim() !== '') return 0;
  pos++;
  for (let count = 0; count < MAX_FRONT_MATTER_LINES && pos <= text.length; count++) {
    const nl = text.indexOf('\n', pos);
    const end = nl === -1 ? text.length : nl;
    const line = text.slice(pos, end).replace(/\r$/, '');
    if (count > 0 && /^(---|\.\.\.)[ \t]*$/.test(line)) return nl === -1 ? text.length : nl + 1;
    if (!YAML_LINE.test(line) || nl === -1) return 0;
    pos = nl + 1;
  }
  return 0;
}

/**
 * Normalizes line endings and a BOM, and turns leading YAML front matter into a
 * fenced YAML block (instead of a rule plus a heading). Line numbers are kept,
 * so they still point into the original note.
 */
export function prepareSource(markdown: string): string {
  const src = markdown.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const length = frontMatterLength(src);
  if (!length) return src;
  const block = src.slice(0, length);
  const lines = block.split('\n');
  const close = block.endsWith('\n') ? lines.length - 2 : lines.length - 1;
  const longest = Math.max(2, ...(block.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  lines[0] = `${fence}yaml lk-front-matter`;
  lines[close] = fence;
  return lines.join('\n') + src.slice(block.length);
}

// ---------------------------------------------------------------------------
// Task list items: which source line each rendered checkbox belongs to
// ---------------------------------------------------------------------------

type CheckboxToken = Tokens.Checkbox & { lkLine?: number };

function normalizeLine(line: string): string {
  return line.replace(/^[\s>]+/, '').replace(/\s+/g, ' ').trimEnd();
}

function collectTaskItems(tokens: Token[], out: Tokens.ListItem[]) {
  for (const token of tokens) {
    if (token.type === 'list') {
      for (const item of (token as Tokens.List).items) {
        if (item.task) out.push(item);
        collectTaskItems(item.tokens, out);
      }
    } else if (token.type === 'blockquote') {
      collectTaskItems((token as Tokens.Blockquote).tokens, out);
    }
  }
}

/** Tight list items carry the checkbox as their first token; loose ones inside their first paragraph. */
function checkboxOf(item: Tokens.ListItem): CheckboxToken | undefined {
  const first = item.tokens[0];
  if (!first) return undefined;
  if (first.type === 'checkbox') return first as CheckboxToken;
  if (!('tokens' in first) || !first.tokens) return undefined;
  return first.tokens.find((t) => t.type === 'checkbox') as CheckboxToken | undefined;
}

/**
 * Records the 0-based source line of every task checkbox on its token. Marked's
 * top-level tokens cover the source exactly, so each list/quote has a known line
 * range; inside it, task items are matched to lines in order. Lines inside code
 * blocks, HTML comments or other blocks are never mistaken for tasks.
 */
function annotateTaskLines(tokens: Token[]) {
  let line = 0;
  for (const token of tokens) {
    const rawLines = token.raw.split('\n');
    if (token.type === 'list' || token.type === 'blockquote') {
      const items: Tokens.ListItem[] = [];
      collectTaskItems([token], items);
      let cursor = 0;
      for (const item of items) {
        const first = normalizeLine(item.raw.split('\n', 1)[0] ?? '');
        for (let i = cursor; i < rawLines.length; i++) {
          if (normalizeLine(rawLines[i]) !== first) continue;
          const box = checkboxOf(item);
          if (box) box.lkLine = line + i;
          cursor = i + 1;
          break;
        }
      }
    }
    line += rawLines.length - 1;
  }
}

const TASK_MARK = /^((?:[ \t]*>)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)([ xX])\]/;

/** Toggles the task checkbox on the given 0-based line. Returns the text unchanged when that line is not a task. */
export function toggleTaskAtLine(markdown: string, line: number): string {
  const lines = markdown.split('\n');
  const text = lines[line];
  if (text === undefined) return markdown;
  const match = TASK_MARK.exec(text);
  if (!match) return markdown;
  lines[line] = match[1] + (match[2] === ' ' ? 'x' : ' ') + text.slice(match[1].length + 1);
  return lines.join('\n');
}

/** 0-based source lines of the task checkboxes, in the order they are rendered. */
export function taskLines(markdown: string): number[] {
  const tokens = marked.lexer(prepareSource(markdown));
  annotateTaskLines(tokens);
  const lines: number[] = [];
  marked.walkTokens(tokens, (token) => {
    if (token.type === 'checkbox') lines.push((token as CheckboxToken).lkLine ?? -1);
  });
  return lines;
}

// ---------------------------------------------------------------------------
// Markdown → HTML
// ---------------------------------------------------------------------------

function createMarked(): { marked: Marked; resetSlugs: () => void } {
  const marked = new Marked({ gfm: true, breaks: false });
  let slugs = new Map<string, number>();
  marked.use({
    renderer: {
      code({ text, lang }: Tokens.Code) {
        const info = (lang ?? '').trim().split(/\s+/);
        const language = info[0]?.toLowerCase();
        if (language === 'mermaid') {
          // The source lives only in the <code> text: DOMPurify drops attribute values that
          // contain "-->" (SAFE_FOR_XML), which almost every Mermaid diagram has.
          return `<div class="lk-mermaid lk-note-mermaid" data-mermaid="pending"><pre><code>${escapeHtml(text)}</code></pre></div>\n`;
        }
        if (info[1] === 'lk-front-matter') {
          return `<pre class="lk-note-frontmatter" aria-label="Front matter"><code class="language-yaml">${escapeHtml(text)}</code></pre>\n`;
        }
        return false;
      },
      heading({ tokens, depth, text }: Tokens.Heading) {
        const inner = this.parser.parseInline(tokens);
        let slug = slugify(text) || 'section';
        const seen = slugs.get(slug) ?? 0;
        slugs.set(slug, seen + 1);
        if (seen) slug = `${slug}-${seen}`;
        return `<h${depth} id="${escapeHtml(slug)}">${inner}</h${depth}>\n`;
      },
      checkbox(token: Tokens.Checkbox) {
        const line = (token as CheckboxToken).lkLine;
        const data = line === undefined ? '' : ` data-lk-task="${line}"`;
        return `<input type="checkbox"${data}${token.checked ? ' checked=""' : ''} disabled=""> `;
      },
    },
  });
  return {
    marked,
    resetSlugs: () => {
      slugs = new Map();
    },
  };
}

const { marked, resetSlugs } = createMarked();

/** Classes the preview keeps: code languages and LocalKit's own placeholders. Anything else could apply app styles. */
const PREVIEW_CLASS = /^(?:language-[\w+#.-]+|lk-mermaid|lk-note-mermaid|lk-note-frontmatter)$/;

/**
 * The live preview renders inside the app, so user HTML must not reach beyond
 * its box: no <style> or style attributes (restyling LocalKit, full-page
 * overlays, CSS network requests), no forms or other controls (fake sign-in
 * forms), no roles/tabindex/popovers, and only LocalKit's own classes.
 */
const PREVIEW_CONFIG: Config = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: [
    'style',
    'form',
    'button',
    'textarea',
    'select',
    'option',
    'optgroup',
    'datalist',
    'dialog',
    'main',
    'marquee',
    'meter',
    'progress',
    'output',
  ],
  FORBID_ATTR: ['style', 'role', 'tabindex', 'autoplay', 'popover', 'popovertarget', 'popovertargetaction', 'accesskey', 'contenteditable'],
};

let previewPurifier: ReturnType<typeof DOMPurify> | null = null;
function purifier() {
  if (previewPurifier) return previewPurifier;
  const instance = DOMPurify(window);
  instance.addHook('uponSanitizeAttribute', (_node, data) => {
    if (data.attrName !== 'class') return;
    const kept = data.attrValue.split(/\s+/).filter((c) => PREVIEW_CLASS.test(c));
    if (kept.length) data.attrValue = kept.join(' ');
    else data.keepAttr = false;
  });
  instance.addHook('afterSanitizeAttributes', (node) => {
    // Task checkboxes are the only inputs the preview renders.
    if (node.nodeName === 'INPUT' && ((node as HTMLInputElement).type !== 'checkbox' || !node.hasAttribute('data-lk-task'))) {
      node.remove();
    }
  });
  previewPurifier = instance;
  return instance;
}

export type RenderMode = 'preview' | 'export';

function renderSource(src: string, mode: RenderMode): string {
  resetSlugs();
  const tokens = marked.lexer(src);
  annotateTaskLines(tokens);
  const raw = marked.parser(tokens);
  if (mode === 'export') return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
  return purifier().sanitize(raw, PREVIEW_CONFIG);
}

/**
 * Markdown (GFM: tables, task lists, strikethrough, autolinks) to sanitized HTML.
 * Mermaid fences become `<div class="lk-note-mermaid" data-mermaid="pending">` placeholders
 * whose `<code>` text is the diagram source (shown until rendered; read it with
 * {@link mermaidSource}); other fences keep a `language-*` class for highlighting.
 * Task checkboxes carry their 0-based source line in `data-lk-task`.
 *
 * `preview` (default) output is safe to insert into the app; `export` keeps user
 * styling for standalone documents.
 */
export function renderMarkdown(markdown: string, mode: RenderMode = 'preview'): string {
  return renderSource(prepareSource(markdown), mode);
}

/** The Mermaid source of a placeholder produced by {@link renderMarkdown}. */
export function mermaidSource(placeholder: Element): string {
  return placeholder.querySelector('code')?.textContent ?? '';
}

// ---------------------------------------------------------------------------
// Large notes: independent chunks that can be rendered (and cached) one by one
// ---------------------------------------------------------------------------

export interface SourceChunk {
  text: string;
  /** 0-based line of the chunk's first line in the whole source. */
  line: number;
}

/** Notes up to this size render as one piece; bigger ones are split into chunks. */
export const CHUNK_THRESHOLD = 150_000;
const MIN_CHUNK = 2_000;
const MAX_CHUNK = 48_000;
/** HTML elements that can hold blank lines and Markdown blocks: a chunk never ends inside one. */
const BLOCK_CONTAINERS = new Set([
  'address',
  'article',
  'aside',
  'audio',
  'blockquote',
  'center',
  'details',
  'dialog',
  'div',
  'dl',
  'fieldset',
  'figure',
  'footer',
  'form',
  'header',
  'iframe',
  'main',
  'math',
  'nav',
  'noscript',
  'object',
  'ol',
  'picture',
  'pre',
  'script',
  'section',
  'select',
  'style',
  'svg',
  'table',
  'template',
  'textarea',
  'ul',
  'video',
]);

function lineHash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < Math.min(text.length, 48); i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

/**
 * Splits prepared Markdown into chunks that render the same on their own: cuts
 * only at blank lines outside code fences, HTML blocks and comments, before a
 * line that starts a new top-level block. Boundaries depend on the nearby text
 * (headings, a hash of the next line), not on offsets, so an edit re-renders
 * only the chunk it is in.
 */
export function splitChunks(src: string, threshold = CHUNK_THRESHOLD): SourceChunk[] {
  if (src.length <= threshold) return [{ text: src, line: 0 }];
  const chunks: SourceChunk[] = [];
  let start = 0;
  let startLine = 0;
  let line = 0;
  let pos = 0;
  let fence: { char: string; size: number } | null = null;
  let htmlDepth = 0;
  let inComment = false;
  let prevBlank = false;
  while (pos <= src.length) {
    const nl = src.indexOf('\n', pos);
    const end = nl === -1 ? src.length : nl;
    const text = src.slice(pos, end);
    const blank = text.trim() === '';
    // A blank line followed by an unindented line: the previous blocks are complete.
    if (prevBlank && !blank && !fence && !inComment && htmlDepth === 0 && !/^[ \t]/.test(text)) {
      const size = pos - start;
      const natural = /^#{1,6}(\s|$)/.test(text) || lineHash(text) % 8 === 0;
      if ((natural && size >= MIN_CHUNK) || size >= MAX_CHUNK) {
        chunks.push({ text: src.slice(start, pos), line: startLine });
        start = pos;
        startLine = line;
      }
    }
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(text);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence.char && fenceMatch[1].length >= fence.size && /^ {0,3}[`~]+\s*$/.test(text)) fence = null;
    } else if (fenceMatch) {
      fence = { char: fenceMatch[1][0], size: fenceMatch[1].length };
    } else if (text.includes('<')) {
      if (inComment) {
        if (text.includes('-->')) inComment = false;
      } else if (text.lastIndexOf('<!--') > text.lastIndexOf('-->')) {
        inComment = true;
      }
      // Inline code like `<div>` is text, not HTML.
      for (const m of text.replace(/`[^`]*`/g, '').matchAll(/<(\/?)([a-zA-Z][\w-]*)(?=[\s/>])[^>]*?(\/?)>/g)) {
        if (m[3] || !BLOCK_CONTAINERS.has(m[2].toLowerCase())) continue;
        htmlDepth = Math.max(0, htmlDepth + (m[1] ? -1 : 1));
      }
    } else if (inComment && text.includes('-->')) {
      inComment = false;
    }
    prevBlank = blank && !fence;
    if (nl === -1) break;
    pos = nl + 1;
    line++;
  }
  chunks.push({ text: src.slice(start), line: startLine });
  return chunks;
}

const DEFINITION = /^ {0,3}\[(?!\^)[^\]\n]+\]:[ \t]*\S.*$/gm;

/** Link reference definitions (`[id]: url`) apply to the whole note, so every chunk gets them. */
export function referenceDefinitions(src: string): string {
  if (!src.includes(']:')) return '';
  return (src.match(DEFINITION) ?? []).join('\n');
}

/** Renders one chunk; task lines are relative to the chunk. */
export function renderChunk(text: string, definitions: string, mode: RenderMode = 'preview'): string {
  return renderSource(definitions ? `${text}\n\n${definitions}\n` : text, mode);
}

// ---------------------------------------------------------------------------
// Standalone export
// ---------------------------------------------------------------------------

const EXPORT_CSS = `
:root{color-scheme:light dark;--bg:#fff;--fg:#1f2328;--muted:#59636e;--line:#d1d9e0;--soft:#f6f8fa;--link:#0969da;
--kw:#cf222e;--str:#0a3069;--num:#0550ae;--com:#6e7781;--fn:#8250df;--prop:#0550ae;--tag:#116329;--type:#953800;--attr:#6639ba}
@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#9198a1;--line:#3d444d;--soft:#161b22;--link:#4493f8;
--kw:#ff7b72;--str:#a5d6ff;--num:#79c0ff;--com:#8b949e;--fn:#d2a8ff;--prop:#79c0ff;--tag:#7ee787;--type:#ffa657;--attr:#d2a8ff}}
*{box-sizing:border-box}
body{max-width:780px;margin:40px auto;padding:0 20px;font:16px/1.7 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--fg);background:var(--bg);overflow-wrap:anywhere}
h1,h2,h3,h4,h5,h6{line-height:1.3;margin:1.6em 0 .6em;font-weight:650}h1{font-size:1.9em;margin-top:0}
h2{font-size:1.45em;border-bottom:1px solid var(--line);padding-bottom:.3em}h3{font-size:1.2em}
p,ul,ol,blockquote,pre,table,.lk-mermaid{margin:0 0 1em}a{color:var(--link)}
ul,ol{padding-left:1.5em}li+li{margin-top:.25em}li:has(>input[type=checkbox]),li:has(>p:first-child>input[type=checkbox]){list-style:none;margin-left:-1.4em}
li input[type=checkbox]{margin-right:.5em}
code{font:.87em ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--soft);border:1px solid var(--line);padding:.1em .35em;border-radius:5px}
pre{background:var(--soft);border:1px solid var(--line);padding:14px 16px;border-radius:10px;overflow:auto;font-size:14px;line-height:1.6}
pre code{background:none;border:0;padding:0;font-size:inherit}
blockquote{padding:.1em 0 .1em 1em;color:var(--muted);border-left:3px solid var(--line)}
table{border-collapse:collapse;display:block;max-width:100%;width:max-content;overflow:auto}
th,td{border:1px solid var(--line);padding:6px 12px}th{background:var(--soft)}
img{max-width:100%}hr{border:0;border-top:1px solid var(--line);margin:2em 0}
.lk-mermaid{display:flex;justify-content:center;overflow-x:auto}.lk-mermaid svg{max-width:100%;height:auto}
.lk-mermaid[data-theme=dark]{background:#181b22;border-radius:10px;padding:12px}
.lk-mermaid[data-theme=light]{background:#fff;border-radius:10px;padding:12px}
.tok-keyword{color:var(--kw)}.tok-string,.tok-string2{color:var(--str)}.tok-number,.tok-bool,.tok-atom,.tok-literal{color:var(--num)}
.tok-comment,.tok-meta{color:var(--com);font-style:italic}.tok-function{color:var(--fn)}.tok-propertyName{color:var(--prop)}
.tok-typeName,.tok-className,.tok-namespace{color:var(--type)}.tok-tagName{color:var(--tag)}.tok-attributeName{color:var(--attr)}
.tok-heading{color:var(--prop);font-weight:600}.tok-inserted{color:#1a7f37}.tok-deleted{color:#cf222e}
@media print{body{margin:0;max-width:none}pre,blockquote,table,.lk-mermaid,img{break-inside:avoid}}
`.trim();

/** Sanitizes rendered note HTML (which may contain highlighted code and Mermaid SVGs) for a standalone document. */
export function sanitizeExportBody(bodyHtml: string): string {
  return DOMPurify.sanitize(bodyHtml, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    ADD_TAGS: ['style'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'foreignObject'],
    FORBID_ATTR: ['contenteditable'],
  });
}

/** Wraps already sanitized body HTML in a complete, styled HTML document. */
export function htmlDocument(title: string, safeBody: string, options: { csp?: string } = {}): string {
  const csp = options.csp ? `\n<meta http-equiv="Content-Security-Policy" content="${escapeHtml(options.csp)}">` : '';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">${csp}
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="LocalKit Markdown Notes">
<title>${escapeHtml(title)}</title>
<style>
${EXPORT_CSS}
</style>
</head>
<body>
<article>
${safeBody}
</article>
</body>
</html>
`;
}

/**
 * Wraps rendered note HTML (which may contain highlighted code and Mermaid SVGs)
 * in a standalone, styled HTML document. The body is sanitized again, so scripts,
 * event handlers and javascript: URLs never reach the file.
 */
export function standaloneHtml(title: string, bodyHtml: string): string {
  return htmlDocument(title, sanitizeExportBody(bodyHtml));
}
