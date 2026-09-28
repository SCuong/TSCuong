import { useCallback, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type PointerEvent, type Ref } from 'react';
import { Maximize, ZoomIn, ZoomOut } from 'lucide-react';
import { IconButton } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { fitTransform, MAX_SCALE, MIN_SCALE, svgSize, zoomAt, type ViewTransform } from '../lib/diagrams';

export interface ZoomCanvasHandle {
  fit: () => void;
}

const STEP = 1.2;

/**
 * Pan (drag) and zoom (buttons, Ctrl/Cmd + wheel, +/-/0 keys) viewer for a
 * sized SVG string. The SVG comes from Mermaid with securityLevel "strict",
 * which sanitizes labels before rendering.
 */
export function ZoomCanvas({
  svg,
  background,
  stale,
  fitKey,
  handleRef,
  className,
}: {
  svg: string;
  background: string;
  stale?: boolean;
  /** Changing this re-fits the diagram (e.g. when another diagram is opened). */
  fitKey: string;
  handleRef?: Ref<ZoomCanvasHandle>;
  className?: string;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewTransform>({ scale: 1, x: 0, y: 0 });
  const drag = useRef<{ id: number; x: number; y: number; vx: number; vy: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const size = svgSize(svg);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const fittedFor = useRef<string | null>(null);

  const fit = useCallback(() => {
    const el = viewport.current;
    const content = sizeRef.current;
    if (!el || !content) return;
    setView(fitTransform(content, { width: el.clientWidth, height: el.clientHeight }));
  }, []);

  useImperativeHandle(handleRef, () => ({ fit }), [fit]);

  // Fit once per diagram (and when the first render arrives), but keep the user's view while they edit.
  useEffect(() => {
    if (!size || fittedFor.current === fitKey) return;
    fittedFor.current = fitKey;
    fit();
  }, [fitKey, size, fit]);

  const zoomBy = useCallback((factor: number, px?: number, py?: number) => {
    const el = viewport.current;
    if (!el) return;
    setView((v) => zoomAt(v, factor, px ?? el.clientWidth / 2, py ?? el.clientHeight / 2));
  }, []);

  // Ctrl/Cmd + wheel zooms at the pointer. Needs a non-passive listener to prevent page zoom.
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    function onWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = el!.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0025));
      zoomBy(factor, event.clientX - rect.left, event.clientY - rect.top);
    }
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomBy]);

  // Active pointers: one pans, two pinch-zoom around their midpoint.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number } | null>(null);

  function local(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, local(event));
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
      drag.current = null;
    } else if (pointers.current.size === 1) {
      drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, vx: view.x, vy: view.y };
      setDragging(true);
    }
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, local(event));
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const factor = dist / pinch.current.dist;
      pinch.current = { dist };
      setView((v) => zoomAt(v, factor, (a.x + b.x) / 2, (a.y + b.y) / 2));
      return;
    }
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    setView((v) => ({ ...v, x: d.vx + event.clientX - d.x, y: d.vy + event.clientY - d.y }));
  }
  function endDrag(event: PointerEvent<HTMLDivElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (drag.current?.id === event.pointerId || pointers.current.size === 0) {
      drag.current = null;
      setDragging(false);
    }
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const pan = 40;
    if (event.key === '+' || event.key === '=') zoomBy(STEP);
    else if (event.key === '-' || event.key === '_') zoomBy(1 / STEP);
    else if (event.key === '0') fit();
    else if (event.key === 'ArrowLeft') setView((v) => ({ ...v, x: v.x + pan }));
    else if (event.key === 'ArrowRight') setView((v) => ({ ...v, x: v.x - pan }));
    else if (event.key === 'ArrowUp') setView((v) => ({ ...v, y: v.y + pan }));
    else if (event.key === 'ArrowDown') setView((v) => ({ ...v, y: v.y - pan }));
    else return;
    event.preventDefault();
  }

  return (
    <div className={cn('relative min-h-0 overflow-hidden rounded-lg border border-line-strong', className)} style={{ background }}>
      <div
        ref={viewport}
        role="img"
        aria-label={stale ? 'Diagram preview (last valid version)' : 'Diagram preview'}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
        onDoubleClick={fit}
        className={cn(
          'absolute inset-0 touch-none select-none focus-visible:outline-2 focus-visible:-outline-offset-2',
          dragging ? 'cursor-grabbing' : 'cursor-grab',
        )}
      >
        <div
          className={cn('absolute top-0 left-0 origin-top-left transition-opacity duration-150', stale && 'opacity-45 grayscale')}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
          // Mermaid output (securityLevel "strict" sanitizes it with DOMPurify).
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      <div className="absolute right-2 bottom-2 flex items-center gap-0.5 rounded-lg border border-line-strong bg-surface-raised p-0.5 shadow-raised">
        <IconButton icon={ZoomOut} label="Zoom out" size="sm" disabled={view.scale <= MIN_SCALE + 1e-6} onClick={() => zoomBy(1 / STEP)} />
        <button
          type="button"
          onClick={() => {
            const el = viewport.current;
            if (el) zoomBy(1 / view.scale, el.clientWidth / 2, el.clientHeight / 2);
          }}
          title="Reset to 100%"
          aria-label={`Zoom ${Math.round(view.scale * 100)}%. Reset to 100%`}
          className="h-7 min-w-12 rounded-md px-1 text-[12px] font-medium tabular-nums text-fg-secondary hover:bg-surface-hover hover:text-fg"
        >
          {Math.round(view.scale * 100)}%
        </button>
        <IconButton icon={ZoomIn} label="Zoom in" size="sm" disabled={view.scale >= MAX_SCALE - 1e-6} onClick={() => zoomBy(STEP)} />
        <IconButton icon={Maximize} label="Fit to screen" size="sm" onClick={fit} />
      </div>
    </div>
  );
}
