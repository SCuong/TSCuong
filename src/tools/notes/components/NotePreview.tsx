import { useLayoutEffect, useMemo, useRef, type MouseEvent } from 'react';
import { useDebouncedValue } from '@/lib/hooks';
import { cn } from '@/lib/utils';
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
  const html = useMemo(() => renderMarkdown(debounced), [debounced]);

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
      <div ref={root} onClick={onClick} className="lk-prose lk-note-prose" aria-label="Rendered note" />
    </div>
  );
}
