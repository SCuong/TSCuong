import { useEffect, useRef, useState, type ReactNode } from 'react';
import { FileWarning } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PDFDocumentProxy } from '../lib/pdfjs';
import { docId, getThumbnail } from '../lib/thumbnails';

/**
 * Lazily rendered page thumbnail. Rendering starts when the element scrolls
 * near the viewport and is cancelled if it unmounts first. The image is
 * rendered at the page's own rotation; `rotation` adds a CSS rotation on top
 * (used for previews before saving).
 */
export function Thumbnail({
  doc,
  pageIndex,
  rotation = 0,
  width = 180,
  className,
  alt,
  children,
}: {
  doc: PDFDocumentProxy | null;
  /** 0-based page index; ignored when doc is null (blank page). */
  pageIndex: number;
  rotation?: number;
  width?: number;
  className?: string;
  alt?: string;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [result, setResult] = useState<{ key: string; url?: string; failed?: boolean } | null>(null);
  const key = `${docId(doc)}:${pageIndex}@${width}`;

  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: '300px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible || !doc) return;
    const ctrl = new AbortController();
    let attempts = 0;
    const load = () => {
      getThumbnail(doc, pageIndex, width, ctrl.signal).then(
        (url) => !ctrl.signal.aborted && setResult({ key, url }),
        (error: unknown) => {
          if (ctrl.signal.aborted) return;
          // A shared request was cancelled by another thumbnail of the same page: try again.
          if ((error as { name?: string })?.name === 'AbortError' && attempts++ < 3) return load();
          setResult({ key, failed: true });
        },
      );
    };
    load();
    return () => ctrl.abort();
  }, [visible, doc, pageIndex, width, key]);

  const current = result?.key === key ? result : null;
  const normalized = ((rotation % 360) + 360) % 360;

  return (
    <div
      ref={ref}
      className={cn('relative flex aspect-square items-center justify-center overflow-hidden', className)}
    >
      {!doc ? (
        <div className="aspect-[1/1.414] h-[88%] rounded-[2px] bg-white shadow-card ring-1 ring-line-strong" aria-label={alt} role="img" />
      ) : current?.url ? (
        <img
          src={current.url}
          alt={alt ?? `Page ${pageIndex + 1}`}
          draggable={false}
          className="max-h-full max-w-full rounded-[2px] bg-white object-contain shadow-card ring-1 ring-line-strong transition-transform duration-200"
          style={normalized ? { transform: `rotate(${normalized}deg)` } : undefined}
        />
      ) : current?.failed ? (
        <div className="flex flex-col items-center gap-1 text-[11.5px] text-fg-muted">
          <FileWarning size={18} aria-hidden />
          Preview unavailable
        </div>
      ) : (
        <div className="aspect-[1/1.3] h-[85%] animate-pulse rounded-[2px] bg-surface-hover" aria-hidden />
      )}
      {children}
    </div>
  );
}
