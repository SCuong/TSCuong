import { describeMermaidError } from '../../diagrams/lib/diagrams';
import { cachedHighlight, highlightCode } from './highlight';
import { mermaidSource, renderMarkdown, standaloneHtml } from './render';

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
  const { line, message } = describeMermaidError(error, source);
  return line !== null ? `line ${line}: ${message}` : message;
}

/**
 * Upgrades rendered note HTML in place: syntax-highlights fenced code and renders
 * Mermaid placeholders to SVG (failed diagrams keep their source plus an error line).
 * Resolves when every block has been processed.
 */
export async function enhancePreview(root: HTMLElement, options: EnhanceOptions): Promise<void> {
  const { theme, renderDiagram, token } = options;
  const jobs: Array<Promise<void>> = [];

  for (const code of root.querySelectorAll<HTMLElement>('pre > code[class*="language-"]')) {
    const lang = languageOf(code);
    const source = code.textContent ?? '';
    const cached = cachedHighlight(source, lang);
    if (cached !== undefined) {
      code.innerHTML = cached;
      continue;
    }
    jobs.push(
      highlightCode(source, lang)
        .then((html) => {
          if (html !== null && !token?.cancelled && code.textContent === source) code.innerHTML = html;
        })
        .catch(() => undefined),
    );
  }

  for (const el of root.querySelectorAll<HTMLElement>('.lk-note-mermaid[data-mermaid="pending"]')) {
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

/** Makes the live preview interactive: numbered, clickable task checkboxes and external links in a new tab. */
export function prepareInteractive(root: HTMLElement) {
  root.querySelectorAll<HTMLInputElement>('li > input[type="checkbox"]').forEach((box, index) => {
    box.disabled = false;
    box.dataset.task = String(index);
    box.setAttribute('aria-label', `Toggle task ${index + 1}`);
  });
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

/** A complete, sanitized, styled HTML document for a note (diagrams rendered with the light theme). */
export async function buildNoteHtml(title: string, markdown: string, renderDiagram: DiagramRenderer): Promise<string> {
  const container = document.createElement('div');
  container.innerHTML = renderMarkdown(markdown);
  await enhancePreview(container, { theme: 'default', renderDiagram });
  // Diagrams that failed keep their source; drop the placeholder attribute noise.
  for (const el of container.querySelectorAll<HTMLElement>('[data-mermaid]')) el.removeAttribute('data-mermaid');
  return standaloneHtml(title, container.innerHTML);
}
