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
