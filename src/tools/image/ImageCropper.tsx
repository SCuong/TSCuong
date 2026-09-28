import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Crop, Download, RotateCcw } from 'lucide-react';
import { ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { FileDrop } from '@/components/ui/FileDrop';
import { Checkbox, Label, NumberInput, Select } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Button } from '@/components/ui/Button';
import { ErrorMessage } from '@/components/ui/Alert';
import { Panel } from '@/components/ui/Panel';
import { Kbd } from '@/components/ui/Panel';
import { Spinner } from '@/components/ui/Feedback';
import { toast } from '@/components/ui/Toast';
import { useToolState } from '@/lib/hooks';
import { baseName, downloadBlob, errorMessage, formatBytes } from '@/lib/utils';
import { useSingleImage } from './components/useSingleImage';
import { RangeField } from './components/controls';
import { OUTPUT_INFO } from './lib/canvas';
import { centeredAspectRect, type Rect } from './lib/geometry';
import { moveCrop, resizeCrop, roundCrop, type Handle } from './lib/crop';
import { runJobOnSource } from './lib/pipeline';
import { IMAGE_ACCEPT } from './lib/accept';

type AspectKey = 'free' | '1:1' | '4:3' | '3:2' | '16:9' | '9:16' | '4:5' | 'custom';
type Format = 'keep' | 'png' | 'jpeg' | 'webp';

const HANDLES: Array<{ h: Handle; cls: string; cursor: string }> = [
  { h: 'nw', cls: '-left-1.5 -top-1.5', cursor: 'nwse-resize' },
  { h: 'n', cls: 'left-1/2 -top-1.5 -translate-x-1/2', cursor: 'ns-resize' },
  { h: 'ne', cls: '-right-1.5 -top-1.5', cursor: 'nesw-resize' },
  { h: 'e', cls: '-right-1.5 top-1/2 -translate-y-1/2', cursor: 'ew-resize' },
  { h: 'se', cls: '-right-1.5 -bottom-1.5', cursor: 'nwse-resize' },
  { h: 's', cls: 'left-1/2 -bottom-1.5 -translate-x-1/2', cursor: 'ns-resize' },
  { h: 'sw', cls: '-left-1.5 -bottom-1.5', cursor: 'nesw-resize' },
  { h: 'w', cls: '-left-1.5 top-1/2 -translate-y-1/2', cursor: 'ew-resize' },
];

function aspectValue(key: AspectKey, cw: number | '', ch: number | ''): number | null {
  if (key === 'free') return null;
  if (key === 'custom') return typeof cw === 'number' && typeof ch === 'number' && cw > 0 && ch > 0 ? cw / ch : null;
  const [a, b] = key.split(':').map(Number);
  return a / b;
}

export default function ImageCropper() {
  const { image, error, loading, load, clear } = useSingleImage();
  const [aspectKey, setAspectKey] = useToolState<AspectKey>('image-crop', 'aspect', 'free');
  const [customW, setCustomW] = useToolState<number | ''>('image-crop', 'customW', 3);
  const [customH, setCustomH] = useToolState<number | ''>('image-crop', 'customH', 2);
  const [circle, setCircle] = useToolState('image-crop', 'circle', false);
  const [format, setFormat] = useToolState<Format>('image-crop', 'format', 'keep');
  const [quality, setQuality] = useToolState('image-crop', 'quality', 92);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [busy, setBusy] = useState(false);
  const [displayW, setDisplayW] = useState(0);
  const imgRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ kind: 'move' | Handle; startX: number; startY: number; start: Rect } | null>(null);

  const aspect = aspectValue(aspectKey, customW, customH);
  const bounds = image ? { width: image.width, height: image.height } : { width: 1, height: 1 };
  const scale = image && displayW ? displayW / image.width : 1;

  // Reset the crop box for new images or aspect changes.
  useEffect(() => {
    if (!image) return setCrop(null);
    const b = { width: image.width, height: image.height };
    setCrop(aspect ? centeredAspectRect(b, aspect) : { x: 0, y: 0, width: b.width, height: b.height });
  }, [image, aspect]);

  useEffect(() => {
    const el = imgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setDisplayW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [image]);

  function onPointerDown(e: ReactPointerEvent, kind: 'move' | Handle) {
    if (!crop) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind, startX: e.clientX, startY: e.clientY, start: crop };
  }

  function onPointerMove(e: ReactPointerEvent) {
    const d = drag.current;
    if (!d || !image) return;
    const dx = (e.clientX - d.startX) / scale;
    const dy = (e.clientY - d.startY) / scale;
    const minSize = Math.max(1, 12 / scale);
    setCrop(d.kind === 'move' ? moveCrop(d.start, dx, dy, bounds) : resizeCrop(d.start, d.kind, dx, dy, bounds, aspect, minSize));
  }

  function onPointerUp() {
    if (drag.current && crop) setCrop(roundCrop(crop, bounds));
    drag.current = null;
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!crop) return;
    const step = e.shiftKey ? 10 : 1;
    const map: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const d = map[e.key];
    if (!d) return;
    e.preventDefault();
    if (e.altKey) {
      const handle: Handle = d[0] ? 'e' : 's';
      setCrop(roundCrop(resizeCrop(crop, handle, d[0], d[1], bounds, aspect), bounds));
    } else {
      setCrop(roundCrop(moveCrop(crop, d[0], d[1], bounds), bounds));
    }
  }

  function setField(key: keyof Rect, value: number | '') {
    if (!crop || value === '') return;
    let next = { ...crop, [key]: value };
    if (aspect && (key === 'width' || key === 'height')) {
      if (key === 'width') next.height = value / aspect;
      else next.width = value * aspect;
      if (next.width > bounds.width || next.height > bounds.height) return;
    }
    next = roundCrop(next, bounds);
    setCrop(next);
  }

  const src = image?.header.format;
  const resolved: Exclude<Format, 'keep'> = format === 'keep' ? (src === 'jpeg' || src === 'webp' ? src : 'png') : format;
  const outFormat: Exclude<Format, 'keep'> = circle && resolved === 'jpeg' ? 'png' : resolved;

  async function exportCrop() {
    if (!image || !crop) return;
    setBusy(true);
    try {
      const r = await runJobOnSource(image.bitmap, image.header.format, {
        crop: { ...roundCrop(crop, bounds), circle },
        output: { format: outFormat, quality: quality / 100, background: '#ffffff' },
      });
      downloadBlob(r.blob, `${baseName(image.file.name)}-cropped.${OUTPUT_INFO[r.format].ext}`);
      toast(`Saved ${r.width}×${r.height} ${OUTPUT_INFO[r.format].label} (${formatBytes(r.blob.size)})`);
    } catch (e) {
      toast(errorMessage(e, 'Could not crop the image.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  const box = crop && {
    left: crop.x * scale,
    top: crop.y * scale,
    width: crop.width * scale,
    height: crop.height * scale,
  };

  return (
    <ToolStack>
      <ToolBar>
        <div className="min-w-0">
          <Label>Aspect ratio</Label>
          <Segmented
            label="Aspect ratio"
            value={aspectKey}
            onChange={setAspectKey}
            options={(['free', '1:1', '4:3', '3:2', '16:9', '9:16', '4:5', 'custom'] as AspectKey[]).map((k) => ({
              value: k,
              label: k === 'free' ? 'Free' : k === 'custom' ? 'Custom' : k,
            }))}
          />
        </div>
        {aspectKey === 'custom' && (
          <div className="flex items-end gap-1.5">
            <div className="w-20">
              <Label htmlFor="crop-cw">Ratio W</Label>
              <NumberInput id="crop-cw" value={customW} onChange={setCustomW} min={0.01} step={0.1} />
            </div>
            <span className="pb-2 text-fg-muted">:</span>
            <div className="w-20">
              <Label htmlFor="crop-ch">Ratio H</Label>
              <NumberInput id="crop-ch" value={customH} onChange={setCustomH} min={0.01} step={0.1} />
            </div>
          </div>
        )}
        <Checkbox label="Circle / ellipse crop (PNG)" checked={circle} onChange={setCircle} className="pb-1.5" />
      </ToolBar>

      {!image && (
        <FileDrop accept={IMAGE_ACCEPT} onFiles={(f) => void load(f[0])} icon={Crop} title="Drop an image to crop" />
      )}
      {loading && <Spinner label="Opening image…" />}
      <ErrorMessage error={error} />

      {image && crop && box && (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[1fr_280px]">
          <Panel title={image.file.name} description={`${image.width} × ${image.height} px`} actions={<Button size="sm" variant="ghost" onClick={clear}>Choose another</Button>}>
            <div className="flex justify-center">
              <div className="lk-checker relative inline-block max-w-full touch-none select-none" onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
                <img
                  ref={imgRef}
                  src={image.url}
                  alt="Image being cropped"
                  draggable={false}
                  className="block max-h-[65vh] max-w-full"
                  onLoad={(e) => setDisplayW(e.currentTarget.clientWidth)}
                />
                {displayW > 0 && (
                  <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
                    <div className="absolute" style={{ ...box, boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.55)', borderRadius: circle ? '50%' : undefined }} />
                  </div>
                )}
                {displayW > 0 && (
                  <div
                    role="slider"
                    tabIndex={0}
                    aria-label="Crop area. Arrow keys move it, Shift moves 10 px, Alt+arrows resize."
                    aria-valuetext={`${crop.width} by ${crop.height} at ${crop.x}, ${crop.y}`}
                    aria-valuenow={crop.x}
                    onKeyDown={onKeyDown}
                    onPointerDown={(e) => onPointerDown(e, 'move')}
                    className="absolute cursor-move outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    style={box}
                  >
                    <div className="pointer-events-none absolute inset-0 border border-white/90" style={{ borderRadius: circle ? '50%' : undefined }} />
                    <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
                      {Array.from({ length: 9 }, (_, i) => (
                        <div key={i} className="border-[0.5px] border-white/25" />
                      ))}
                    </div>
                    {HANDLES.map(({ h, cls, cursor }) => (
                      <div
                        key={h}
                        onPointerDown={(e) => onPointerDown(e, h)}
                        className={`absolute size-3 rounded-sm border border-black/40 bg-white shadow ${cls}`}
                        style={{ cursor }}
                        aria-hidden
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
            <p className="mt-3 text-center text-[12.5px] text-fg-muted">
              Drag the box or its handles. Focus it and use <Kbd>←</Kbd>
              <Kbd>→</Kbd>
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> to nudge, <Kbd>Shift</Kbd> for 10 px, <Kbd>Alt</Kbd> to resize.
            </p>
          </Panel>
          <Panel title="Selection">
            <div className="grid grid-cols-2 gap-3">
              {(['x', 'y', 'width', 'height'] as const).map((k) => (
                <div key={k}>
                  <Label htmlFor={`crop-${k}`}>{k === 'x' ? 'X' : k === 'y' ? 'Y' : k === 'width' ? 'Width' : 'Height'}</Label>
                  <NumberInput id={`crop-${k}`} value={Math.round(crop[k])} onChange={(v) => setField(k, v)} min={k === 'x' || k === 'y' ? 0 : 1} />
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setCrop(aspect ? centeredAspectRect(bounds, aspect) : { x: 0, y: 0, ...bounds })}>
                Reset
              </Button>
            </div>
            <div className="mt-4 space-y-3 border-t border-line pt-4">
              <div>
                <Label htmlFor="crop-fmt">Format</Label>
                <Select id="crop-fmt" value={circle && format === 'jpeg' ? 'png' : format} onChange={(e) => setFormat(e.target.value as Format)}>
                  <option value="keep">Same as input{circle && src === 'jpeg' ? ' (PNG for circle)' : ''}</option>
                  <option value="png">PNG</option>
                  <option value="jpeg" disabled={circle}>
                    JPEG{circle ? ' (no transparency)' : ''}
                  </option>
                  <option value="webp">WebP</option>
                </Select>
              </div>
              {outFormat !== 'png' && (
                <RangeField label="Quality" value={quality} min={10} max={100} onChange={setQuality} format={(v) => `${v}%`} />
              )}
              <Button variant="primary" icon={Download} className="w-full" loading={busy} onClick={exportCrop}>
                Download {Math.round(crop.width)}×{Math.round(crop.height)}
              </Button>
            </div>
          </Panel>
        </div>
      )}
    </ToolStack>
  );
}
