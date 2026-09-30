import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Download, FileArchive, Share2 } from 'lucide-react';
import { ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { FileDrop } from '@/components/ui/FileDrop';
import { Button } from '@/components/ui/Button';
import { ErrorMessage } from '@/components/ui/Alert';
import { Label, Select } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Panel } from '@/components/ui/Panel';
import { Spinner } from '@/components/ui/Feedback';
import { toast } from '@/components/ui/Toast';
import { useToolState } from '@/lib/hooks';
import { baseName, cn, downloadBlob, errorMessage, formatBytes } from '@/lib/utils';
import { useSingleImage } from './components/useSingleImage';
import { ColorField, RangeField } from './components/controls';
import { createCanvas, encodeCanvas, fillBackground, fitWithin, getContext, OUTPUT_INFO, type AnyCanvas } from './lib/canvas';
import { containDestRect, coverSourceRect } from './lib/geometry';
import { resample, scaledBitmap } from './lib/pipeline';
import { supportsCanvasFilter } from './lib/filters';
import { SOCIAL_PRESETS } from './lib/socialPresets';
import { zipBlobs } from './lib/zip';
import { IMAGE_ACCEPT } from './lib/accept';
import { t } from '@/lib/i18n';

type Fit = 'cover' | 'contain';
type Fill = 'color' | 'blur';
type Format = 'jpeg' | 'png' | 'webp';

/**
 * Render `src` into a w×h frame. `flattenOn` fills transparent areas (needed for
 * JPEG, which has no alpha: the encoder would otherwise turn them black).
 */
function render(
  src: ImageBitmap,
  w: number,
  h: number,
  fit: Fit,
  focal: { x: number; y: number },
  fill: Fill,
  color: string,
  flattenOn: string | null,
): AnyCanvas {
  const out = createCanvas(w, h);
  const ctx = getContext(out);
  ctx.imageSmoothingQuality = 'high';
  const size = { width: src.width, height: src.height };
  if (fit === 'cover') {
    const r = coverSourceRect(size, { width: w, height: h }, focal);
    // Crop first, then resample for quality.
    const crop = createCanvas(Math.max(1, Math.round(r.width)), Math.max(1, Math.round(r.height)));
    getContext(crop).drawImage(src, r.x, r.y, r.width, r.height, 0, 0, crop.width, crop.height);
    ctx.drawImage(resample(crop, { width: w, height: h }), 0, 0);
    if (flattenOn) fillBackground(ctx, w, h, flattenOn);
    return out;
  }
  if (flattenOn) {
    // Paint the flattening color first so transparent parts of the blurred backdrop don't turn black.
    ctx.fillStyle = flattenOn;
    ctx.fillRect(0, 0, w, h);
  }
  if (fill === 'blur') {
    const r = coverSourceRect(size, { width: w, height: h });
    // Scale the blur with the frame so the preview (smaller) matches the export.
    const k = Math.max(w, h) / 1200;
    const bleed = Math.round(40 * k);
    if (supportsCanvasFilter()) {
      ctx.filter = `blur(${Math.max(1, 24 * k)}px) brightness(0.85)`;
      ctx.drawImage(src, r.x, r.y, r.width, r.height, -bleed, -bleed, w + bleed * 2, h + bleed * 2);
      ctx.filter = 'none';
    } else {
      // No canvas filters (older Safari): upscale a tiny copy, which blurs naturally.
      const tiny = createCanvas(Math.max(1, Math.round(w / 24)), Math.max(1, Math.round(h / 24)));
      getContext(tiny).drawImage(src, r.x, r.y, r.width, r.height, 0, 0, tiny.width, tiny.height);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(tiny, 0, 0, w, h);
    }
    ctx.fillStyle = 'rgb(0 0 0 / 0.15)';
    ctx.fillRect(0, 0, w, h);
  } else {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
  }
  const d = containDestRect(size, { width: w, height: h });
  const scaled = resample(src, { width: Math.max(1, Math.round(d.width)), height: Math.max(1, Math.round(d.height)) });
  ctx.drawImage(scaled, Math.round(d.x), Math.round(d.y));
  return out;
}

export default function SocialImageResizer() {
  const { image, error, loading, load, clear } = useSingleImage();
  const [presetId, setPresetId] = useToolState('image-social', 'preset', SOCIAL_PRESETS[0].id);
  const [fit, setFit] = useToolState<Fit>('image-social', 'fit', 'cover');
  const [fill, setFill] = useToolState<Fill>('image-social', 'fill', 'blur');
  const [color, setColor] = useToolState('image-social', 'color', '#ffffff');
  const [format, setFormat] = useToolState<Format>('image-social', 'format', 'jpeg');
  const [quality, setQuality] = useToolState('image-social', 'quality', 88);
  const [focal, setFocal] = useState({ x: 0.5, y: 0.5 });
  const [busy, setBusy] = useState(false);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const dragging = useRef(false);
  const preset = SOCIAL_PRESETS.find((p) => p.id === presetId) ?? SOCIAL_PRESETS[0];
  // JPEG has no transparency: flatten on white (or the chosen background color).
  const flattenOn = format === 'jpeg' ? (fit === 'contain' && fill === 'color' ? color : '#ffffff') : null;

  useEffect(() => setFocal({ x: 0.5, y: 0.5 }), [image]);

  // A small copy (scaled off the main thread) drives the live preview, so dragging the
  // focal point stays smooth on large photos. Exports use the full-resolution image.
  const [previewSrc, setPreviewSrc] = useState<{ for: ImageBitmap; bitmap: ImageBitmap } | null>(null);
  useEffect(() => {
    if (!image) return;
    let cancelled = false;
    let made: ImageBitmap | null = null;
    const size = fitWithin(image.width, image.height, 1600);
    scaledBitmap(image.bitmap, size.width, size.height).then(
      (bitmap) => {
        if (cancelled) return bitmap.close();
        made = bitmap;
        setPreviewSrc({ for: image.bitmap, bitmap });
      },
      () => {
        // The image was replaced or closed meanwhile.
      },
    );
    return () => {
      cancelled = true;
      // Close after the next preview has been drawn from the new source.
      if (made) setTimeout(() => made?.close(), 1000);
    };
  }, [image]);

  // Live preview at reduced resolution.
  useEffect(() => {
    const c = previewRef.current;
    const src = image && previewSrc?.for === image.bitmap ? previewSrc.bitmap : null;
    if (!src || !c) return;
    const t = setTimeout(() => {
      const scale = Math.min(1, 640 / Math.max(preset.width, preset.height));
      const w = Math.round(preset.width * scale);
      const h = Math.round(preset.height * scale);
      try {
        const r = render(src, w, h, fit, focal, fill, color, flattenOn);
        c.width = w;
        c.height = h;
        c.getContext('2d')?.drawImage(r, 0, 0);
      } catch {
        // The source was released while switching images; the next render replaces it.
      }
    }, 16);
    return () => clearTimeout(t);
  }, [image, previewSrc, preset, fit, focal, fill, color, flattenOn]);

  function moveFocal(e: ReactPointerEvent<HTMLElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    setFocal({
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    });
  }

  async function exportOne(p = preset): Promise<{ name: string; blob: Blob }> {
    const c = render(image!.bitmap, p.width, p.height, fit, focal, fill, color, flattenOn);
    const blob = await encodeCanvas(c, { format, quality: quality / 100 });
    return { name: `${baseName(image!.file.name)}-${p.id}-${p.width}x${p.height}.${OUTPUT_INFO[format].ext}`, blob };
  }

  async function download() {
    setBusy(true);
    try {
      const r = await exportOne();
      downloadBlob(r.blob, r.name);
      toast(t('Saved {width}×{height} ({size})', { width: preset.width, height: preset.height, size: formatBytes(r.blob.size) }));
    } catch (e) {
      toast(errorMessage(e, t('Could not export the image.')), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function downloadAll() {
    setBusy(true);
    try {
      const files = [];
      for (const p of SOCIAL_PRESETS) files.push(await exportOne(p));
      downloadBlob(await zipBlobs(files.map((f) => ({ name: f.name, data: f.blob }))), `${baseName(image!.file.name)}-social.zip`);
    } catch (e) {
      toast(errorMessage(e, t('Could not export the images.')), 'error');
    } finally {
      setBusy(false);
    }
  }

  const tooSmall = image && fit === 'cover' && (image.width < preset.width || image.height < preset.height) && Math.max(preset.width / image.width, preset.height / image.height) > 1.25;

  return (
    <ToolStack>
      <ToolBar>
        <div className="w-full sm:w-72">
          <Label htmlFor="soc-preset">{t('Preset')}</Label>
          <Select id="soc-preset" value={preset.id} onChange={(e) => setPresetId(e.target.value)}>
            {SOCIAL_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} · {p.width}×{p.height}
              </option>
            ))}
          </Select>
        </div>
        <div className="min-w-0">
          <Label>{t('Fit')}</Label>
          <Segmented
            label={t('Fit')}
            value={fit}
            onChange={setFit}
            options={[
              { value: 'cover', label: t('Fill (crop)') },
              { value: 'contain', label: t('Fit (no crop)') },
            ]}
          />
        </div>
        {fit === 'contain' && (
          <>
            <div className="min-w-0">
              <Label>{t('Background')}</Label>
              <Segmented
                label={t('Background')}
                value={fill}
                onChange={setFill}
                options={[
                  { value: 'blur', label: t('Blurred image') },
                  { value: 'color', label: t('Color') },
                ]}
              />
            </div>
            {fill === 'color' && <ColorField label={t('Color')} value={color} onChange={setColor} />}
          </>
        )}
      </ToolBar>
      {!image && <FileDrop accept={IMAGE_ACCEPT} onFiles={(f) => void load(f[0])} icon={Share2} title={t('Drop an image to size for social media')} />}
      {loading && <Spinner label={t('Opening image…')} />}
      <ErrorMessage error={error} />
      {image && (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[1fr_300px]">
          <Panel
            title={`${preset.label} · ${preset.width}×${preset.height}`}
            description={preset.note}
            actions={<Button size="sm" variant="ghost" onClick={clear}>{t('Choose another')}</Button>}
          >
            <div className="lk-checker flex justify-center rounded-lg border border-line p-2">
              <canvas ref={previewRef} className="block h-auto max-h-[60vh] max-w-full shadow-card" role="img" aria-label={t('Preview of the {width}×{height} image', { width: preset.width, height: preset.height })} />
            </div>
            {tooSmall && (
              <p className="mt-2 text-[12.5px] text-warning">
                {t('The source ({width}×{height}) is smaller than this preset, so it will be upscaled and may look soft.', { width: image.width, height: image.height })}
              </p>
            )}
          </Panel>
          <div className="flex min-w-0 flex-col gap-4">
            {fit === 'cover' && (
              <Panel title={t('Focal point')} description={t('Drag to choose which part stays in frame')}>
                <div
                  className="relative cursor-crosshair touch-none overflow-hidden rounded-lg border border-line"
                  onPointerDown={(e) => {
                    dragging.current = true;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    moveFocal(e);
                  }}
                  onPointerMove={(e) => dragging.current && moveFocal(e)}
                  onPointerUp={() => (dragging.current = false)}
                  onKeyDown={(e) => {
                    const step = e.shiftKey ? 0.1 : 0.02;
                    const d: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
                    if (!d[e.key]) return;
                    e.preventDefault();
                    setFocal((f) => ({ x: Math.min(1, Math.max(0, f.x + d[e.key][0])), y: Math.min(1, Math.max(0, f.y + d[e.key][1])) }));
                  }}
                  tabIndex={0}
                  role="slider"
                  aria-label={t('Focal point')}
                  aria-valuetext={t('{round}% across, {round2}% down', { round: Math.round(focal.x * 100), round2: Math.round(focal.y * 100) })}
                  aria-valuenow={Math.round(focal.x * 100)}
                >
                  <img src={image.url} alt="" draggable={false} className="block w-full select-none" />
                  <span
                    className="pointer-events-none absolute size-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-accent/70 shadow-[0_0_0_1px_rgb(0_0_0/0.5)]"
                    style={{ left: `${focal.x * 100}%`, top: `${focal.y * 100}%` }}
                  />
                </div>
              </Panel>
            )}
            <Panel title={t('Export')}>
              <div className="space-y-3">
                <div className="min-w-0">
                  <Label>{t('Format')}</Label>
                  <Segmented
                    label={t('Format')}
                    value={format}
                    onChange={setFormat}
                    options={[
                      { value: 'jpeg', label: 'JPEG' },
                      { value: 'png', label: 'PNG' },
                      { value: 'webp', label: t('WebP') },
                    ]}
                  />
                </div>
                {format !== 'png' && <RangeField label={t('Quality')} value={quality} min={40} max={100} onChange={setQuality} format={(v) => `${v}%`} />}
                <Button variant="primary" icon={Download} className="w-full" loading={busy} onClick={download}>
                  {t('Download {width}×{height}', { width: preset.width, height: preset.height })}
                </Button>
                <Button icon={FileArchive} className={cn('w-full')} disabled={busy} onClick={downloadAll}>
                  {t('All {count} presets (ZIP)', { count: SOCIAL_PRESETS.length })}
                </Button>
              </div>
            </Panel>
          </div>
        </div>
      )}
    </ToolStack>
  );
}
