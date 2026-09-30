import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent,
} from 'react';
import { ArrowDown, ArrowUp, Binary, CornerDownRight, Search } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { FileDrop } from '@/components/ui/FileDrop';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Checkbox, Input, Label } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Panel } from '@/components/ui/Panel';
import { ProgressBar } from '@/components/ui/Feedback';
import { CopyButton } from '@/components/ui/Actions';
import { useAsyncJob, useMediaQuery } from '@/lib/hooks';
import { cn, errorMessage, formatBytes } from '@/lib/utils';
import { byteToChar, inspectBytes, parseHexPattern, parseOffset, searchFile, textPattern, toHex, utf8At } from './lib/hex';

const PAGE = 64 * 1024;
const MAX_PAGES = 96;
const ROW_H = 22;
const MAX_FILE = 1024 * 1024 * 1024 * 2;

class PageCache {
  private pages = new Map<number, Uint8Array>();
  private loading = new Map<number, Promise<void>>();
  constructor(
    private file: File,
    private onLoad: () => void,
  ) {}
  get(page: number): Uint8Array | undefined {
    const p = this.pages.get(page);
    if (p) {
      this.pages.delete(page);
      this.pages.set(page, p);
    }
    return p;
  }
  ensure(page: number) {
    if (this.pages.has(page) || this.loading.has(page)) return;
    const start = page * PAGE;
    const promise = this.file
      .slice(start, Math.min(this.file.size, start + PAGE))
      .arrayBuffer()
      .then((buf) => {
        this.pages.set(page, new Uint8Array(buf));
        while (this.pages.size > MAX_PAGES) this.pages.delete(this.pages.keys().next().value!);
        this.loading.delete(page);
        this.onLoad();
      })
      .catch(() => {
        this.loading.delete(page);
      });
    this.loading.set(page, promise);
  }
  byte(offset: number): number | undefined {
    const p = this.get(Math.floor(offset / PAGE));
    return p ? p[offset % PAGE] : undefined;
  }
}

export default function HexViewer() {
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const narrow = useMediaQuery('(max-width: 640px)');
  const bpr = narrow ? 8 : 16;
  const visibleRows = narrow ? 18 : 24;
  const [top, setTop] = useState(0);
  const [anchor, setAnchor] = useState(0);
  const [cursor, setCursor] = useState(0);
  const [, setVersion] = useState(0);
  const cache = useMemo(() => (file ? new PageCache(file, () => setVersion((v) => v + 1)) : null), [file]);
  const viewRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const touchY = useRef<number | null>(null);
  const wheelAcc = useRef(0);

  const size = file?.size ?? 0;
  const totalRows = Math.max(1, Math.ceil(size / bpr));
  const maxTop = Math.max(0, totalRows - visibleRows);
  const offWidth = size > 0xffffffff ? 10 : 8;

  // Load visible pages.
  const firstByte = top * bpr;
  const lastByte = Math.min(size, (top + visibleRows) * bpr);
  if (cache && size) {
    for (let p = Math.floor(firstByte / PAGE); p <= Math.floor(Math.max(firstByte, lastByte - 1) / PAGE); p++) cache.ensure(p);
  }

  const selStart = Math.min(anchor, cursor);
  const selEnd = Math.max(anchor, cursor);

  const scrollToOffset = useCallback(
    (offset: number) => {
      const row = Math.floor(offset / bpr);
      setTop((t) => (row < t ? row : row >= t + visibleRows ? Math.min(maxTop, row - visibleRows + 1) : t));
    },
    [bpr, visibleRows, maxTop],
  );

  function open(f: File) {
    if (f.size > MAX_FILE) {
      setError(`This file is ${formatBytes(f.size)}. The hex viewer supports files up to 2 GB.`);
      return;
    }
    setError(null);
    setFile(f);
    setTop(0);
    setAnchor(0);
    setCursor(0);
  }

  useEffect(() => {
    setTop((t) => Math.min(t, maxTop));
  }, [maxTop]);

  function moveCursor(next: number, extend: boolean) {
    const c = Math.max(0, Math.min(size - 1, next));
    setCursor(c);
    if (!extend) setAnchor(c);
    scrollToOffset(c);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!size) return;
    const page = visibleRows * bpr;
    const map: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -bpr,
      ArrowDown: bpr,
      PageUp: -page,
      PageDown: page,
    };
    let next: number | null = null;
    if (e.key in map) next = cursor + map[e.key];
    else if (e.key === 'Home') next = e.ctrlKey || e.metaKey ? 0 : cursor - (cursor % bpr);
    else if (e.key === 'End') next = e.ctrlKey || e.metaKey ? size - 1 : cursor - (cursor % bpr) + bpr - 1;
    if (next === null) return;
    e.preventDefault();
    moveCursor(next, e.shiftKey);
  }

  function onWheel(e: WheelEvent) {
    if (!size) return;
    wheelAcc.current += e.deltaMode === 1 ? e.deltaY * ROW_H : e.deltaY;
    const rows = Math.trunc(wheelAcc.current / ROW_H);
    if (rows) {
      wheelAcc.current -= rows * ROW_H;
      setTop((t) => Math.max(0, Math.min(maxTop, t + rows)));
    }
  }

  function offsetFromEvent(e: ReactPointerEvent): number | null {
    const el = (e.target as HTMLElement).closest('[data-off]') as HTMLElement | null;
    if (!el) return null;
    const n = Number(el.dataset.off);
    return Number.isFinite(n) && n < size ? n : null;
  }

  // Scrollbar
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbFrac = Math.min(1, visibleRows / totalRows);
  const posFrac = maxTop ? top / maxTop : 0;
  function scrollFromPointer(clientY: number) {
    const track = trackRef.current;
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const thumbPx = Math.max(24, rect.height * thumbFrac);
    const frac = Math.max(0, Math.min(1, (clientY - rect.top - thumbPx / 2) / Math.max(1, rect.height - thumbPx)));
    setTop(Math.round(frac * maxTop));
  }

  // Inspector bytes at the selection start.
  const [inspect, setInspect] = useState<Uint8Array>(new Uint8Array(0));
  useEffect(() => {
    if (!file || !size) return;
    let cancelled = false;
    file
      .slice(selStart, Math.min(size, selStart + 8))
      .arrayBuffer()
      .then((b) => !cancelled && setInspect(new Uint8Array(b)));
    return () => {
      cancelled = true;
    };
  }, [file, size, selStart]);

  // Go to offset
  const [goto, setGoto] = useState('');
  const [gotoError, setGotoError] = useState<string | null>(null);
  function doGoto() {
    const r = parseOffset(goto, size);
    if (!r.ok) return setGotoError(r.error);
    setGotoError(null);
    moveCursor(r.value, false);
    setTop(Math.min(maxTop, Math.max(0, Math.floor(r.value / bpr) - 2)));
    viewRef.current?.focus();
  }

  // Search
  const [mode, setMode] = useState<'text' | 'hex'>('text');
  const [query, setQuery] = useState('');
  const [ci, setCi] = useState(true);
  const [searchMsg, setSearchMsg] = useState<{
    tone: 'info' | 'danger';
    text: string;
  } | null>(null);
  const job = useAsyncJob();

  async function find(direction: 'forward' | 'backward') {
    if (!file) return;
    const p = mode === 'hex' ? parseHexPattern(query) : textPattern(query, ci);
    if ('error' in p) return setSearchMsg({ tone: 'danger', text: p.error });
    setSearchMsg(null);
    const from = direction === 'forward' ? (selEnd > selStart ? selStart + 1 : cursor + 1) : selStart - 1;
    try {
      const pos = await job.run(({ signal, progress }) =>
        searchFile(async (s, e) => new Uint8Array(await file.slice(s, e).arrayBuffer()), size, p, from, direction, {
          signal,
          onProgress: (f) => progress(f, 'Searching…'),
        }),
      );
      if (pos < 0)
        setSearchMsg({
          tone: 'info',
          text: direction === 'forward' ? 'No more matches after the cursor.' : 'No more matches before the cursor.',
        });
      else {
        setAnchor(pos);
        setCursor(pos + p.bytes.length - 1);
        setTop(Math.min(maxTop, Math.max(0, Math.floor(pos / bpr) - 2)));
        setSearchMsg({
          tone: 'info',
          text: `Match at 0x${toHex(pos, offWidth)} (${pos.toLocaleString()}).`,
        });
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError'))
        setSearchMsg({
          tone: 'danger',
          text: errorMessage(e, 'Search failed.'),
        });
    }
  }

  const rows = [];
  if (cache) {
    for (let r = top; r < Math.min(totalRows, top + visibleRows); r++) {
      const base = r * bpr;
      const hex = [];
      const txt = [];
      for (let i = 0; i < bpr; i++) {
        const off = base + i;
        if (off >= size) {
          hex.push(<span key={i} className={cn('inline-block w-[2.5ch] text-center', i === 8 && 'ml-[1ch]')} />);
          continue;
        }
        const v = cache.byte(off);
        const sel = off >= selStart && off <= selEnd;
        const cur = off === cursor;
        const cls = cn(sel && 'bg-accent-soft text-accent-text', cur && 'outline outline-1 outline-accent');
        hex.push(
          <span
            key={i}
            data-off={off}
            className={cn(
              'inline-block w-[2.5ch] cursor-default rounded-[3px] text-center',
              i === 8 && 'ml-[1ch]',
              v === 0 && !sel ? 'text-fg-muted' : 'text-fg',
              cls,
            )}
          >
            {v === undefined ? '··' : toHex(v, 2)}
          </span>,
        );
        txt.push(
          <span
            key={i}
            data-off={off}
            className={cn(
              'inline-block w-[1ch] rounded-[2px] text-center',
              v !== undefined && (v < 0x20 || v >= 0x7f) ? 'text-fg-muted' : 'text-fg-secondary',
              cls,
            )}
          >
            {v === undefined ? ' ' : byteToChar(v)}
          </span>,
        );
      }
      rows.push(
        <div key={r} className="flex items-center whitespace-pre" style={{ height: ROW_H }}>
          <span className="mr-2 shrink-0 text-accent-text select-none sm:mr-3">{toHex(base, offWidth)}</span>
          <span className="mr-2 shrink-0 sm:mr-3">{hex}</span>
          <span className="shrink-0 border-l border-line pl-2 sm:pl-3">{txt}</span>
        </div>,
      );
    }
  }

  const inspectRows = inspectBytes(inspect);
  const u8 = utf8At(inspect);
  const selLen = selEnd - selStart + 1;
  const cursorByte = size ? cache?.byte(cursor) : undefined;

  return (
    <ToolStack>
      <FileDrop
        onFiles={(f) => open(f[0])}
        icon={Binary}
        compact={Boolean(file)}
        title="Drop any file to view its bytes"
        hint="Up to 2 GB. Pages are read on demand, so huge files open instantly. Nothing is uploaded."
      />
      {error && <Alert tone="danger">{error}</Alert>}
      {file && size === 0 && <Alert tone="info">This file is empty (0 bytes).</Alert>}
      {file && size > 0 && (
        <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Panel
            title={file.name}
            description={`${formatBytes(size)} · ${size.toLocaleString()} bytes`}
            bodyClassName="p-0"
            className="xl:self-start"
          >
            <div className="flex">
              <div
                ref={viewRef}
                id="hex-dump"
                tabIndex={0}
                // Not a grid: rows are drawn on demand, so a focusable region plus an announced status line
                // (offset, value, selection) is what screen readers can actually use.
                role="region"
                aria-roledescription="hex dump"
                aria-label="Hex dump. Use arrow keys, Page Up/Down, Home/End; Shift extends the selection."
                aria-describedby="hex-status"
                onKeyDown={onKeyDown}
                onWheel={onWheel}
                onPointerDown={(e) => {
                  if (e.pointerType === 'touch') {
                    touchY.current = e.clientY;
                    return;
                  }
                  const off = offsetFromEvent(e);
                  if (off === null) return;
                  dragging.current = true;
                  setCursor(off);
                  if (!e.shiftKey) setAnchor(off);
                  viewRef.current?.focus();
                }}
                onPointerMove={(e) => {
                  if (e.pointerType === 'touch' && touchY.current !== null) {
                    const dy = touchY.current - e.clientY;
                    const n = Math.trunc(dy / ROW_H);
                    if (n) {
                      touchY.current -= n * ROW_H;
                      setTop((t) => Math.max(0, Math.min(maxTop, t + n)));
                    }
                    return;
                  }
                  if (!dragging.current) return;
                  const off = offsetFromEvent(e);
                  if (off !== null) setCursor(off);
                }}
                onPointerUp={(e) => {
                  if (e.pointerType === 'touch' && touchY.current !== null) {
                    const off = offsetFromEvent(e);
                    if (off !== null) {
                      setAnchor(off);
                      setCursor(off);
                    }
                    touchY.current = null;
                  }
                  dragging.current = false;
                }}
                onPointerLeave={() => (dragging.current = false)}
                className="min-w-0 flex-1 touch-none overflow-x-auto px-2 py-2 font-mono text-[11.5px] leading-none sm:px-3 outline-none select-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset sm:text-[13px]"
                style={{ height: visibleRows * ROW_H + 16 }}
              >
                {rows}
              </div>
              <div
                ref={trackRef}
                className="relative w-3.5 shrink-0 border-l border-line bg-surface-sunken"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  scrollFromPointer(e.clientY);
                }}
                onPointerMove={(e) => e.buttons && scrollFromPointer(e.clientY)}
                role="scrollbar"
                aria-controls="hex-dump"
                aria-orientation="vertical"
                aria-valuemin={0}
                aria-valuemax={maxTop}
                aria-valuenow={top}
                aria-label="Scroll position"
              >
                <div
                  className="absolute inset-x-0.5 rounded-full bg-line-strong"
                  style={{
                    height: `max(24px, ${thumbFrac * 100}%)`,
                    top: `calc(${posFrac} * (100% - max(24px, ${thumbFrac * 100}%)))`,
                  }}
                />
              </div>
            </div>
            <div
              id="hex-status"
              aria-live="polite"
              className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-2 font-mono text-[12px] text-fg-muted"
            >
              <span>
                Offset <span className="text-fg">0x{toHex(cursor, offWidth)}</span> ({cursor.toLocaleString()})
              </span>
              {cursorByte !== undefined && (
                <span>
                  Value <span className="text-fg">0x{toHex(cursorByte, 2)}</span> ({cursorByte})
                </span>
              )}
              {selLen > 1 && (
                <span>
                  Selection <span className="text-fg">{selLen.toLocaleString()}</span> bytes (0x{toHex(selStart, offWidth)}–0x
                  {toHex(selEnd, offWidth)})
                </span>
              )}
            </div>
          </Panel>
          <div className="flex min-w-0 flex-col gap-4">
            <Panel title="Go to offset">
              <div className="flex gap-2">
                <Input
                  value={goto}
                  onChange={(e) => setGoto(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && doGoto()}
                  placeholder="0x1F00 or 7936"
                  mono
                  aria-label="Offset"
                  aria-invalid={Boolean(gotoError) || undefined}
                />
                <Button icon={CornerDownRight} onClick={doGoto}>
                  Go
                </Button>
              </div>
              {gotoError && (
                <p className="mt-1.5 text-[12.5px] text-danger" role="alert">
                  {gotoError}
                </p>
              )}
            </Panel>
            <Panel title="Search">
              <div className="space-y-2.5">
                <Segmented
                  label="Search type"
                  size="sm"
                  value={mode}
                  onChange={setMode}
                  options={[
                    { value: 'text', label: 'Text (UTF-8)' },
                    { value: 'hex', label: 'Hex bytes' },
                  ]}
                />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void find(e.shiftKey ? 'backward' : 'forward')}
                  placeholder={mode === 'hex' ? 'DE AD BE EF  (?? = any byte)' : 'Text to find'}
                  mono
                  aria-label="Search query"
                />
                {mode === 'text' && <Checkbox label="Ignore case (ASCII)" checked={ci} onChange={setCi} />}
                <div className="flex gap-2">
                  <Button size="sm" icon={ArrowUp} disabled={job.running || !query} onClick={() => void find('backward')}>
                    Previous
                  </Button>
                  <Button
                    size="sm"
                    variant="primary"
                    icon={Search}
                    iconRight={ArrowDown}
                    disabled={job.running || !query}
                    onClick={() => void find('forward')}
                  >
                    Next
                  </Button>
                </div>
                {job.running && <ProgressBar value={job.progress} label={job.label} onCancel={job.cancel} />}
                {searchMsg && (
                  <p className={cn('text-[12.5px]', searchMsg.tone === 'danger' ? 'text-danger' : 'text-fg-secondary')}>{searchMsg.text}</p>
                )}
              </div>
            </Panel>
            <Panel title="Byte inspector" description={`At 0x${toHex(selStart, offWidth)}`} bodyClassName="px-4 py-2">
              <table className="w-full font-mono text-[12px]">
                <thead>
                  <tr className="text-left text-fg-muted">
                    <th className="py-1 font-normal">Type</th>
                    <th className="py-1 font-normal">Little-endian</th>
                    <th className="py-1 font-normal">Big-endian</th>
                  </tr>
                </thead>
                <tbody>
                  {inspectRows.map((r) => (
                    <tr key={r.label} className="border-t border-line">
                      <td className="py-1 pr-2 text-fg-muted">{r.label}</td>
                      <td className="max-w-[110px] truncate py-1 pr-2 text-fg" title={r.le}>
                        {r.le}
                      </td>
                      <td className="max-w-[110px] truncate py-1 text-fg" title={r.be}>
                        {r.be}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t border-line">
                    <td className="py-1 pr-2 text-fg-muted">binary</td>
                    <td colSpan={2} className="py-1 text-fg">
                      {inspect.length ? inspect[0].toString(2).padStart(8, '0') : '—'}
                    </td>
                  </tr>
                  <tr className="border-t border-line">
                    <td className="py-1 pr-2 text-fg-muted">UTF-8</td>
                    <td colSpan={2} className="py-1 text-fg">
                      {u8
                        ? `${JSON.stringify(u8.char)} (${u8.length} byte${u8.length > 1 ? 's' : ''}, U+${u8.char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`
                        : 'not a valid character start'}
                    </td>
                  </tr>
                </tbody>
              </table>
              {selLen > 1 && selLen <= 4096 && (
                <div className="mt-2">
                  <CopyButton
                    label="Copy selection as hex"
                    value={() => {
                      const out: string[] = [];
                      for (let o = selStart; o <= selEnd; o++) {
                        const v = cache?.byte(o);
                        out.push(v === undefined ? '??' : toHex(v, 2));
                      }
                      return out.join(' ');
                    }}
                  />
                </div>
              )}
            </Panel>
            <p className="text-[12px] text-fg-muted">
              <Label className="mb-0 inline text-[12px]">Keys:</Label> arrows move, Shift selects, Page Up/Down, Home/End, Ctrl+Home/End
              jump to the start/end.
            </p>
          </div>
        </div>
      )}
    </ToolStack>
  );
}
