import DOMPurify from 'dompurify';
import { Marked, type Tokens } from 'marked';

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

function createMarked(): Marked {
  const marked = new Marked({ gfm: true, breaks: false });
  let slugs = new Map<string, number>();
  marked.use({
    hooks: {
      preprocess(markdown) {
        slugs = new Map();
        return markdown;
      },
    },
    renderer: {
      code({ text, lang }: Tokens.Code) {
        const language = (lang ?? '').trim().split(/\s+/)[0]?.toLowerCase();
        if (language === 'mermaid') {
          // The source lives only in the <code> text: DOMPurify drops attribute values that
          // contain "-->" (SAFE_FOR_XML), which almost every Mermaid diagram has.
          return `<div class="lk-mermaid lk-note-mermaid" data-mermaid="pending"><pre><code>${escapeHtml(text)}</code></pre></div>\n`;
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
    },
  });
  return marked;
}

const marked = createMarked();

/**
 * Markdown (GFM: tables, task lists, strikethrough, autolinks) to sanitized HTML.
 * Mermaid fences become `<div class="lk-note-mermaid" data-mermaid="pending">` placeholders
 * whose `<code>` text is the diagram source (shown until rendered; read it with
 * {@link mermaidSource}); other fences keep a `language-*` class for highlighting.
 */
export function renderMarkdown(markdown: string): string {
  const raw = marked.parse(markdown, { async: false });
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
}

/** The Mermaid source of a placeholder produced by {@link renderMarkdown}. */
export function mermaidSource(placeholder: Element): string {
  return placeholder.querySelector('code')?.textContent ?? '';
}

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
ul,ol{padding-left:1.5em}li+li{margin-top:.25em}li:has(>input[type=checkbox]){list-style:none;margin-left:-1.4em}
li>input[type=checkbox]{margin-right:.5em}
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

/**
 * Wraps rendered note HTML (which may contain highlighted code and Mermaid SVGs)
 * in a standalone, styled HTML document. The body is sanitized again, so scripts,
 * event handlers and javascript: URLs never reach the file.
 */
export function standaloneHtml(title: string, bodyHtml: string): string {
  const body = DOMPurify.sanitize(bodyHtml, {
    USE_PROFILES: { html: true, svg: true, svgFilters: true },
    ADD_TAGS: ['style'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'foreignObject'],
    FORBID_ATTR: ['contenteditable'],
  });
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="LocalKit Markdown Notes">
<title>${escapeHtml(title)}</title>
<style>
${EXPORT_CSS}
</style>
</head>
<body>
<article>
${body}
</article>
</body>
</html>
`;
}
