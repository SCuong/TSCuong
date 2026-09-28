import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Pipette, X } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { FileDrop } from '@/components/ui/FileDrop';
import { Button, IconButton } from '@/components/ui/Button';
import { ErrorMessage } from '@/components/ui/Alert';
import { Kbd, Panel } from '@/components/ui/Panel';
import { EmptyState, Spinner } from '@/components/ui/Feedback';
import { CopyButton } from '@/components/ui/Actions';
import { useSingleImage } from './components/useSingleImage';
import { toast } from '@/components/ui/Toast';
import { copyText } from '@/lib/utils';
import { createCanvas, getContext, type AnyCanvas, type Ctx2D } from './lib/canvas';
import { formatColor, readableTextOn } from './lib/color';
import { IMAGE_ACCEPT } from './lib/accept';

interface Pick {
  id: number;
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

const LOUPE_PX = 11; // source pixels across
const LOUPE_SIZE = 132; // css px

let pickSeq = 0;

export default function ImageColorPicker() {
  const { image, error, loading, load, clear } = useSingleImage();
  const [hover, setHover] = useState<Pick | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [screen, setScreen] = useState<{ left: number; top: number } | null>(null);
  const [picks, setPicks] = useState<Pick[]>([]);
  const source = useRef<{ canvas: AnyCanvas; ctx: Ctx2D } | null>(null);
  const loupe = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    source.current = null;
    setHover(null);
    setCursor(null);
    if (!image) return;
    const canvas = createCanvas(image.width, image.height);
    const ctx = getContext(canvas, { willReadFrequently: true });
    ctx.drawImage(image.bitmap, 0, 0);
    source.current = { canvas, ctx };
  }, [image]);

  function sample(x: number, y: number): Pick | null {
    const s = source.current;
    if (!s || !image) return null;
    const cx = Math.min(image.width - 1, Math.max(0, Math.floor(x)));
    const cy = Math.min(image.height - 1, Math.max(0, Math.floor(y)));
    const [r, g, b, a] = s.ctx.getImageData(cx, cy, 1, 1).data;
    return { id: 0, x: cx, y: cy, r, g, b, a };
  }

  function drawLoupe(x: number, y: number) {
    const s = source.current;
    const c = loupe.current;
    if (!s || !c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, c.width, c.height);
    const half = Math.floor(LOUPE_PX / 2);
    ctx.drawImage(s.canvas, x - half, y - half, LOUPE_PX, LOUPE_PX, 0, 0, c.width, c.height);
    const cell = c.width / LOUPE_PX;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 2;
    ctx.strokeRect(half * cell, half * cell, cell, cell);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1;
    ctx.strokeRect(half * cell - 1.5, half * cell - 1.5, cell + 3, cell + 3);
  }

  function toImageCoords(e: ReactPointerEvent) {
    const el = imgRef.current;
    if (!el || !image) return null;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * image.width;
    const y = ((e.clientY - rect.top) / rect.height) * image.height;
    if (x < 0 || y < 0 || x >= image.width || y >= image.height) return null;
    return { x: Math.floor(x), y: Math.floor(y), left: e.clientX - rect.left, top: e.clientY - rect.top };
  }

  function update(x: number, y: number) {
    setCursor({ x, y });
    setHover(sample(x, y));
    drawLoupe(x, y);
  }

  function onMove(e: ReactPointerEvent) {
    const p = toImageCoords(e);
    if (!p) {
      setScreen(null);
      return;
    }
    setScreen({ left: p.left, top: p.top });
    update(p.x, p.y);
  }

  function pick(x: number, y: number) {
    const s = sample(x, y);
    if (s) setPicks((list) => [{ ...s, id: ++pickSeq }, ...list].slice(0, 50));
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!image) return;
    const c = cursor ?? { x: Math.floor(image.width / 2), y: Math.floor(image.height / 2) };
    const step = e.shiftKey ? 10 : 1;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) {
      e.preventDefault();
      const x = Math.min(image.width - 1, Math.max(0, c.x + moves[e.key][0]));
      const y = Math.min(image.height - 1, Math.max(0, c.y + moves[e.key][1]));
      const el = imgRef.current;
      if (el) setScreen({ left: ((x + 0.5) / image.width) * el.clientWidth, top: ((y + 0.5) / image.height) * el.clientHeight });
      update(x, y);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      pick(c.x, c.y);
    }
  }

  const current = hover ? formatColor(hover.r, hover.g, hover.b, hover.a) : null;
  const imgWidth = imgRef.current?.clientWidth ?? 0;

  return (
    <ToolStack>
      {!image && <FileDrop accept={IMAGE_ACCEPT} onFiles={(f) => void load(f[0])} icon={Pipette} title="Drop an image to pick colors from" />}
      {loading && <Spinner label="Opening image…" />}
      <ErrorMessage error={error} />
      {image && (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[1fr_300px]">
          <Panel
            title={image.file.name}
            description={`${image.width} × ${image.height} px`}
            actions={
              <Button size="sm" variant="ghost" onClick={() => { clear(); setPicks([]); }}>
                Choose another
              </Button>
            }
          >
            <div className="flex justify-center">
              <div
                className="lk-checker relative inline-block max-w-full cursor-crosshair touch-none outline-none focus-visible:ring-2 focus-visible:ring-accent"
                tabIndex={0}
                role="application"
                aria-label="Image color picker. Arrow keys move the cursor, Enter picks the color."
                onPointerMove={onMove}
                onPointerDown={(e) => {
                  const p = toImageCoords(e);
                  if (!p) return;
                  setScreen({ left: p.left, top: p.top });
                  update(p.x, p.y);
                  if (e.pointerType === 'mouse') pick(p.x, p.y);
                }}
                onPointerUp={(e) => {
                  if (e.pointerType === 'mouse') return;
                  const p = toImageCoords(e);
                  if (p) pick(p.x, p.y);
                }}
                onPointerLeave={(e) => {
                  if (e.pointerType === 'mouse') setScreen(null);
                }}
                onKeyDown={onKeyDown}
              >
                <img ref={imgRef} src={image.url} alt="Image to pick colors from" draggable={false} className="block max-h-[65vh] max-w-full select-none" />
                <canvas
                  ref={loupe}
                  width={LOUPE_SIZE}
                  height={LOUPE_SIZE}
                  aria-hidden
                  className="pointer-events-none absolute rounded-full border-2 border-white shadow-lg ring-1 ring-black/40"
                  style={{
                    width: LOUPE_SIZE,
                    height: LOUPE_SIZE,
                    display: screen ? 'block' : 'none',
                    left: screen ? Math.min(Math.max(screen.left + 18, 0), Math.max(0, imgWidth - LOUPE_SIZE)) : 0,
                    top: screen ? Math.max(0, screen.top - LOUPE_SIZE - 12) : 0,
                    imageRendering: 'pixelated',
                  }}
                />
              </div>
            </div>
            <p className="mt-3 text-center text-[12.5px] text-fg-muted">
              Hover to preview, click to pick. Keyboard: focus the image, <Kbd>←</Kbd>
              <Kbd>→</Kbd>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> to move, <Kbd>Enter</Kbd> to pick.
            </p>
          </Panel>
          <div className="flex min-w-0 flex-col gap-4">
            <Panel title="Under cursor">
              {hover && current ? (
                <div>
                  <div
                    className="flex h-16 items-end rounded-lg border border-line p-2 font-mono text-[12px]"
                    style={{ backgroundColor: current.rgb.startsWith('rgb(') ? current.rgb : current.hex, color: readableTextOn(hover.r, hover.g, hover.b) }}
                  >
                    x {hover.x}, y {hover.y}
                  </div>
                  <dl className="mt-3 space-y-1.5 font-mono text-[13px]">
                    {(['hex', 'rgb', 'hsl'] as const).map((k) => (
                      <div key={k} className="flex items-center justify-between gap-2">
                        <dt className="w-10 text-fg-muted uppercase">{k}</dt>
                        <dd className="min-w-0 flex-1 truncate text-fg">{current[k]}</dd>
                        <CopyButton value={current[k]} iconOnly label={`Copy ${k.toUpperCase()}`} />
                      </div>
                    ))}
                  </dl>
                  {hover.a < 255 && <p className="mt-2 text-[12px] text-fg-muted">Alpha {hover.a} / 255</p>}
                </div>
              ) : (
                <p className="text-[13px] text-fg-muted">Move over the image to see the color.</p>
              )}
            </Panel>
            <Panel
              title={`Picked colors${picks.length ? ` (${picks.length})` : ''}`}
              actions={picks.length > 0 && <Button size="sm" variant="ghost" onClick={() => setPicks([])}>Clear</Button>}
              bodyClassName="p-0"
            >
              {picks.length === 0 ? (
                <EmptyState title="No colors yet">Click the image to add colors here.</EmptyState>
              ) : (
                <ul className="max-h-96 divide-y divide-line overflow-y-auto">
                  {picks.map((p) => {
                    const f = formatColor(p.r, p.g, p.b, p.a);
                    return (
                      <li key={p.id} className="flex items-center gap-2.5 px-3 py-2">
                        <span className="size-8 shrink-0 rounded-md border border-line" style={{ backgroundColor: f.hex }} />
                        <div className="min-w-0 flex-1">
                          <p className="font-mono text-[12.5px] text-fg">
                            {f.hex} <span className="text-fg-muted">· {p.x}, {p.y}</span>
                          </p>
                          <div className="mt-0.5 flex gap-1">
                            {(['hex', 'rgb', 'hsl'] as const).map((k) => (
                              <button
                                key={k}
                                type="button"
                                title={f[k]}
                                onClick={() => void copyText(f[k]).then((ok) => toast(ok ? `Copied ${f[k]}` : 'Copy failed.', ok ? 'success' : 'error'))}
                                className="rounded border border-line bg-surface-sunken px-1.5 py-px text-[11px] font-medium text-fg-secondary uppercase hover:bg-surface-hover hover:text-fg"
                              >
                                {k}
                              </button>
                            ))}
                          </div>
                        </div>
                        <IconButton icon={X} size="sm" label="Remove color" onClick={() => setPicks((l) => l.filter((x) => x.id !== p.id))} />
                      </li>
                    );
                  })}
                </ul>
              )}
              {picks.length > 1 && (
                <div className="border-t border-line p-3">
                  <CopyButton value={picks.map((p) => formatColor(p.r, p.g, p.b, p.a).hex).join('\n')} label="Copy all HEX" />
                </div>
              )}
            </Panel>
          </div>
        </div>
      )}
    </ToolStack>
  );
}
