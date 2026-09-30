import { useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { useDebouncedValue } from '@/lib/hooks';
import { blockRemoteContent } from '@/lib/remoteContent';
import { cn } from '@/lib/utils';
import { RemoteContentNotice } from '@/components/RemoteContentNotice';
import {
  enhancePreview,
  needsEnhancement,
  prepareInteractive,
  yieldToBrowser,
  type DiagramRenderer,
  type DiagramTheme,
} from '../lib/enhance';
import { CHUNK_THRESHOLD, prepareSource, referenceDefinitions, renderChunk, splitChunks } from '../lib/render';

interface ChunkHtml {
  html: string;
  blocked: number;
  hosts: string[];
}

interface Mounted {
  key: string;
  el: HTMLElement;
}

/** Rendered chunks of large notes, so an edit only re-renders the chunk it is in. */
const chunkCache = new Map<string, ChunkHtml>();
let cachedChars = 0;
const MAX_CACHED_CHARS = 24_000_000;

function renderCached(key: string, text: string, definitions: string, allowRemote: boolean): ChunkHtml {
  const hit = chunkCache.get(key);
  if (hit) {
    chunkCache.delete(key);
    chunkCache.set(key, hit);
    return hit;
  }
  const html = renderChunk(text, definitions);
  const result = allowRemote ? { html, blocked: 0, hosts: [] } : blockRemoteContent(html);
  chunkCache.set(key, result);
  cachedChars += key.length + result.html.length;
  while (cachedChars > MAX_CACHED_CHARS && chunkCache.size > 1) {
    const [oldKey, old] = chunkCache.entries().next().value as [string, ChunkHtml];
    chunkCache.delete(oldKey);
    cachedChars -= oldKey.length + old.html.length;
  }
  return result;
}

function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return `${(h >>> 0).toString(36)}:${text.length}`;
}

function makeWrapper(html: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'lk-note-chunk';
  wrapper.innerHTML = html;
  return wrapper;
}

/** Puts exactly `next` into `root`, in order, moving as few nodes as possible. */
function reconcile(root: HTMLElement, next: Mounted[]) {
  const keep = new Set<Element>(next.map((m) => m.el));
  for (const child of [...root.children]) if (!keep.has(child)) child.remove();
  next.forEach(({ el }, i) => {
    const current = root.children[i];
    if (current !== el) root.insertBefore(el, current ?? null);
  });
}

/** Absolute source line of a task checkbox in the preview. */
function taskLine(box: HTMLInputElement): number {
  const chunk = box.closest<HTMLElement>('.lk-note-chunk');
  return Number(chunk?.dataset.line ?? 0) + Number(box.dataset.lkTask);
}

function focusedTaskLine(root: HTMLElement): number | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLInputElement) || !root.contains(active) || active.dataset.lkTask === undefined) return null;
  return taskLine(active);
}

function restoreFocus(root: HTMLElement, line: number | null) {
  if (line === null || root.contains(document.activeElement)) return;
  for (const box of root.querySelectorAll<HTMLInputElement>('input[data-lk-task]')) {
    if (taskLine(box) === line) {
      box.focus({ preventScroll: true });
      return;
    }
  }
}

/**
 * Live Markdown preview. The HTML is sanitized by `renderChunk` (DOMPurify, strict
 * preview profile) and remote content is blocked until the user allows it; code
 * highlighting and Mermaid diagrams are applied after each render. Large notes are
 * split into chunks that are rendered in slices and reused while unchanged, so
 * typing stays responsive.
 */
export function NotePreview({
  content,
  theme,
  renderDiagram,
  allowRemote,
  onAllowRemote,
  onToggleTask,
  className,
}: {
  content: string;
  theme: DiagramTheme;
  renderDiagram: DiagramRenderer;
  allowRemote: boolean;
  onAllowRemote: () => void;
  /** Called with the 0-based source line of the clicked task checkbox. */
  onToggleTask: (line: number) => void;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const debounced = useDebouncedValue(content, content.length > CHUNK_THRESHOLD ? 350 : 150);
  const [remote, setRemote] = useState<{ blocked: number; hosts: string[] }>({ blocked: 0, hosts: [] });
  const [progress, setProgress] = useState<number | null>(null);
  /** The note text the preview currently shows; task clicks wait until it matches the editor. */
  const shown = useRef<string | null>(null);
  const mounted = useRef<Mounted[]>([]);
  const look = useRef<{ theme: DiagramTheme; renderDiagram: DiagramRenderer } | null>(null);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const token = { cancelled: false };
    const focusLine = focusedTaskLine(el);
    const src = prepareSource(debounced);
    const chunks = splitChunks(src);
    const sameLook = look.current?.theme === theme && look.current.renderDiagram === renderDiagram;

    const finish = (next: Mounted[], blocked: number, hosts: string[]) => {
      reconcile(el, next);
      mounted.current = next;
      look.current = { theme, renderDiagram };
      shown.current = debounced;
      setRemote((prev) =>
        prev.blocked === blocked && prev.hosts.join('\n') === hosts.join('\n') ? prev : { blocked, hosts },
      );
      setProgress(null);
      restoreFocus(el, focusLine);
    };

    if (chunks.length === 1) {
      const html = renderChunk(src, '');
      const result = allowRemote ? { html, blocked: 0, hosts: [] } : blockRemoteContent(html);
      const wrapper = makeWrapper(result.html);
      wrapper.dataset.line = '0';
      prepareInteractive(wrapper);
      void enhancePreview(wrapper, { theme, renderDiagram, token });
      finish([{ key: '', el: wrapper }], result.blocked, result.hosts);
      return () => {
        token.cancelled = true;
      };
    }

    void (async () => {
      const definitions = referenceDefinitions(src);
      const prefix = `${allowRemote ? 1 : 0}\u0000${hashText(definitions)}\u0000`;
      const reusable = new Map<string, HTMLElement[]>();
      if (sameLook) {
        for (const m of mounted.current) {
          const list = reusable.get(m.key);
          if (list) list.push(m.el);
          else reusable.set(m.key, [m.el]);
        }
      }
      // First paint of a large note: show chunks as they are ready.
      const progressive = mounted.current.length === 0 || !sameLook;
      if (progressive) {
        mounted.current = [];
        el.replaceChildren();
      }
      const next: Mounted[] = [];
      const hosts = new Set<string>();
      let blocked = 0;
      let slice = performance.now();
      for (let i = 0; i < chunks.length; i++) {
        if (token.cancelled) return;
        const chunk = chunks[i];
        const key = prefix + chunk.text;
        const result = renderCached(key, chunk.text, definitions, allowRemote);
        blocked += result.blocked;
        for (const host of result.hosts) hosts.add(host);
        let wrapper = reusable.get(key)?.shift();
        if (wrapper) {
          if (needsEnhancement(wrapper)) void enhancePreview(wrapper, { theme, renderDiagram, token });
        } else {
          wrapper = makeWrapper(result.html);
          prepareInteractive(wrapper);
          void enhancePreview(wrapper, { theme, renderDiagram, token });
        }
        wrapper.dataset.line = String(chunk.line);
        next.push({ key, el: wrapper });
        if (progressive) {
          el.appendChild(wrapper);
          mounted.current.push({ key, el: wrapper });
        }
        if (performance.now() - slice > 12) {
          if (progressive) setProgress(Math.round((i / chunks.length) * 100));
          await yieldToBrowser();
          slice = performance.now();
        }
      }
      if (!token.cancelled) finish(next, blocked, [...hosts].sort());
    })();
    return () => {
      token.cancelled = true;
    };
  }, [debounced, theme, renderDiagram, allowRemote]);

  function onClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.type === 'checkbox' && target.dataset.lkTask !== undefined) {
      event.preventDefault();
      // The preview is a moment behind the editor: its line numbers may be stale.
      if (shown.current !== content) return;
      onToggleTask(taskLine(target));
      return;
    }
    const link = target.closest('a');
    const href = link?.getAttribute('href');
    if (link && href?.startsWith('#')) {
      event.preventDefault();
      const id = decodeURIComponent(href.slice(1));
      const dest = [...(root.current?.querySelectorAll<HTMLElement>('[id]') ?? [])].find((n) => n.id === id);
      dest?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  return (
    <div className={cn('min-h-0 overflow-y-auto', className)}>
      {!content.trim() && <p className="text-[13.5px] text-fg-muted">Nothing to preview yet. Start writing in the editor.</p>}
      <RemoteContentNotice blocked={remote.blocked} hosts={remote.hosts} onAllow={onAllowRemote} className="mb-4" />
      {progress !== null && (
        <p role="status" className="mb-3 text-[12.5px] text-fg-muted">
          Rendering preview… {progress}%
        </p>
      )}
      <div ref={root} onClick={onClick} className="lk-prose lk-note-prose" aria-label="Rendered note" aria-busy={progress !== null} />
    </div>
  );
}
