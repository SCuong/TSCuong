import { blockRemoteContent } from '@/lib/remoteContent';
import { describeMermaidError } from '../../diagrams/lib/diagrams';
import { cachedHighlight, highlightCode } from './highlight';
import { htmlDocument, mermaidSource, prepareSource, referenceDefinitions, renderChunk, sanitizeExportBody, splitChunks } from './render';

export type DiagramTheme = 'default' | 'dark';
export type DiagramRenderer = (source: string, theme: DiagramTheme) => Promise<string>;

export interface EnhanceOptions {
  theme: DiagramTheme;
  /** Renders Mermaid source to SVG. Loaded lazily so Mermaid stays out of the notes chunk until needed. */
  renderDiagram: DiagramRenderer;
  /** Set `cancelled` to stop applying results (e.g. the preview re-rendered). */
  token?: { cancelled: boolean };
}

const svgCache = new Map<string, string>();
const errorCache = new Map<string, string>();
const MAX_CACHE = 60;

function remember<V>(map: Map<string, V>, key: string, value: V) {
  if (map.size >= MAX_CACHE) map.delete(map.keys().next().value as string);
  map.set(key, value);
}

function languageOf(code: Element): string {
  const cls = [...code.classList].find((c) => c.startsWith('language-'));
  return cls ? cls.slice('language-'.length) : '';
}

function showDiagram(el: HTMLElement, svg: string, theme: DiagramTheme) {
  el.innerHTML = svg;
  el.dataset.mermaid = 'done';
  el.dataset.theme = theme === 'dark' ? 'dark' : 'light';
}

function showDiagramError(el: HTMLElement, message: string) {
  el.dataset.mermaid = 'error';
  el.querySelector('.lk-note-mermaid-error')?.remove();
  const p = document.createElement('p');
  p.className = 'lk-note-mermaid-error';
  p.setAttribute('role', 'note');
  p.textContent = `Diagram error: ${message}`;
  el.appendChild(p);
}

function describeError(error: unknown, source: string): string {
  const { line, column, message } = describeMermaidError(error, source);
  if (line === null) return message;
  return `line ${line}${column !== null ? `, column ${column}` : ''}: ${message}`;
}

/** True when {@link enhancePreview} still has work to do in `root` (e.g. an earlier run was cancelled). */
export function needsEnhancement(root: ParentNode): boolean {
  return root.querySelector('.lk-note-mermaid[data-mermaid="pending"], .lk-note-mermaid[data-mermaid="rendering"], pre > code[class*="language-"]:not([data-lk-hl])') !== null;
}

/**
 * Upgrades rendered note HTML in place: syntax-highlights fenced code and renders
 * Mermaid placeholders to SVG (failed diagrams keep their source plus an error line).
 * Resolves when every block has been processed.
 */
export async function enhancePreview(root: HTMLElement, options: EnhanceOptions): Promise<void> {
  const { theme, renderDiagram, token } = options;
  const jobs: Array<Promise<void>> = [];

  for (const code of root.querySelectorAll<HTMLElement>('pre > code[class*="language-"]:not([data-lk-hl])')) {
    const lang = languageOf(code);
    const source = code.textContent ?? '';
    const cached = cachedHighlight(source, lang);
    if (cached !== undefined) {
      code.innerHTML = cached;
      code.dataset.lkHl = '';
      continue;
    }
    jobs.push(
      highlightCode(source, lang)
        .then((html) => {
          if (token?.cancelled || code.textContent !== source) return;
          if (html !== null) code.innerHTML = html;
          code.dataset.lkHl = '';
        })
        .catch(() => undefined),
    );
  }

  for (const el of root.querySelectorAll<HTMLElement>('.lk-note-mermaid[data-mermaid="pending"], .lk-note-mermaid[data-mermaid="rendering"]')) {
    const source = mermaidSource(el).trim();
    if (!source) continue;
    const key = `${theme}\u0000${source}`;
    const svg = svgCache.get(key);
    if (svg !== undefined) {
      showDiagram(el, svg, theme);
      continue;
    }
    const failed = errorCache.get(key);
    if (failed !== undefined) {
      showDiagramError(el, failed);
      continue;
    }
    el.dataset.mermaid = 'rendering';
    jobs.push(
      renderDiagram(source, theme)
        .then((out) => {
          remember(svgCache, key, out);
          if (!token?.cancelled) showDiagram(el, out, theme);
        })
        .catch((error: unknown) => {
          const message = describeError(error, source);
          remember(errorCache, key, message);
          if (!token?.cancelled) showDiagramError(el, message);
        }),
    );
  }

  await Promise.all(jobs);
}

/** The text of a task list item without its nested lists, for the checkbox's accessible name. */
function taskText(item: Element | null): string {
  if (!item) return '';
  let text = '';
  for (const node of item.childNodes) {
    if (node instanceof Element && (node.tagName === 'UL' || node.tagName === 'OL')) break;
    text += node.textContent ?? '';
  }
  return text.replace(/\s+/g, ' ').trim().slice(0, 100);
}

/** Makes the live preview interactive: clickable task checkboxes and external links in a new tab. */
export function prepareInteractive(root: HTMLElement) {
  for (const box of root.querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-lk-task]')) {
    box.disabled = false;
    const text = taskText(box.closest('li'));
    box.setAttribute('aria-label', text ? `Task: ${text}` : 'Task');
  }
  for (const a of root.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const href = a.getAttribute('href') ?? '';
    if (/^(https?:|mailto:)/i.test(href)) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
  }
  // Code blocks scroll horizontally; make them keyboard-reachable so long lines can be read.
  for (const pre of root.querySelectorAll<HTMLPreElement>('pre')) {
    pre.tabIndex = 0;
    if (!pre.hasAttribute('aria-label')) pre.setAttribute('aria-label', 'Code block');
  }
}

/** Lets the browser paint and handle input between slices of long work. */
export function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Printing with remote content still blocked: nothing may be fetched except inline data. */
const OFFLINE_CSP = "default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:; style-src 'unsafe-inline'";

/**
 * A complete, sanitized, styled HTML document for a note (diagrams rendered with the light theme).
 * `blockRemote` keeps remote images out (placeholders plus a Content-Security-Policy), for printing
 * a note whose remote images the user has not chosen to load.
 */
export async function buildNoteHtml(
  title: string,
  markdown: string,
  renderDiagram: DiagramRenderer,
  options: { blockRemote?: boolean } = {},
): Promise<string> {
  const src = prepareSource(markdown);
  const chunks = splitChunks(src);
  const definitions = chunks.length > 1 ? referenceDefinitions(src) : '';
  const parts: string[] = [];
  let slice = performance.now();
  for (const chunk of chunks) {
    const container = document.createElement('div');
    container.innerHTML = renderChunk(chunk.text, definitions, 'export');
    await enhancePreview(container, { theme: 'default', renderDiagram });
    // Diagrams that failed keep their source; drop the placeholder attribute noise.
    for (const el of container.querySelectorAll<HTMLElement>('[data-mermaid], [data-lk-task], [data-lk-hl]')) {
      el.removeAttribute('data-mermaid');
      el.removeAttribute('data-lk-task');
      el.removeAttribute('data-lk-hl');
    }
    const body = sanitizeExportBody(container.innerHTML);
    parts.push(options.blockRemote ? blockRemoteContent(body).html : body);
    if (performance.now() - slice > 30) {
      await yieldToBrowser();
      slice = performance.now();
    }
  }
  return htmlDocument(title, parts.join('\n'), options.blockRemote ? { csp: OFFLINE_CSP } : {});
}
