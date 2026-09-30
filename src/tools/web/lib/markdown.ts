import DOMPurify from 'dompurify';
import { Marked } from 'marked';

export interface MarkdownOptions {
  /** Treat single line breaks as <br>. */
  breaks: boolean;
}

/** GitHub-flavored Markdown to sanitized HTML (scripts, event handlers and javascript: URLs are removed). */
export function markdownToHtml(markdown: string, options: MarkdownOptions): string {
  const marked = new Marked({ gfm: true, breaks: options.breaks });
  const raw = marked.parse(markdown, { async: false });
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } });
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The first heading's text, for a document title. */
export function firstHeading(markdown: string): string | null {
  const m = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/m.exec(markdown);
  return m ? m[1].replace(/[*_`[\]]/g, '').trim() || null : null;
}

const DOC_CSS = `body{max-width:760px;margin:40px auto;padding:0 20px;font:16px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1f2328;background:#fff}
h1,h2,h3,h4{line-height:1.25;margin:1.6em 0 .6em}h1{font-size:2em}h2{font-size:1.5em;border-bottom:1px solid #d1d9e0;padding-bottom:.3em}
a{color:#0969da}code{font:.9em ui-monospace,SFMono-Regular,Menlo,monospace;background:#f6f8fa;padding:.15em .35em;border-radius:5px}
pre{background:#f6f8fa;padding:14px 16px;border-radius:8px;overflow:auto}pre code{background:none;padding:0}
blockquote{margin:0 0 1em;padding:0 1em;color:#59636e;border-left:4px solid #d1d9e0}table{border-collapse:collapse;display:block;overflow:auto}
th,td{border:1px solid #d1d9e0;padding:6px 13px}th{background:#f6f8fa}img{max-width:100%}hr{border:0;border-top:1px solid #d1d9e0;margin:2em 0}
@media (prefers-color-scheme:dark){body{background:#0d1117;color:#e6edf3}a{color:#4493f8}code,pre,th{background:#161b22}th,td,h2{border-color:#3d444d}blockquote{color:#9198a1;border-color:#3d444d}}`;

/** Colors of the app theme, passed into the sandboxed preview so it matches the page. */
export interface PreviewPalette {
  scheme: 'light' | 'dark';
  background: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  border: string;
  borderStrong: string;
  soft: string;
  sunken: string;
  link: string;
  accent: string;
}

const cssValue = (v: string) => v.replace(/[;{}<>]/g, '');

function previewCss(p: PreviewPalette): string {
  return `:root{color-scheme:${p.scheme};--bg:${cssValue(p.background)};--fg:${cssValue(p.text)};--fg2:${cssValue(p.textSecondary)};--muted:${cssValue(p.textMuted)};--line:${cssValue(p.border)};--line2:${cssValue(p.borderStrong)};--soft:${cssValue(p.soft)};--sunken:${cssValue(p.sunken)};--link:${cssValue(p.link)};--accent:${cssValue(p.accent)}}
html{background:var(--bg)}body{margin:0;padding:20px;color:var(--fg);font:15px/1.7 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;overflow-wrap:anywhere}
body>:first-child{margin-top:0}body>:last-child{margin-bottom:0}
h1,h2,h3,h4,h5,h6{font-weight:650;line-height:1.3;letter-spacing:-.01em;margin:1.6em 0 .6em}h1{font-size:1.9em;letter-spacing:-.02em}
h2{font-size:1.45em;padding-bottom:.3em;border-bottom:1px solid var(--line)}h3{font-size:1.2em}h4{font-size:1.05em}
p,ul,ol,dl,blockquote,pre,table,details{margin:0 0 1em}a{color:var(--link);text-decoration:underline;text-underline-offset:2px}
ul,ol{padding-left:1.5em}li+li{margin-top:.25em}li>ul,li>ol{margin:.25em 0 0}
li:has(>input[type=checkbox]){list-style:none;margin-left:-1.4em}li>input[type=checkbox]{margin-right:.5em;vertical-align:-1px;accent-color:var(--accent)}
blockquote{border-left:3px solid var(--line2);padding:.1em 0 .1em 1em;color:var(--fg2)}
code{font:.87em ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--soft);border:1px solid var(--line);border-radius:5px;padding:.1em .35em}
pre{background:var(--sunken);border:1px solid var(--line);border-radius:10px;padding:14px 16px;overflow-x:auto;font-size:13px;line-height:1.6}
pre code{background:none;border:0;padding:0;font-size:inherit}
table{display:block;width:max-content;max-width:100%;overflow-x:auto;border-collapse:collapse;font-size:14px}
th,td{border:1px solid var(--line);padding:6px 12px}th{background:var(--soft);font-weight:600}
hr{border:0;border-top:1px solid var(--line);margin:2em 0}img,video{max-width:100%;height:auto;border-radius:6px}
.lk-remote-img{display:inline-flex;align-items:center;max-width:100%;padding:2px 8px;border:1px dashed var(--line2);border-radius:6px;background:var(--sunken);color:var(--muted);font-size:12.5px;line-height:1.6}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}`;
}

/**
 * The document shown in the sandboxed preview frame. Its Content-Security-Policy blocks every network
 * request (remote images too, unless `allowRemoteImages`), so nothing in the Markdown can contact a
 * server, and styles or fixed-position elements cannot reach the page around it. Links open in a new
 * tab instead of replacing the preview; code blocks can be scrolled with the keyboard.
 */
export function previewDocument(fragment: string, palette: PreviewPalette, allowRemoteImages: boolean): string {
  const remote = allowRemoteImages ? ' https: http:' : '';
  const csp = `default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: blob:${remote}; media-src data: blob:${remote}; font-src data:; form-action 'none'; base-uri 'none'`;
  let body = fragment;
  if (typeof document !== 'undefined') {
    const template = document.createElement('template');
    template.innerHTML = fragment;
    for (const a of template.content.querySelectorAll('a[href]')) {
      if (a.getAttribute('href')?.startsWith('#')) continue;
      a.setAttribute('target', '_blank');
      a.setAttribute('rel', 'noopener noreferrer');
    }
    for (const el of template.content.querySelectorAll('pre, table')) el.setAttribute('tabindex', '0');
    body = template.innerHTML;
  }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="no-referrer">
<style>${previewCss(palette)}</style>
</head>
<body>
${body}
</body>
</html>`;
}

/** Wraps an HTML fragment in a complete, styled HTML document. */
export function standaloneDocument(bodyHtml: string, title: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${DOC_CSS}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>
`;
}
