import { memo, useEffect, useRef, useState } from 'react';
import { TextLayer, releaseCanvas, type PDFDocumentProxy, type PDFPageProxy } from '@/tools/pdf/lib/pdfjs';
import type { PdfMark } from './annotations';
import { PdfMarks } from './PdfMarks';
import { buildPageIndex, findMatches, itemsInRange, type PageTextIndex } from '@/tools/pdf/lib/search';
import { t } from '@/lib/i18n';
import '@/tools/pdf/components/viewer.css';

/** At most a viewport and one neighboring page are mounted; every canvas is released on unmount. */
export const PageSurface = memo(function PageSurface({
  doc,
  pageNumber,
  scale,
  query,
  activeMatch,
  marks,
}: {
  doc: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  query: string;
  activeMatch: number;
  marks?: PdfMark[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const [index, setIndex] = useState<PageTextIndex | null>(null);
  const divs = useRef<HTMLElement[]>([]);
  const [viewport, setViewport] = useState<ReturnType<PDFPageProxy['getViewport']> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let canvas: HTMLCanvasElement | null = null;
    let task: { cancel(): void; promise: Promise<void> } | null = null;
    let layer: { cancel(): void } | null = null;
    setRendered(false);
    setFailed(false);
    setIndex(null);
    const container = text.current!;
    void (async () => {
      const page = await doc.getPage(pageNumber);
      if (cancelled) return;
      const css = page.getViewport({ scale });
      setViewport(css);
      host.current!.parentElement!.style.setProperty('--user-unit', String(page.userUnit));
      // Cap each surface at 6 MP/8192 px (~24 MB), even on high-DPI phones at extreme zoom.
      const dpr = Math.min(
        devicePixelRatio || 1,
        2,
        Math.sqrt(6_000_000 / (css.width * css.height)),
        8192 / Math.max(css.width, css.height),
      );
      const vp = page.getViewport({ scale: scale * dpr });
      canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(vp.width));
      canvas.height = Math.max(1, Math.floor(vp.height));
      task = page.render({ canvas, viewport: vp });
      await task.promise;
      if (cancelled) return;
      host.current!.replaceChildren(canvas);
      setRendered(true);
      const content = await page.getTextContent();
      if (cancelled) return;
      container.replaceChildren();
      const next = new TextLayer({ textContentSource: content, container, viewport: css });
      layer = next;
      await next.render();
      if (cancelled) return;
      divs.current = next.textDivs as HTMLElement[];
      setIndex(buildPageIndex(content.items.filter((it) => 'str' in it) as { str: string; hasEOL?: boolean }[]));
    })().catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
      task?.cancel();
      layer?.cancel();
      container.replaceChildren();
      divs.current = [];
      if (canvas) releaseCanvas(canvas);
      // Wait for any canceled render to settle before page resource cleanup.
      void Promise.resolve(task?.promise)
        .catch(() => {})
        .then(async () => {
          try {
            (await doc.getPage(pageNumber)).cleanup();
          } catch {
            /* document may already be closed */
          }
        });
    };
  }, [doc, pageNumber, scale, retry]);

  useEffect(() => {
    for (const el of divs.current) el.classList.remove('lk-hit', 'lk-hit-active');
    if (!query || !index) return;
    findMatches(index, query).forEach((match, n) => {
      for (const i of itemsInRange(index, match.start, match.end))
        divs.current[i]?.classList.add(n === activeMatch ? 'lk-hit-active' : 'lk-hit');
    });
    const el = text.current?.querySelector('.lk-hit-active');
    const scroller = text.current?.closest<HTMLElement>('[data-reader-scroller]');
    if (el && scroller) {
      const hit = el.getBoundingClientRect(),
        box = scroller.getBoundingClientRect();
      if (hit.top < box.top + 12 || hit.bottom > box.bottom - 12)
        scroller.scrollTop += hit.top - box.top - box.height / 3;
      if (hit.left < box.left || hit.right > box.right) scroller.scrollLeft += hit.left - box.left - box.width / 3;
    }
  }, [query, activeMatch, index]);

  return (
    <div
      className="lk-pdf-page reader-paper"
      style={{ ['--scale-factor' as string]: scale }}
      role="group"
      aria-label={t('Page {index}', { index: pageNumber })}
      data-page={pageNumber}
    >
      <div ref={host} className="reader-canvas" aria-hidden="true" />
      <div ref={text} className="textLayer" />
      {!!marks?.length && viewport && <svg className="reader-draft-overlay" viewBox={`0 0 ${viewport.width} ${viewport.height}`} aria-label={t('Saved annotations')} role="img"><PdfMarks marks={marks} viewport={viewport} /></svg>}
      {!rendered && (
        <div className="reader-paper-loading">
          {failed ? (
            <button onClick={() => setRetry((n) => n + 1)}>{t('Page failed to render. Tap to retry.')}</button>
          ) : (
            t('Loading page {page}…', { page: pageNumber })
          )}
        </div>
      )}
    </div>
  );
});
