import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Grid2X2,
  Maximize,
  MoreHorizontal,
  Search,
  Star,
  X,
} from 'lucide-react';
import type { LoadedPdf } from '@/tools/pdf/components/usePdfFile';
import { Thumbnail } from '@/tools/pdf/components/Thumbnail';
import { releaseThumbnails } from '@/tools/pdf/lib/thumbnails';
import { buildPageIndex, findMatches, snippet } from '@/tools/pdf/lib/search';
import { Dialog } from '@/components/ui/Dialog';
import { t } from '@/lib/i18n';
import { readRaw, writeRaw } from '@/lib/storage/local';
import { cycleTheme } from '@/lib/theme';
import { PageSurface } from './PageSurface';
import { boundedZoom, fitScale, pageAt, pageLayout, type PageSize } from './geometry';
import { readerPlatform } from './platform';
import { pdfDrafts, type ReaderDocument } from './storage';
import type { PdfMark } from './annotations';
import { downloadOutput } from '@/tools/pdf/components/Results';
import { shareOutputs, supportsFileSharing } from '@/tools/pdf/lib/share';

type NightMode = 'paper' | 'sepia' | 'night';
type Sheet = 'pages' | 'jump' | 'view' | null;
type Outline = Awaited<ReturnType<LoadedPdf['doc']['getOutline']>>;
interface Hit {
  page: number;
  match: number;
  excerpt: string;
}
export function MobileReader({
  pdf,
  record,
  update,
  onLibrary,
  onTools,
}: {
  pdf: LoadedPdf;
  record: ReaderDocument;
  update(patch: Partial<Pick<ReaderDocument, 'page' | 'offset' | 'favorite' | 'bookmarks'>>): Promise<void>;
  onLibrary(): void;
  onTools(id?: string): void;
}) {
  const { doc, pageCount } = pdf;
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState<PageSize[]>(() =>
    Array.from({ length: pageCount }, () => ({ width: 595, height: 842 })),
  );
  const [view, setView] = useState({ width: window.innerWidth, height: window.innerHeight - 130, top: 0 });
  const [fit, setFit] = useState<'width' | 'page'>('width');
  const [zoom, setZoom] = useState(1);
  const [night, setNight] = useState<NightMode>(() => {
    const mode = readRaw('reader-night');
    return mode === 'sepia' || mode === 'night' ? mode : 'paper';
  });
  const [controls, setControls] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [pageTab, setPageTab] = useState<'thumbnails' | 'contents' | 'bookmarks'>('thumbnails');
  const [galleryStart, setGalleryStart] = useState(0);
  const [outline, setOutline] = useState<Outline | null>(null);
  const [outlineError, setOutlineError] = useState(false);
  const [jump, setJump] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [hitIndex, setHitIndex] = useState(-1);
  const [scanned, setScanned] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [message, setMessage] = useState('');
  const [marks, setMarks] = useState<PdfMark[]>([]);
  useEffect(() => {
    let alive = true;
    const refresh = () => { void pdfDrafts.get(record.id).then((draft) => { if (alive) setMarks(draft?.marks ?? []); }).catch(() => {}); };
    refresh(); window.addEventListener('focus', refresh);
    return () => { alive = false; window.removeEventListener('focus', refresh); };
  }, [record.id]);
  const scales = useMemo(
    () => sizes.map((size) => fitScale(size, view.width, view.height, fit) * zoom),
    [sizes, view.width, view.height, fit, zoom],
  );
  const layout = useMemo(() => pageLayout(sizes, scales), [sizes, scales]);
  const currentPage = pageAt(layout.offsets, view.top + Math.min(60, view.height * 0.12)) + 1;
  const config = useRef({ layout, sizes, zoom, view });
  config.current = { layout, sizes, zoom, view };
  const lastLayout = useRef<typeof layout | null>(null);
  const initialPosition = useRef({ page: record.page, offset: record.offset });
  const savedPosition = useRef(initialPosition.current);
  const change = useRef(update);
  change.current = update;
  const frame = useRef(0);
  const zoomAnchor = useRef<{ page: number; fraction: number; x: number; screenX: number; screenY: number } | null>(
    null,
  );
  const gesture = useRef<{
    distance: number;
    ratio: number;
    zoom: number;
    anchor: NonNullable<typeof zoomAnchor.current>;
  } | null>(null);
  const tap = useRef<{ time: number; x: number; y: number; start: number; timer?: ReturnType<typeof setTimeout> }>({
    time: 0,
    x: 0,
    y: 0,
    start: 0,
  });

  useEffect(() => () => releaseThumbnails(doc), [doc, sheet, galleryStart]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const batch = [...sizes];
      for (let i = 0; i < pageCount; i++) {
        if (cancelled) return;
        const page = await doc.getPage(i + 1);
        if (cancelled) return;
        const vp = page.getViewport({ scale: 1 });
        batch[i] = { width: vp.width, height: vp.height };
        if (i === 0 || i % 20 === 19 || i === pageCount - 1) {
          setSizes([...batch]);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        const at = pageAt(config.current.layout.offsets, scroller.current?.scrollTop ?? 0);
        if (Math.abs(at - i) > 3) page.cleanup();
      }
    })().catch(() => {
      if (!cancelled) setMessage(t('Some page sizes could not be read. You can still navigate this document.'));
    });
    void doc
      .getOutline()
      .then((value) => {
        if (!cancelled) setOutline(value);
      })
      .catch(() => {
        if (!cancelled) setOutlineError(true);
      });
    return () => {
      cancelled = true;
    };
    // Dimensions are initialized once per PDF; zoom/scroll changes must not restart the scan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, pageCount]);

  useEffect(() => {
    const el = scroller.current!;
    const measure = () => setView((v) => ({ ...v, width: el.clientWidth, height: el.clientHeight }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const el = scroller.current!;
    const old = lastLayout.current;
    const anchor = zoomAnchor.current;
    if (anchor) {
      const page = layout.offsets[anchor.page];
      el.scrollTop = page.top + anchor.fraction * page.height - anchor.screenY;
      const width = Math.max(view.width, ...layout.offsets.map((p) => p.width + 16));
      el.scrollLeft = Math.max(0, anchor.x * scales[anchor.page] + (width - page.width) / 2 - anchor.screenX);
      zoomAnchor.current = null;
    } else if (!old) {
      const page = layout.offsets[Math.min(pageCount, initialPosition.current.page) - 1];
      el.scrollTop = page.top + initialPosition.current.offset * page.height;
    } else {
      const index = pageAt(old.offsets, el.scrollTop + 24);
      const before = old.offsets[index];
      const fraction = (el.scrollTop - before.top) / before.height;
      el.scrollTop = layout.offsets[index].top + fraction * layout.offsets[index].height;
    }
    lastLayout.current = layout;
    setView((v) => ({ ...v, top: el.scrollTop }));
  }, [layout, scales, pageCount, view.width, sizes]);

  const capturePosition = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const offsets = config.current.layout.offsets;
    const index = pageAt(offsets, el.scrollTop + 24);
    savedPosition.current = {
      page: index + 1,
      offset: Math.max(0, Math.min(1, (el.scrollTop - offsets[index].top) / offsets[index].height)),
    };
  }, []);
  useEffect(() => {
    capturePosition();
    const timer = setTimeout(() => change.current(savedPosition.current), 350);
    return () => clearTimeout(timer);
  }, [view.top, capturePosition]);
  useEffect(() => {
    const tapState = tap.current;
    const save = () => {
      capturePosition();
      change.current(savedPosition.current);
    };
    const hidden = () => {
      if (document.visibilityState === 'hidden') save();
    };
    window.addEventListener('pagehide', save);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      save();
      window.removeEventListener('pagehide', save);
      document.removeEventListener('visibilitychange', hidden);
      cancelAnimationFrame(frame.current);
      clearTimeout(tapState.timer);
    };
  }, [capturePosition]);

  const go = useCallback(
    (page: number, close = true) => {
      const el = scroller.current!;
      const n = Math.max(1, Math.min(pageCount, page));
      el.scrollTop = config.current.layout.offsets[n - 1].top;
      el.scrollLeft = 0;
      savedPosition.current = { page: n, offset: 0 };
      void change.current(savedPosition.current);
      setView((v) => ({ ...v, top: el.scrollTop }));
      if (close) setSheet(null);
    },
    [pageCount],
  );

  function makeAnchor(x: number, y: number) {
    const el = scroller.current!,
      box = el.getBoundingClientRect();
    const { layout, sizes } = config.current;
    const localX = x - box.left,
      localY = y - box.top;
    const index = pageAt(layout.offsets, el.scrollTop + localY);
    const page = layout.offsets[index];
    const scale = page.width / sizes[index].width;
    const width = Math.max(el.clientWidth, ...layout.offsets.map((p) => p.width + 16));
    return {
      page: index,
      fraction: (el.scrollTop + localY - page.top) / page.height,
      x: (el.scrollLeft + localX - (width - page.width) / 2) / scale,
      screenX: localX,
      screenY: localY,
    };
  }

  useEffect(() => {
    const el = scroller.current!;
    const distance = (a: Touch, b: Touch) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const start = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      clearTimeout(tap.current.timer);
      const [a, b] = [e.touches[0], e.touches[1]];
      gesture.current = {
        distance: distance(a, b),
        ratio: 1,
        zoom: config.current.zoom,
        anchor: makeAnchor((a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2),
      };
    };
    const move = (e: TouchEvent) => {
      if (!gesture.current || e.touches.length !== 2) return;
      e.preventDefault();
      const g = gesture.current;
      g.ratio = boundedZoom((g.zoom * distance(e.touches[0], e.touches[1])) / g.distance) / g.zoom;
      const c = content.current!;
      c.style.transformOrigin = g.anchor.screenX + el.scrollLeft + 'px ' + (g.anchor.screenY + el.scrollTop) + 'px';
      c.style.transform = 'scale(' + g.ratio + ')';
    };
    const end = () => {
      const g = gesture.current;
      if (!g) return;
      gesture.current = null;
      content.current!.style.transform = '';
      const nextZoom = boundedZoom(g.zoom * g.ratio);
      zoomAnchor.current = nextZoom === config.current.zoom ? null : g.anchor;
      setZoom(nextZoom);
      tap.current.time = 0;
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
    };
  }, []);

  useEffect(() => {
    const q = query.trim();
    let cancelled = false;
    setHits([]);
    setHitIndex(-1);
    setScanned(0);
    setSearchError(false);
    setSearched('');
    if (!q) {
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      setSearched(q);
      void (async () => {
        const result: Hit[] = [];
        for (let i = 1; i <= pageCount; i++) {
          if (cancelled) return;
          try {
            const page = await doc.getPage(i);
            const text = await page.getTextContent();
            if (cancelled) return;
            const index = buildPageIndex(text.items.filter((it) => 'str' in it) as { str: string; hasEOL?: boolean }[]);
            findMatches(index, q).forEach((m, n) => {
              if (result.length < 10000) result.push({ page: i, match: n, excerpt: snippet(index, m.start, m.end) });
            });
            const visiblePage = pageAt(config.current.layout.offsets, scroller.current?.scrollTop ?? 0);
            if (Math.abs(visiblePage - (i - 1)) > 3) page.cleanup();
          } catch {
            if (!cancelled) setSearchError(true);
          }
          if (cancelled) return;
          if (i % 8 === 0 || i === pageCount || result.length >= 10000) {
            setHits([...result]);
            setScanned(i);
            await new Promise((resolve) => setTimeout(resolve, 0));
          }
          if (result.length >= 10000) break;
        }
        if (!cancelled) {
          setHits(result);
          setSearching(false);
          if (result.length) {
            setHitIndex(0);
            go(result[0].page, false);
          }
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, doc, pageCount, go]);
  const activeHit = hits[hitIndex];
  function stepHit(delta: number) {
    if (!hits.length) return;
    const next = (Math.max(0, hitIndex) + delta + hits.length) % hits.length;
    setHitIndex(next);
    go(hits[next].page, false);
  }
  async function outlineGo(dest: NonNullable<Outline>[number]['dest']) {
    try {
      const target = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
      if (!Array.isArray(target) || (!target[0] && target[0] !== 0)) throw new Error('No destination');
      const index = typeof target[0] === 'number' ? target[0] : await doc.getPageIndex(target[0]);
      go(index + 1);
    } catch {
      setMessage(t('This contents entry has no valid page destination.'));
    }
  }
  const from = Math.max(0, pageAt(layout.offsets, view.top) - 1);
  const to = Math.min(pageCount - 1, pageAt(layout.offsets, view.top + view.height) + 1);
  const visible = Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const contentWidth = Math.max(view.width, ...layout.offsets.map((p) => p.width + 16));
  function bookmark() {
    update({
      bookmarks: record.bookmarks.includes(currentPage)
        ? record.bookmarks.filter((p) => p !== currentPage)
        : [...record.bookmarks, currentPage].sort((a, b) => a - b),
    });
  }
  function openPages() {
    setGalleryStart(Math.floor((currentPage - 1) / 30) * 30);
    setSheet('pages');
  }
  async function leave() {
    if (leaving) return;
    setLeaving(true);
    capturePosition();
    // Finish the IndexedDB transaction before navigation exposes a reloadable library.
    await update(savedPosition.current);
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    onLibrary();
  }
  return (
    <div ref={root} className={'reader-viewer reader-mode-' + night + (controls ? '' : ' reader-immersive')}>
      <header className="reader-toolbar">
        <button className="reader-icon" aria-label={t('Back to library')} onClick={leave} disabled={leaving}>
          <ArrowLeft size={22} />
        </button>
        <div className="reader-title">
          <h1>{record.name}</h1>
          <span>{record.cached ? t('Saved on device') : t('Reading on device')}</span>
        </div>
        <button
          className="reader-icon"
          aria-label={t('Search document')}
          aria-pressed={searchOpen}
          onClick={() => {
            setControls(true);
            setSearchOpen((v) => !v);
          }}
        >
          <Search size={21} />
        </button>
        <button
          className="reader-icon"
          aria-label={record.bookmarks.includes(currentPage) ? t('Remove page bookmark') : t('Bookmark this page')}
          aria-pressed={record.bookmarks.includes(currentPage)}
          onClick={bookmark}
        >
          <Bookmark size={21} fill={record.bookmarks.includes(currentPage) ? 'currentColor' : 'none'} />
        </button>
        <button className="reader-icon" aria-label={t('Reading options')} onClick={() => setSheet('view')}>
          <MoreHorizontal size={22} />
        </button>
      </header>
      {searchOpen && (
        <div className="reader-search">
          <div className="reader-search-field">
            <Search size={18} />
            <input
              type="search"
              autoFocus
              aria-label={t('Search in PDF')}
              placeholder={t('Search in PDF')}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') stepHit(e.shiftKey ? -1 : 1);
              }}
            />
            <button
              className="reader-icon"
              aria-label={t('Close search')}
              onClick={() => {
                setSearchOpen(false);
                setQuery('');
              }}
            >
              <X size={19} />
            </button>
          </div>
          {query.trim() && (
            <div className="reader-search-results">
              <span role="status">
                {searching
                  ? t('Searching page {page} of {pages}…', { page: scanned, pages: pageCount })
                  : hits.length
                    ? t('{current} of {total} matches', { current: hitIndex + 1, total: hits.length })
                    : t('No matches found')}
              </span>
              <button
                className="reader-icon"
                disabled={!hits.length || searching}
                aria-label={t('Previous match')}
                onClick={() => stepHit(-1)}
              >
                <ChevronLeft size={20} />
              </button>
              <button
                className="reader-icon"
                disabled={!hits.length || searching}
                aria-label={t('Next match')}
                onClick={() => stepHit(1)}
              >
                <ChevronRight size={20} />
              </button>
            </div>
          )}
          {activeHit && <p className="reader-search-excerpt">{activeHit.excerpt}</p>}
          {hits.length >= 10000 && <p>{t('Showing the first 10,000 matches. Narrow your search to find more.')}</p>}
          {searchError && (
            <p role="status">
              {t(
                'Some pages could not be searched. Use PDF OCR in the toolkit for scanned pages without text.',
              )}
            </p>
          )}
        </div>
      )}
      <div
        ref={scroller}
        data-reader-scroller
        className="reader-scroller"
        tabIndex={0}
        aria-label={t('PDF pages')}
        onScroll={() => {
          cancelAnimationFrame(frame.current);
          frame.current = requestAnimationFrame(() => setView((v) => ({ ...v, top: scroller.current!.scrollTop })));
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            go(currentPage + 1, false);
          }
          if (e.key === 'ArrowLeft') {
            e.preventDefault();
            go(currentPage - 1, false);
          }
          if (e.key === 'Escape') {
            setControls(true);
            setSearchOpen(false);
          }
        }}
        onPointerDown={(e) => {
          if (e.isPrimary) tap.current.start = performance.now();
        }}
        onPointerUp={(e) => {
          if (
            !e.isPrimary ||
            gesture.current ||
            performance.now() - tap.current.start > 350 ||
            window.getSelection()?.toString()
          )
            return;
          const now = performance.now();
          if (now - tap.current.time < 280 && Math.hypot(e.clientX - tap.current.x, e.clientY - tap.current.y) < 30) {
            clearTimeout(tap.current.timer);
            zoomAnchor.current = makeAnchor(e.clientX, e.clientY);
            setZoom((v) => (v > 1.3 ? 1 : 2));
            tap.current.time = 0;
          } else {
            tap.current.time = now;
            tap.current.x = e.clientX;
            tap.current.y = e.clientY;
            tap.current.timer = setTimeout(() => {
              if (!window.getSelection()?.toString()) setControls((v) => !v);
            }, 280);
          }
        }}
      >
        <div
          ref={content}
          className="reader-page-stack"
          style={{
            height: Math.max(layout.height, layout.offsets[pageCount - 1].top + view.height),
            width: contentWidth,
          }}
        >
          {visible.map((index) => (
            <div
              key={index}
              className="reader-page-slot"
              style={{
                top: layout.offsets[index].top,
                width: layout.offsets[index].width,
                height: layout.offsets[index].height,
                left: (contentWidth - layout.offsets[index].width) / 2,
              }}
            >
              <PageSurface
                doc={doc}
                pageNumber={index + 1}
                scale={scales[index]}
                query={searched}
                activeMatch={activeHit?.page === index + 1 ? activeHit.match : -1}
                marks={marks.filter((mark) => mark.page === index + 1)}
              />
            </div>
          ))}
        </div>
      </div>
      <footer className="reader-bottom-toolbar">
        <button className="reader-bottom-action" onClick={openPages}>
          <Grid2X2 size={21} />
          <span>{t('Pages')}</span>
        </button>
        <button
          className="reader-page-indicator"
          aria-label={t('Jump to page')}
          aria-description={t('Page {page} of {pages}', { page: currentPage, pages: pageCount })}
          onClick={() => {
            setJump(String(currentPage));
            setSheet('jump');
          }}
        >
          <b>{currentPage}</b> <span>/ {pageCount}</span>
        </button>
        <button className="reader-bottom-action" onClick={() => setSheet('view')} aria-label={t('Zoom and appearance')}>
          <span className="reader-zoom-value">{Math.round(zoom * 100)}%</span>
          <span>{t('View')}</span>
        </button>
      </footer>
      {!controls && (
        <button
          className="reader-show-controls"
          onClick={() => setControls(true)}
          aria-label={t('Show reader controls')}
        >
          {currentPage} / {pageCount}
          <MoreHorizontal size={18} />
        </button>
      )}
      {message && (
        <div className="reader-inline-message" role="status">
          <span>{message}</span>
          <button onClick={() => setMessage('')} aria-label={t('Dismiss message')}>
            ×
          </button>
        </div>
      )}
      <Dialog open={sheet === 'jump'} onClose={() => setSheet(null)} title={t('Jump to page')} className="reader-sheet">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const n = Number(jump);
            if (Number.isInteger(n) && n >= 1 && n <= pageCount) go(n);
          }}
        >
          <label className="reader-muted" htmlFor="reader-jump">
            {t('Enter a page from 1 to {pages}', { pages: pageCount })}
          </label>
          <input
            id="reader-jump"
            aria-label={t('Page number')}
            className="reader-input"
            type="number"
            inputMode="numeric"
            min={1}
            max={pageCount}
            required
            autoFocus
            value={jump}
            onChange={(e) => setJump(e.target.value)}
          />
          <button className="reader-primary reader-wide" type="submit">
            {t('Go to page')}
          </button>
        </form>
      </Dialog>
      <Dialog
        open={sheet === 'view'}
        onClose={() => setSheet(null)}
        title={t('Reading options')}
        className="reader-sheet"
      >
        <div className="reader-settings">
          <button className="reader-row" onClick={async () => { capturePosition(); await update(savedPosition.current); onTools(); }}>{t('Edit and export this PDF')}</button>
          <button className="reader-row" onClick={async () => { capturePosition(); await update(savedPosition.current); onTools('pdf-annotate'); }}>{t('Annotate & sign')}</button>
          <button className="reader-row" onClick={() => downloadOutput({ name: pdf.file.name, type: 'application/pdf', data: pdf.file })}>{t('Download original PDF')}</button>
          {supportsFileSharing() && <button className="reader-row" onClick={() => void shareOutputs([{ name: pdf.file.name, type: 'application/pdf', data: pdf.file }]).catch((error: unknown) => { if ((error as Error).name !== 'AbortError') setMessage(t('Sharing failed. You can still download your files.')); })}>{t('Share original PDF')}</button>}
          <p className="reader-muted" style={{ overflowWrap: 'anywhere' }}>
            {record.name} · {t('Page {page} of {pages}', { page: currentPage, pages: pageCount })}
          </p>
          <h3>{t('Page size')}</h3>
          <div className="reader-choice">
            <button
              aria-pressed={fit === 'width' && zoom === 1}
              onClick={() => {
                setFit('width');
                setZoom(1);
              }}
            >
              {t('Fit width')}
            </button>
            <button
              aria-pressed={fit === 'page' && zoom === 1}
              onClick={() => {
                setFit('page');
                setZoom(1);
              }}
            >
              {t('Fit page')}
            </button>
          </div>
          <label htmlFor="reader-zoom">
            {t('Zoom')} · {Math.round(zoom * 100)}%
          </label>
          <input
            id="reader-zoom"
            aria-label={t('Zoom')}
            type="range"
            min={35}
            max={500}
            step={5}
            value={Math.round(zoom * 100)}
            onChange={(e) => setZoom(Number(e.target.value) / 100)}
          />
          <p className="reader-muted">
            {t('Pinch or double-tap to zoom. Long-press text to select it. Tap once to hide controls.')}
          </p>
          <h3>{t('Paper appearance')}</h3>
          <div className="reader-choice">
            {(['paper', 'sepia', 'night'] as const).map((mode) => (
              <button
                key={mode}
                aria-pressed={night === mode}
                onClick={() => {
                  setNight(mode);
                  writeRaw('reader-night', mode);
                }}
              >
                {t(mode === 'paper' ? 'Original' : mode === 'sepia' ? 'Sepia' : 'Night')}
              </button>
            ))}
          </div>
          <p className="reader-muted">
            {t('Night and sepia change how pages look on screen. Your PDF stays unchanged.')}
          </p>
          <button className="reader-row" onClick={cycleTheme}>
            {t('Switch light / dark interface')}
          </button>
          <button
            className="reader-row"
            onClick={() => {
              setSheet(null);
              setSearchOpen(false);
              setControls(false);
              void readerPlatform
                .fullscreen(root.current!)
                .catch(() => setMessage(t('Fullscreen is unavailable. Immersive reading is still enabled.')));
            }}
          >
            <Maximize size={19} />
            {t('Immersive reading')}
          </button>
          <button
            className="reader-row"
            aria-pressed={record.favorite}
            onClick={() => update({ favorite: !record.favorite })}
          >
            <Star size={19} fill={record.favorite ? 'currentColor' : 'none'} />
            {record.favorite ? t('Remove favorite') : t('Add favorite')}
          </button>
        </div>
      </Dialog>
      <Dialog
        open={sheet === 'pages'}
        onClose={() => setSheet(null)}
        title={t('Navigate document')}
        className="reader-sheet"
        size="lg"
      >
        <div className="reader-tabs reader-navigation-tabs" role="group" aria-label={t('Page navigation')}>
          <button aria-pressed={pageTab === 'thumbnails'} onClick={() => setPageTab('thumbnails')}>
            {t('Thumbnails')}
          </button>
          <button aria-pressed={pageTab === 'contents'} onClick={() => setPageTab('contents')}>
            {t('Contents')}
          </button>
          <button aria-pressed={pageTab === 'bookmarks'} onClick={() => setPageTab('bookmarks')}>
            {t('Bookmarks')}
          </button>
        </div>
        {pageTab === 'thumbnails' && (
          <>
            <div className="reader-gallery-pagination">
              <button
                className="reader-icon"
                disabled={galleryStart === 0}
                aria-label={t('Previous thumbnails')}
                onClick={() => setGalleryStart((n) => n - 30)}
              >
                <ChevronLeft size={21} />
              </button>
              <span>
                {t('Pages {first}–{last} of {pages}', {
                  first: galleryStart + 1,
                  last: Math.min(pageCount, galleryStart + 30),
                  pages: pageCount,
                })}
              </span>
              <button
                className="reader-icon"
                disabled={galleryStart + 30 >= pageCount}
                aria-label={t('Next thumbnails')}
                onClick={() => setGalleryStart((n) => n + 30)}
              >
                <ChevronRight size={21} />
              </button>
            </div>
            <div className="reader-thumbnails">
              {Array.from({ length: Math.min(30, pageCount - galleryStart) }, (_, n) => n + galleryStart + 1).map(
                (page) => (
                  <button
                    key={page}
                    aria-label={t('Go to page {page}', { page })}
                    aria-current={currentPage === page ? 'page' : undefined}
                    onClick={() => go(page)}
                  >
                    <Thumbnail doc={doc} pageIndex={page - 1} width={130} alt="" />
                    <span>
                      {page}
                      {record.bookmarks.includes(page) && <Bookmark size={12} fill="currentColor" />}
                    </span>
                  </button>
                ),
              )}
            </div>
          </>
        )}
        {pageTab === 'contents' &&
          (outline?.length ? (
            <OutlineList items={outline} onGo={outlineGo} />
          ) : (
            <p className="reader-empty-small">
              {outlineError
                ? t('This document’s contents could not be read.')
                : t('This PDF has no table of contents. Use thumbnails or jump to a page.')}
            </p>
          ))}
        {pageTab === 'bookmarks' &&
          (record.bookmarks.length ? (
            <ul className="reader-bookmarks">
              {record.bookmarks.map((page) => (
                <li key={page}>
                  <button className="reader-row" onClick={() => go(page)}>
                    <Bookmark size={18} />
                    {t('Page {index}', { index: page })}
                  </button>
                  <button
                    className="reader-icon"
                    aria-label={t('Remove bookmark on page {page}', { page })}
                    onClick={() => update({ bookmarks: record.bookmarks.filter((p) => p !== page) })}
                  >
                    <X size={18} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="reader-empty-small">
              {t('Bookmark a page with the ribbon button while reading. Your bookmarks will appear here.')}
            </p>
          ))}
      </Dialog>
    </div>
  );
}
function OutlineList({
  items,
  onGo,
}: {
  items: NonNullable<Outline>;
  onGo(dest: NonNullable<Outline>[number]['dest']): void;
}) {
  return (
    <ul className="reader-outline">
      {items.map((item, i) => (
        <li key={i}>
          {item.dest ? <button onClick={() => onGo(item.dest)}>{item.title}</button> : <span>{item.title}</span>}
          {item.items.length > 0 && <OutlineList items={item.items} onGo={onGo} />}
        </li>
      ))}
    </ul>
  );
}
