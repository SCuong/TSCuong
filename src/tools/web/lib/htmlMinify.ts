import { lineColumn } from './sizes';

/**
 * A conservative HTML minifier built on a small tokenizer.
 *
 * - Comments are removed, except conditional comments (`<!--[if IE]>…<![endif]-->`,
 *   downlevel-revealed forms) and, optionally, comments starting with `!`.
 * - Whitespace is collapsed to a single space; whitespace next to block-level
 *   elements is removed. Inline boundaries keep one space so text never merges.
 * - Content of <pre>, <textarea>, <script> and <style> is never re-flowed.
 * - Optionally minifies <style>/style="" with CSSO and <script> with Terser.
 */

export interface HtmlMinifyOptions {
  removeComments: boolean;
  /** Keep comments that start with "!" (license notes). */
  keepBangComments: boolean;
  collapseWhitespace: boolean;
  minifyCss: boolean;
  minifyJs: boolean;
}

export const DEFAULT_HTML_OPTIONS: HtmlMinifyOptions = {
  removeComments: true,
  keepBangComments: true,
  collapseWhitespace: true,
  minifyCss: true,
  minifyJs: true,
};

export class HtmlMinifyError extends Error {
  override name = 'HtmlMinifyError';
  constructor(
    message: string,
    public line: number,
    public column: number,
  ) {
    super(`Line ${line}, column ${column}: ${message}`);
  }
}

type Token =
  | { type: 'text'; value: string }
  | { type: 'comment'; value: string; keep: boolean }
  | { type: 'raw'; value: string } // doctype, CDATA, processing instructions: emitted as-is
  | { type: 'open'; name: string; attrs: Attr[]; selfClosing: boolean }
  | { type: 'close'; name: string }
  | { type: 'rawtext'; parent: string; value: string; attrs: Attr[] };

export interface Attr {
  name: string;
  /** null for boolean attributes. */
  value: string | null;
  quote: '"' | "'" | '';
}

const RAW_TEXT = new Set(['script', 'style', 'textarea', 'xmp', 'plaintext']);

/** Elements whose surrounding whitespace never renders (block-level or not rendered at all in flow). */
const BLOCK = new Set([
  'html', 'head', 'body', 'title', 'meta', 'link', 'base',
  'address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'dd', 'div', 'dl', 'dt', 'fieldset',
  'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr',
  'li', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'thead', 'tbody', 'tfoot',
  'tr', 'td', 'th', 'caption', 'colgroup', 'col', 'ul', 'option', 'optgroup', 'legend', 'source', 'track',
  'center', 'frameset', 'frame', 'noframes',
]);

function isConditional(body: string): boolean {
  return /^\[if\b/i.test(body) || /^<!\[endif\]/i.test(body) || /<!\[endif\]$/i.test(body) || /^\s*<!\[endif\]/i.test(body);
}

function parseAttrs(src: string, start: number, fullText: string): { attrs: Attr[]; end: number; selfClosing: boolean } {
  const attrs: Attr[] = [];
  let i = start;
  const n = src.length;
  while (i < n) {
    while (i < n && /\s/.test(src[i])) i++;
    if (i >= n) break;
    if (src[i] === '>') return { attrs, end: i + 1, selfClosing: false };
    if (src[i] === '/' && src[i + 1] === '>') return { attrs, end: i + 2, selfClosing: true };
    if (src[i] === '/') {
      i++;
      continue;
    }
    let name = '';
    while (i < n && !/[\s=>]/.test(src[i]) && !(src[i] === '/' && src[i + 1] === '>')) name += src[i++];
    while (i < n && /\s/.test(src[i])) i++;
    if (src[i] === '=') {
      i++;
      while (i < n && /\s/.test(src[i])) i++;
      const q = src[i];
      if (q === '"' || q === "'") {
        const close = src.indexOf(q, i + 1);
        if (close < 0) {
          const { line, column } = lineColumn(fullText, i);
          throw new HtmlMinifyError(`The value of attribute "${name}" is missing its closing ${q} quote.`, line, column);
        }
        attrs.push({ name, value: src.slice(i + 1, close), quote: q });
        i = close + 1;
      } else {
        let v = '';
        while (i < n && !/[\s>]/.test(src[i])) v += src[i++];
        attrs.push({ name, value: v, quote: '' });
      }
    } else if (name) {
      attrs.push({ name, value: null, quote: '' });
    }
  }
  const { line, column } = lineColumn(fullText, start);
  throw new HtmlMinifyError('A tag is not closed with ">".', line, column);
}

export function tokenize(html: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let text = '';
  const flushText = () => {
    if (text) tokens.push({ type: 'text', value: text });
    text = '';
  };
  const n = html.length;
  while (i < n) {
    const c = html[i];
    if (c !== '<') {
      text += c;
      i++;
      continue;
    }
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      if (end < 0) {
        const { line, column } = lineColumn(html, i);
        throw new HtmlMinifyError('This comment is never closed with "-->".', line, column);
      }
      flushText();
      const body = html.slice(i + 4, end);
      tokens.push({ type: 'comment', value: html.slice(i, end + 3), keep: isConditional(body) });
      i = end + 3;
      continue;
    }
    if (html.startsWith('<![CDATA[', i)) {
      const end = html.indexOf(']]>', i);
      flushText();
      tokens.push({ type: 'raw', value: html.slice(i, end < 0 ? n : end + 3) });
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (html[i + 1] === '!' || html[i + 1] === '?') {
      // Doctype, downlevel-revealed conditional (<![endif]>) or processing instruction.
      const end = html.indexOf('>', i);
      flushText();
      const raw = html.slice(i, end < 0 ? n : end + 1);
      tokens.push({ type: 'raw', value: /^<!doctype/i.test(raw) ? raw.replace(/\s+/g, ' ') : raw });
      i = end < 0 ? n : end + 1;
      continue;
    }
    const close = /^<\/([A-Za-z][\w:.-]*)\s*>/.exec(html.slice(i, i + 200));
    if (close) {
      flushText();
      tokens.push({ type: 'close', name: close[1] });
      i += close[0].length;
      continue;
    }
    const open = /^<([A-Za-z][\w:.-]*)/.exec(html.slice(i, i + 200));
    if (!open) {
      // A stray "<" (e.g. "a < b") is text.
      text += c;
      i++;
      continue;
    }
    flushText();
    const rawName = open[1];
    const name = rawName.toLowerCase();
    const { attrs, end, selfClosing } = parseAttrs(html, i + open[0].length, html);
    i = end;
    if (RAW_TEXT.has(name) && !selfClosing) {
      const re = new RegExp(`</(${name})\\s*>`, 'i');
      const m = re.exec(html.slice(i));
      const contentEnd = m ? i + m.index : n;
      tokens.push({ type: 'open', name: rawName, attrs, selfClosing });
      tokens.push({ type: 'rawtext', parent: name, value: html.slice(i, contentEnd), attrs });
      if (m) tokens.push({ type: 'close', name: m[1] });
      i = m ? contentEnd + m[0].length : n;
      continue;
    }
    tokens.push({ type: 'open', name: rawName, attrs, selfClosing });
  }
  flushText();
  return tokens;
}

function tagName(t: Token | undefined): string | null {
  return t && (t.type === 'open' || t.type === 'close') ? t.name.toLowerCase() : null;
}

/** Is whitespace next to this token insignificant? */
function isBoundary(t: Token | undefined): boolean {
  if (!t) return true; // start or end of document
  if (t.type === 'raw') return true;
  const name = tagName(t);
  return name !== null && BLOCK.has(name);
}

function renderAttrs(attrs: Attr[], collapse: boolean): string {
  return attrs
    .map((a) => {
      if (a.value === null) return ` ${a.name}`;
      let v = a.value;
      if (collapse && a.name.toLowerCase() === 'class') v = v.trim().replace(/\s+/g, ' ');
      return ` ${a.name}=${a.quote}${v}${a.quote}`;
    })
    .join('');
}

export interface MinifyHooks {
  css?: (css: string) => Promise<string>;
  cssDeclarations?: (css: string) => Promise<string>;
  js?: (js: string, module: boolean) => Promise<string>;
}

const JS_TYPES = /^(|text\/javascript|application\/javascript|application\/ecmascript|text\/ecmascript|module)$/i;
const JSON_TYPES = /^(application\/(ld\+)?json|importmap|speculationrules)$/i;

export async function minifyHtml(html: string, options: HtmlMinifyOptions = DEFAULT_HTML_OPTIONS, hooks: MinifyHooks = {}): Promise<string> {
  let tokens = tokenize(html);

  // Drop removable comments, then merge text that becomes adjacent.
  if (options.removeComments) {
    tokens = tokens.filter((t) => t.type !== 'comment' || t.keep || (options.keepBangComments && /^<!--!/.test(t.value)));
  }
  const merged: Token[] = [];
  for (const t of tokens) {
    const last = merged[merged.length - 1];
    if (t.type === 'text' && last?.type === 'text') last.value += t.value;
    else merged.push(t.type === 'text' ? { ...t } : t);
  }

  let out = '';
  let preDepth = 0;
  for (let idx = 0; idx < merged.length; idx++) {
    const t = merged[idx];
    switch (t.type) {
      case 'comment':
      case 'raw':
        out += t.value;
        break;
      case 'open': {
        const name = t.name.toLowerCase();
        let attrs = t.attrs;
        if (options.minifyCss && hooks.cssDeclarations) {
          attrs = await Promise.all(
            attrs.map(async (a) => {
              if (a.name.toLowerCase() !== 'style' || !a.value) return a;
              try {
                const css = await hooks.cssDeclarations!(a.value);
                // Keep the original quote style; fall back to the original if quoting would break.
                if ((a.quote === '"' && css.includes('"')) || (a.quote === "'" && css.includes("'")) || (!a.quote && /[\s"'=<>`]/.test(css))) return a;
                return { ...a, value: css };
              } catch {
                return a;
              }
            }),
          );
        }
        const last = attrs[attrs.length - 1];
        const slash = t.selfClosing ? (last && last.value !== null && last.quote === '' ? ' /' : '/') : '';
        out += `<${t.name}${renderAttrs(attrs, options.collapseWhitespace)}${slash}>`;
        if (name === 'pre' && !t.selfClosing) preDepth++;
        break;
      }
      case 'close':
        out += `</${t.name}>`;
        if (t.name.toLowerCase() === 'pre' && preDepth > 0) preDepth--;
        break;
      case 'rawtext': {
        let value = t.value;
        const type = (t.attrs.find((a) => a.name.toLowerCase() === 'type')?.value ?? '').trim();
        if (t.parent === 'style' && options.minifyCss && hooks.css && value.trim()) {
          value = await hooks.css(value);
        } else if (t.parent === 'script' && value.trim()) {
          if (options.minifyJs && hooks.js && JS_TYPES.test(type)) {
            value = await hooks.js(value, type.toLowerCase() === 'module');
          } else if (JSON_TYPES.test(type)) {
            try {
              value = JSON.stringify(JSON.parse(value)).replace(/</g, '\\u003c');
            } catch {
              /* leave invalid JSON untouched */
            }
          }
        }
        out += value;
        break;
      }
      case 'text': {
        if (!options.collapseWhitespace || preDepth > 0) {
          out += t.value;
          break;
        }
        let v = t.value.replace(/[ \t\n\r\f]+/g, ' ');
        if (v.startsWith(' ') && isBoundary(merged[idx - 1])) v = v.slice(1);
        if (v.endsWith(' ') && isBoundary(merged[idx + 1])) v = v.slice(0, -1);
        out += v;
        break;
      }
    }
  }
  return out;
}

/** Hooks that use CSSO and Terser, loaded on demand. Errors carry line numbers relative to the block. */
export function defaultHooks(): MinifyHooks {
  return {
    css: async (css) => (await import('csso')).minify(css, { restructure: false }).css,
    cssDeclarations: async (css) => (await import('csso')).minifyBlock(css, { restructure: false }).css,
    js: async (js, module) => {
      const { minify } = await import('terser');
      try {
        const r = await minify(js, { module, compress: true, mangle: true, format: { inline_script: true } });
        return r.code ?? js;
      } catch (error) {
        const e = error as { message?: string; line?: number; col?: number };
        throw new Error(`Inline script error${e.line ? ` (script line ${e.line}, column ${(e.col ?? 0) + 1})` : ''}: ${e.message ?? 'could not be minified'}.`, { cause: error });
      }
    },
  };
}
