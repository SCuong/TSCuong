import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  PanelLeft,
  PanelLeftClose,
  Search,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { IconButton } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Feedback';
import { useDebouncedValue, useMediaQuery } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { TextLayer, type PDFDocumentProxy } from './lib/pdfjs';
import { buildPageIndex, findMatches, itemsInRange, type PageTextIndex } from './lib/search';
import { docId } from './lib/thumbnails';
import { PdfInput } from './components/PdfInput';
import { usePdfFile, type LoadedPdf } from './components/usePdfFile';
import { Thumbnail } from './components/Thumbnail';
import './components/viewer.css';

const GAP = 12;
const PAD = 12;
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
type ZoomMode = 'fit-width' | 'fit-page' | number;

export default function PdfViewer() {
  const controller = usePdfFile();
  return (
    <ToolStack>
      <PdfInput controller={controller} title="Drop a PDF to view it">
        {(pdf) => <Viewer key={docId(pdf.doc)} pdf={pdf} />}
      </PdfInput>
    </ToolStack>
  );
}

interface Size {
  width: number;
  height: number;
}

interface Hit {
  page: number; // 0-based
  n: number; // match number within the page
}

function Viewer({ pdf }: { pdf: LoadedPdf }) {
  const wide = useMediaQuery('(min-width: 1024px)');
  const [sidebar, setSidebar] = useState(wide);
  const [sizes, setSizes] = useState<Size[] | null>(null);
  const [zoom, setZoom] = useState<ZoomMode>('fit-width');
  const [viewport, setViewport] = useState({ width: 800, height: 600 });
  const [scrollTop, setScrollTop] = useState(0);
  const [pageInput, setPageInput] = useState('1');
  const [query, setQuery] = useState('');
  const [indexes, setIndexes] = useState<Array<PageTextIndex | null>>([]);
  const [indexing, setIndexing] = useState(false);
  const [activeHit, setActiveHit] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const debouncedQuery = useDebouncedValue(query.trim(), 250);

  // Page sizes (cheap, no rendering).
  useEffect(() => {
    let alive = true;
    (async () => {
      const first = await pdf.doc.getPage(1);
      const vp = first.getViewport({ scale: 1 });
      const list: Size[] = Array.from({ length: pdf.pageCount }, () => ({ width: vp.width, height: vp.height }));
      if (alive) setSizes([...list]);
      for (let i = 2; i <= pdf.pageCount; i++) {
        const page = await pdf.doc.getPage(i);
        const v = page.getViewport({ scale: 1 });
        list[i - 1] = { width: v.width, height: v.height };
        if (!alive) return;
        if (i % 50 === 0 || i === pdf.pageCount) setSizes([...list]);
      }
    })().catch(() => {});
    return () => {
      alive = false;
    };
  }, [pdf]);

  // Track the scroll container size.
  const hasSizes = sizes !== null;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => setViewport({ width: el.clientWidth, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasSizes]);

  const maxWidth = useMemo(() => (sizes ? Math.max(...sizes.map((s) => s.width)) : 612), [sizes]);
  const maxHeight = useMemo(() => (sizes ? Math.max(...sizes.map((s) => s.height)) : 792), [sizes]);
  const scale = useMemo(() => {
    const availW = Math.max(100, viewport.width - PAD * 2);
    if (zoom === 'fit-width') return Math.min(4, availW / maxWidth);
    if (zoom === 'fit-page') return Math.min(4, availW / maxWidth, (viewport.height - PAD * 2) / maxHeight);
    return zoom;
  }, [zoom, viewport, maxWidth, maxHeight]);

  const layout = useMemo(() => {
    if (!sizes) return { tops: [] as number[], total: 0 };
    const tops: number[] = [];
    let y = PAD;
    for (const s of sizes) {
      tops.push(y);
      y += Math.floor(s.height * scale) + GAP;
    }
    return { tops, total: y + PAD - GAP };
  }, [sizes, scale]);

  const currentPage = useMemo(() => {
    const probe = scrollTop + viewport.height * 0.35;
    let lo = 0;
    let hi = layout.tops.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (layout.tops[mid] <= probe) lo = mid;
      else hi = mid - 1;
    }
    return Math.max(0, lo);
  }, [scrollTop, viewport.height, layout]);

  useEffect(() => setPageInput(String(currentPage + 1)), [currentPage]);

  // Keep the reading position when the scale changes.
  const anchor = useRef<{ page: number; offset: number } | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    const a = anchor.current;
    if (!el || !a || !layout.tops.length) return;
    el.scrollTop = layout.tops[a.page] + a.offset * scale;
    anchor.current = null;
  }, [scale, layout]);

  function changeZoom(next: ZoomMode) {
    const el = scroller.current;
    if (el && layout.tops.length) {
      anchor.current = { page: currentPage, offset: (el.scrollTop - layout.tops[currentPage]) / scale };
    }
    setZoom(next);
  }

  const goTo = useCallback(
    (page: number, smooth = false) => {
      const el = scroller.current;
      if (!el || !layout.tops.length) return;
      const p = Math.max(0, Math.min(pdf.pageCount - 1, page));
      el.scrollTo({ top: layout.tops[p] - PAD, behavior: smooth ? 'smooth' : 'auto' });
    },
    [layout, pdf.pageCount],
  );

  // ---- Search -------------------------------------------------------------
  useEffect(() => {
    if (!debouncedQuery || indexes.length === pdf.pageCount) return;
    let alive = true;
    setIndexing(true);
    (async () => {
      const list: Array<PageTextIndex | null> = [];
      for (let i = 1; i <= pdf.pageCount; i++) {
        const page = await pdf.doc.getPage(i);
        try {
          const content = await page.getTextContent();
          list.push(buildPageIndex(content.items.filter((it) => 'str' in it) as Array<{ str: string; hasEOL?: boolean }>));
        } catch {
          list.push(null);
        }
        if (!alive) return;
        if (i % 20 === 0) setIndexes([...list]);
      }
      setIndexes(list);
      setIndexing(false);
    })().catch(() => alive && setIndexing(false));
    return () => {
      alive = false;
    };
  }, [debouncedQuery, pdf, indexes.length]);

  const hits = useMemo<Hit[]>(() => {
    if (!debouncedQuery) return [];
    const out: Hit[] = [];
    indexes.forEach((index, page) => {
      if (!index) return;
      findMatches(index, debouncedQuery).forEach((_, n) => out.push({ page, n }));
    });
    return out;
  }, [indexes, debouncedQuery]);

  useEffect(() => setActiveHit(0), [debouncedQuery]);
  const hit = hits.length ? hits[Math.min(activeHit, hits.length - 1)] : null;

  useEffect(() => {
    if (!hit) return;
    const el = scroller.current;
    if (!el || !layout.tops.length) return;
    const top = layout.tops[hit.page];
    const bottom = top + (sizes?.[hit.page].height ?? 0) * scale;
    if (top > el.scrollTop + el.clientHeight - 40 || bottom < el.scrollTop + 40) goTo(hit.page);
  }, [hit, goTo, layout, scale, sizes]);

  function stepHit(delta: number) {
    if (!hits.length) return;
    setActiveHit((i) => (i + delta + hits.length) % hits.length);
  }

  function onSearchKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      stepHit(e.shiftKey ? -1 : 1);
    } else if (e.key === 'Escape') {
      setQuery('');
    }
  }

  // Render window: pages intersecting the viewport ± one screen.
  const visible = useMemo(() => {
    const set = new Set<number>();
    if (!sizes) return set;
    const from = scrollTop - viewport.height;
    const to = scrollTop + viewport.height * 2;
    for (let i = 0; i < layout.tops.length; i++) {
      const top = layout.tops[i];
      const bottom = top + sizes[i].height * scale;
      if (bottom >= from && top <= to) set.add(i);
    }
    return set;
  }, [scrollTop, viewport.height, layout, sizes, scale]);

  const zoomIndex = typeof zoom === 'number' ? zoom : scale;
  const zoomOut = () => changeZoom([...ZOOMS].reverse().find((z) => z < zoomIndex - 0.01) ?? ZOOMS[0]);
  const zoomIn = () => changeZoom(ZOOMS.find((z) => z > zoomIndex + 0.01) ?? ZOOMS[ZOOMS.length - 1]);

  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-card">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-line px-2 py-1.5">
        <IconButton
          icon={sidebar ? PanelLeftClose : PanelLeft}
          label={sidebar ? 'Hide thumbnails' : 'Show thumbnails'}
          size="sm"
          onClick={() => setSidebar((s) => !s)}
        />
        <div className="flex items-center gap-1">
          <IconButton icon={ChevronLeft} label="Previous page" size="sm" disabled={currentPage === 0} onClick={() => goTo(currentPage - 1)} />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const n = parseInt(pageInput, 10);
              if (Number.isFinite(n)) goTo(n - 1);
              else setPageInput(String(currentPage + 1));
            }}
            className="flex items-center gap-1 text-[13px] text-fg-muted"
          >
            <label htmlFor="lk-viewer-page" className="sr-only">
              Page number
            </label>
            <Input
              id="lk-viewer-page"
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ''))}
              onBlur={() => setPageInput(String(currentPage + 1))}
              inputMode="numeric"
              className="h-7 w-12 px-1.5 py-0.5 text-center text-[13px]"
            />
            <span className="whitespace-nowrap">/ {pdf.pageCount}</span>
          </form>
          <IconButton
            icon={ChevronRight}
            label="Next page"
            size="sm"
            disabled={currentPage >= pdf.pageCount - 1}
            onClick={() => goTo(currentPage + 1)}
          />
        </div>
        <div className="flex items-center gap-1">
          <IconButton icon={ZoomOut} label="Zoom out" size="sm" disabled={zoomIndex <= ZOOMS[0] + 0.01} onClick={zoomOut} />
          <label htmlFor="lk-viewer-zoom" className="sr-only">
            Zoom
          </label>
          <Select
            id="lk-viewer-zoom"
            value={typeof zoom === 'number' ? String(zoom) : zoom}
            onChange={(e) => {
              const v = e.target.value;
              changeZoom(v === 'fit-width' || v === 'fit-page' ? v : Number(v));
            }}
            className="h-7 w-[118px] py-0.5 pl-2 text-[13px]"
          >
            <option value="fit-width">Fit width</option>
            <option value="fit-page">Fit page</option>
            {ZOOMS.map((z) => (
              <option key={z} value={String(z)}>
                {Math.round(z * 100)}%
              </option>
            ))}
          </Select>
          <IconButton icon={ZoomIn} label="Zoom in" size="sm" disabled={zoomIndex >= ZOOMS[ZOOMS.length - 1] - 0.01} onClick={zoomIn} />
        </div>
        <div className="flex min-w-0 flex-1 basis-56 items-center justify-end gap-1">
          <div className="relative min-w-0 flex-1 sm:max-w-64">
            <Search size={14} className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-fg-muted" aria-hidden />
            <label htmlFor="lk-viewer-search" className="sr-only">
              Search in document
            </label>
            <Input
              id="lk-viewer-search"
              type="text"
              role="searchbox"
              enterKeyHint="search"
              value={query}
              placeholder="Search"
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKey}
              className="h-7 py-0.5 pr-2 pl-7 text-[13px]"
            />
          </div>
          <span className="min-w-14 text-center text-[12px] whitespace-nowrap text-fg-muted tabular-nums" aria-live="polite">
            {debouncedQuery ? (indexing && !hits.length ? <Spinner size={12} /> : hits.length ? `${Math.min(activeHit, hits.length - 1) + 1} / ${hits.length}` : 'No results') : ''}
          </span>
          <IconButton icon={ChevronUp} label="Previous result" size="sm" disabled={!hits.length} onClick={() => stepHit(-1)} />
          <IconButton icon={ChevronDown} label="Next result" size="sm" disabled={!hits.length} onClick={() => stepHit(1)} />
          {query && <IconButton icon={X} label="Clear search" size="sm" onClick={() => setQuery('')} />}
        </div>
      </div>
      <div className="relative flex h-[min(78dvh,960px)] min-h-[420px]">
        {sidebar && (
          <aside
            aria-label="Page thumbnails"
            className={cn(
              'z-10 w-36 shrink-0 overflow-y-auto border-r border-line bg-surface-sunken p-2',
              !wide && 'absolute inset-y-0 left-0 shadow-popover',
            )}
          >
            <ol className="flex flex-col gap-2">
              {Array.from({ length: pdf.pageCount }, (_, i) => (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => {
                      goTo(i);
                      if (!wide) setSidebar(false);
                    }}
                    aria-current={i === currentPage ? 'page' : undefined}
                    aria-label={`Go to page ${i + 1}`}
                    className={cn(
                      'block w-full rounded-lg border p-1 text-center transition-colors',
                      i === currentPage ? 'border-accent bg-accent-soft' : 'border-transparent hover:bg-surface-hover',
                    )}
                  >
                    <Thumbnail doc={pdf.doc} pageIndex={i} width={120} alt="" />
                    <span className="text-[11.5px] text-fg-muted">{i + 1}</span>
                  </button>
                </li>
              ))}
            </ol>
          </aside>
        )}
        <div
          ref={scroller}
          data-viewer-scroller
          className="relative min-w-0 flex-1 overflow-auto bg-surface-sunken"
          onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
          tabIndex={0}
          aria-label="Document pages"
        >
          {!sizes ? (
            <div className="flex h-full items-center justify-center">
              <Spinner label="Loading pages…" />
            </div>
          ) : (
            <div className="relative mx-auto" style={{ height: layout.total, width: Math.max(maxWidth * scale + PAD * 2, 0) }}>
              {sizes.map((size, i) => (
                <div
                  key={i}
                  className="absolute left-1/2 -translate-x-1/2"
                  style={{ top: layout.tops[i], width: Math.floor(size.width * scale), height: Math.floor(size.height * scale) }}
                >
                  <ViewerPage
                    doc={pdf.doc}
                    index={i}
                    scale={scale}
                    active={visible.has(i)}
                    query={debouncedQuery}
                    activeMatch={hit && hit.page === i ? hit.n : -1}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

const ViewerPage = memo(function ViewerPage({
  doc,
  index,
  scale,
  active,
  query,
  activeMatch,
}: {
  doc: PDFDocumentProxy;
  index: number;
  scale: number;
  active: boolean;
  query: string;
  activeMatch: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const [rendered, setRendered] = useState(false);
  const [failed, setFailed] = useState(false);
  const [textIndex, setTextIndex] = useState<PageTextIndex | null>(null);
  /** The text layer's divs, aligned 1:1 with the text items (empty items have detached divs). */
  const textDivs = useRef<HTMLElement[]>([]);

  useEffect(() => {
    if (!active) {
      setRendered(false);
      const c = canvasRef.current;
      if (c) {
        c.width = 0;
        c.height = 0;
      }
      if (textRef.current) textRef.current.replaceChildren();
      textDivs.current = [];
      setTextIndex(null);
      return;
    }
    let cancelled = false;
    let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;
    let textLayer: { cancel: () => void } | null = null;
    (async () => {
      const page = await doc.getPage(index + 1);
      if (cancelled) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: scale * dpr });
      const canvas = canvasRef.current!;
      const width = Math.floor(viewport.width);
      const height = Math.floor(viewport.height);
      // Guard against huge canvases at high zoom.
      const limit = 16_000_000;
      const factor = width * height > limit ? Math.sqrt(limit / (width * height)) : 1;
      const vp = factor < 1 ? page.getViewport({ scale: scale * dpr * factor }) : viewport;
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      renderTask = page.render({ canvas, viewport: vp });
      await renderTask.promise;
      if (cancelled) return;
      setRendered(true);
      const container = textRef.current!;
      container.replaceChildren();
      const content = await page.getTextContent();
      if (cancelled) return;
      const tl = new TextLayer({ textContentSource: content, container, viewport: page.getViewport({ scale }) });
      textLayer = tl;
      await tl.render();
      if (cancelled) return;
      textDivs.current = tl.textDivs as HTMLElement[];
      setTextIndex(buildPageIndex(content.items.filter((it) => 'str' in it) as Array<{ str: string; hasEOL?: boolean }>));
    })().catch((error: unknown) => {
      if (cancelled || (error as { name?: string })?.name === 'RenderingCancelledException') return;
      setFailed(true);
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [active, doc, index, scale]);

  // Search highlights on the text layer.
  useEffect(() => {
    const container = textRef.current;
    if (!container) return;
    const divs = textDivs.current;
    for (const d of divs) d.classList.remove('lk-hit', 'lk-hit-active');
    if (!query || !textIndex) return;
    const matches = findMatches(textIndex, query);
    matches.forEach((m, n) => {
      for (const i of itemsInRange(textIndex, m.start, m.end)) {
        const el = divs[i];
        if (!el) continue;
        el.classList.add(n === activeMatch ? 'lk-hit-active' : 'lk-hit');
      }
    });
    if (activeMatch >= 0) {
      const el = container.querySelector('.lk-hit-active');
      const scrollerEl = container.closest<HTMLElement>('[data-viewer-scroller]');
      if (el && scrollerEl) {
        const r = el.getBoundingClientRect();
        const box = scrollerEl.getBoundingClientRect();
        const dy = r.top < box.top + 24 || r.bottom > box.bottom - 24 ? r.top - box.top - box.height / 2 : 0;
        const dx = r.left < box.left + 8 || r.right > box.right - 8 ? r.left - box.left - box.width / 2 : 0;
        if (dx || dy) scrollerEl.scrollBy({ top: dy, left: dx });
      }
    }
  }, [query, textIndex, activeMatch]);

  return (
    <div
      className="lk-pdf-page relative h-full w-full overflow-hidden bg-white shadow-raised ring-1 ring-line"
      style={{ ['--scale-factor' as string]: String(scale) }}
      aria-label={`Page ${index + 1}`}
      role="region"
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden />
      <div ref={textRef} className="textLayer" />
      {!rendered && (
        <div className="absolute inset-0 flex items-center justify-center text-[12.5px] text-black/50">
          {failed ? 'This page could not be rendered.' : active ? <Spinner size={16} /> : `Page ${index + 1}`}
        </div>
      )}
    </div>
  );
});
