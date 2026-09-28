import type { LanguageDescription } from '@codemirror/language';
import { classHighlighter, highlightTree } from '@lezer/highlight';
import { escapeHtml } from './render';

let languagesPromise: Promise<readonly LanguageDescription[]> | null = null;
function languages() {
  languagesPromise ??= import('@codemirror/language-data').then((m) => m.languages);
  return languagesPromise;
}

const cache = new Map<string, string>();
const MAX_CACHE = 300;
const MAX_HIGHLIGHT_CHARS = 200_000;

/** Highlighted HTML from the cache, if this block was highlighted before. */
export function cachedHighlight(code: string, lang: string): string | undefined {
  return cache.get(`${lang}\u0000${code}`);
}

/**
 * Syntax-highlights code with the matching CodeMirror/Lezer grammar (loaded on
 * demand) and returns HTML using the global `tok-*` classes. Returns null when
 * the language is unknown or the block is too large.
 */
export async function highlightCode(code: string, lang: string): Promise<string | null> {
  const key = `${lang}\u0000${code}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (!lang || code.length > MAX_HIGHLIGHT_CHARS) return null;
  const { LanguageDescription: LD } = await import('@codemirror/language');
  const descs = await languages();
  // Names/aliases first ("javascript", "c++"), then file extensions ("py", "rs", "yml").
  const desc =
    LD.matchLanguageName(descs, lang, true) ??
    (/^[\w+-]+$/.test(lang) ? LD.matchFilename(descs, `file.${lang.toLowerCase()}`) : null);
  if (!desc) return null;
  const support = await desc.load();
  const tree = support.language.parser.parse(code);
  let html = '';
  let pos = 0;
  highlightTree(tree, classHighlighter, (from, to, classes) => {
    if (from > pos) html += escapeHtml(code.slice(pos, from));
    html += `<span class="${classes}">${escapeHtml(code.slice(from, to))}</span>`;
    pos = to;
  });
  if (pos < code.length) html += escapeHtml(code.slice(pos));
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string);
  cache.set(key, html);
  return html;
}
