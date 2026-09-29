import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useDebouncedValue } from '@/lib/hooks';
import { blockRemoteContent } from '@/lib/remoteContent';
import { cn } from '@/lib/utils';
import { RemoteContentNotice } from '@/components/RemoteContentNotice';
import { enhancePreview, prepareInteractive, type DiagramRenderer, type DiagramTheme } from '../lib/enhance';
import { renderMarkdown } from '../lib/render';

/**
 * Live Markdown preview. The HTML is sanitized by `renderMarkdown` (DOMPurify);
 * code highlighting and Mermaid diagrams are applied after each render.
 */
export function NotePreview({
  content,
  theme,
  renderDiagram,
  onToggleTask,
  className,
}: {
  content: string;
  theme: DiagramTheme;
  renderDiagram: DiagramRenderer;
  onToggleTask: (index: number) => void;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const debounced = useDebouncedValue(content, 150);
  // Remote images stay blocked until the user opts in for this note (the editor remounts per note).
  const [allowRemote, setAllowRemote] = useState(false);
  const rendered = useMemo(() => renderMarkdown(debounced), [debounced]);
  const { html, blocked, hosts } = useMemo(
    () => (allowRemote ? { html: rendered, blocked: 0, hosts: [] } : blockRemoteContent(rendered)),
    [rendered, allowRemote],
  );

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    el.innerHTML = html;
    prepareInteractive(el);
    const token = { cancelled: false };
    void enhancePreview(el, { theme, renderDiagram, token });
    return () => {
      token.cancelled = true;
    };
  }, [html, theme, renderDiagram]);

  function onClick(event: MouseEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target instanceof HTMLInputElement && target.type === 'checkbox' && target.dataset.task) {
      event.preventDefault();
      onToggleTask(Number(target.dataset.task));
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
      {!content.trim() && (
        <p className="text-[13.5px] text-fg-muted">Nothing to preview yet. Start writing in the editor.</p>
      )}
      <RemoteContentNotice blocked={blocked} hosts={hosts} onAllow={() => setAllowRemote(true)} className="mb-4" />
      <div ref={root} onClick={onClick} className="lk-prose lk-note-prose" aria-label="Rendered note" />
    </div>
  );
}
