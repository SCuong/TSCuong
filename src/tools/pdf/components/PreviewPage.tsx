import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Spinner } from '@/components/ui/Feedback';
import { cn } from '@/lib/utils';
import type { PDFDocumentProxy } from '../lib/pdfjs';
import { getThumbnail } from '../lib/thumbnails';

export interface PageGeometry {
  /** Displayed page size in points. */
  width: number;
  height: number;
  /** CSS pixels per point in the preview (tracks the rendered width). */
  scale: number;
}

/**
 * A page rendered at up to `width` CSS pixels with an overlay layer for
 * previews (page numbers, watermarks, crop rectangles). Overlay coordinates
 * are CSS pixels from the top-left; use `geometry.scale` to convert points.
 */
export function PreviewPage({
  doc,
  pageIndex,
  width = 320,
  children,
  className,
  overlayInteractive = false,
}: {
  doc: PDFDocumentProxy;
  pageIndex: number;
  width?: number;
  children?: (geometry: PageGeometry) => ReactNode;
  className?: string;
  /** Let the overlay receive pointer events (e.g. drawing a crop rectangle). */
  overlayInteractive?: boolean;
}) {
  const [state, setState] = useState<{ key: string; url?: string; size?: { width: number; height: number }; failed?: boolean } | null>(null);
  const [shown, setShown] = useState(width);
  const box = useRef<HTMLDivElement>(null);
  const key = `${pageIndex}@${width}`;

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      const page = await doc.getPage(pageIndex + 1);
      const vp = page.getViewport({ scale: 1 });
      const url = await getThumbnail(doc, pageIndex, width, ctrl.signal);
      if (!ctrl.signal.aborted) setState({ key, url, size: { width: vp.width, height: vp.height } });
    })().catch(() => {
      if (!ctrl.signal.aborted) setState({ key, failed: true });
    });
    return () => ctrl.abort();
  }, [doc, pageIndex, width, key]);

  const current = state?.key === key ? state : null;
  const ready = Boolean(current?.url && current.size);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setShown(el.clientWidth || width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ready, width]);

  if (!ready) {
    return (
      <div
        className={cn('flex aspect-[1/1.3] w-full items-center justify-center rounded-lg bg-surface-sunken', className)}
        style={{ maxWidth: width }}
      >
        {current?.failed ? <span className="text-[12.5px] text-fg-muted">Preview unavailable</span> : <Spinner />}
      </div>
    );
  }
  const size = current!.size!;
  const scale = shown / size.width;
  return (
    <div
      ref={box}
      className={cn('relative w-full overflow-hidden rounded-[3px] bg-white shadow-raised ring-1 ring-line-strong', className)}
      style={{ maxWidth: width }}
    >
      <img src={current!.url} alt={`Preview of page ${pageIndex + 1}`} className="block h-auto w-full select-none" draggable={false} />
      <div className={cn('absolute inset-0', !overlayInteractive && 'pointer-events-none')}>
        {children?.({ width: size.width, height: size.height, scale })}
      </div>
    </div>
  );
}
