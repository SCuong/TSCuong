import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Download, Droplets, Wand } from 'lucide-react';
import { ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { FileDrop } from '@/components/ui/FileDrop';
import { Button } from '@/components/ui/Button';
import { ErrorMessage } from '@/components/ui/Alert';
import { Checkbox, Label } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Panel } from '@/components/ui/Panel';
import { Spinner } from '@/components/ui/Feedback';
import { toast } from '@/components/ui/Toast';
import { useToolState } from '@/lib/hooks';
import { baseName, downloadBlob, errorMessage, formatBytes } from '@/lib/utils';
import { useSingleImage } from './components/useSingleImage';
import { ColorField, RangeField } from './components/controls';
import { canvasToBlob, createCanvas, fitWithin, getContext } from './lib/canvas';
import { scaledBitmap } from './lib/pipeline';
import { flatten, guessBackground, keyColor } from './lib/chroma';
import { hexToRgb } from './lib/encoders';
import { rgbToHex } from './lib/palette';
import { IMAGE_ACCEPT } from './lib/accept';
import { t } from '@/lib/i18n';

type Mode = 'transparent' | 'replace' | 'flatten';
type Bg = 'checker' | 'light' | 'dark';

const PREVIEW_MAX = 1200;

export default function TransparencyTool() {
  const { image, error, loading, load, clear } = useSingleImage();
  const [mode, setMode] = useToolState<Mode>('image-transparency', 'mode', 'transparent');
  const [target, setTarget] = useToolState('image-transparency', 'target', '#ffffff');
  const [replacement, setReplacement] = useToolState('image-transparency', 'replacement', '#2563eb');
  const [background, setBackground] = useToolState('image-transparency', 'background', '#ffffff');
  const [tolerance, setTolerance] = useToolState('image-transparency', 'tolerance', 12);
  const [feather, setFeather] = useToolState('image-transparency', 'feather', 6);
  const [contiguous, setContiguous] = useToolState('image-transparency', 'contiguous', false);
  const [previewBg, setPreviewBg] = useState<Bg>('checker');
  const [seed, setSeed] = useState<{ x: number; y: number } | null>(null);
  const [affected, setAffected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [base, setBase] = useState<{ data: ImageData; scale: number } | null>(null);

  // Build the downscaled preview source when a new image loads (scaled off the main thread).
  useEffect(() => {
    setBase(null);
    setSeed(null);
    if (!image) return;
    let cancelled = false;
    const size = fitWithin(image.width, image.height, PREVIEW_MAX);
    scaledBitmap(image.bitmap, size.width, size.height).then(
      (small) => {
        if (cancelled) return small.close();
        const c = createCanvas(small.width, small.height);
        const ctx = getContext(c, { willReadFrequently: true });
        ctx.drawImage(small, 0, 0);
        small.close();
        const data = ctx.getImageData(0, 0, c.width, c.height);
        setBase({ data, scale: c.width / image.width });
        setTarget(rgbToHex(guessBackground(data.data, c.width, c.height)));
      },
      () => {
        // The image was replaced or closed meanwhile.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [image, setTarget]);

  function apply(data: ImageData, scale: number): number {
    if (mode === 'flatten') {
      flatten(data.data, hexToRgb(background) ?? [255, 255, 255]);
      return data.width * data.height;
    }
    return keyColor(data.data, data.width, data.height, {
      target: hexToRgb(target) ?? [255, 255, 255],
      tolerance,
      feather,
      mode,
      replacement: hexToRgb(replacement) ?? [255, 255, 255],
      contiguous,
      seed: seed ? { x: seed.x * scale, y: seed.y * scale } : { x: 0, y: 0 },
    });
  }

  // Re-render the preview when settings change.
  useEffect(() => {
    const b = base;
    const c = canvasRef.current;
    if (!b || !c) return;
    const t = setTimeout(() => {
      const copy = new ImageData(new Uint8ClampedArray(b.data.data), b.data.width, b.data.height);
      const n = apply(copy, b.scale);
      c.width = copy.width;
      c.height = copy.height;
      c.getContext('2d')?.putImageData(copy, 0, 0);
      setAffected(n / (copy.width * copy.height));
    }, 40);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, mode, target, replacement, background, tolerance, feather, contiguous, seed]);

  function onPick(e: ReactPointerEvent<HTMLCanvasElement>) {
    const b = base;
    if (!b || !image || mode === 'flatten') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = Math.floor(((e.clientX - rect.left) / rect.width) * b.data.width);
    const py = Math.floor(((e.clientY - rect.top) / rect.height) * b.data.height);
    if (px < 0 || py < 0 || px >= b.data.width || py >= b.data.height) return;
    const i = (py * b.data.width + px) * 4;
    const d = b.data.data;
    setTarget(rgbToHex([d[i], d[i + 1], d[i + 2]]));
    setSeed({ x: px / b.scale, y: py / b.scale });
  }

  async function exportPng() {
    if (!image) return;
    setBusy(true);
    try {
      const c = createCanvas(image.width, image.height);
      const ctx = getContext(c, { willReadFrequently: true });
      ctx.drawImage(image.bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, image.width, image.height);
      apply(data, 1);
      ctx.putImageData(data, 0, 0);
      const blob = await canvasToBlob(c, 'image/png');
      downloadBlob(blob, `${baseName(image.file.name)}-${mode === 'flatten' ? 'flattened' : mode === 'replace' ? 'recolored' : 'transparent'}.png`);
      toast(t('Saved PNG ({size})', { size: formatBytes(blob.size) }));
    } catch (e) {
      toast(errorMessage(e, t('Could not export the image.')), 'error');
    } finally {
      setBusy(false);
    }
  }

  const bgClass = previewBg === 'checker' ? 'lk-checker' : '';
  const bgStyle = previewBg === 'light' ? { backgroundColor: '#ffffff' } : previewBg === 'dark' ? { backgroundColor: '#0b0e14' } : undefined;

  return (
    <ToolStack>
      <ToolBar>
        <div className="min-w-0">
          <Label>{t('Action')}</Label>
          <Segmented
            label={t('Action')}
            value={mode}
            onChange={setMode}
            options={[
              { value: 'transparent', label: t('Make color transparent') },
              { value: 'replace', label: t('Replace color') },
              { value: 'flatten', label: t('Flatten onto color') },
            ]}
          />
        </div>
        {mode !== 'flatten' ? (
          <>
            <ColorField label={t('Color to change')} value={target} onChange={setTarget} />
            {mode === 'replace' && <ColorField label={t('Replace with')} value={replacement} onChange={setReplacement} />}
          </>
        ) : (
          <ColorField label={t('Background')} value={background} onChange={setBackground} />
        )}
      </ToolBar>
      {mode !== 'flatten' && (
        <ToolBar>
          <RangeField label={t('Tolerance')} className="w-full sm:w-56" value={tolerance} min={0} max={100} onChange={setTolerance} format={(v) => `${v}%`} />
          <RangeField label={t('Feather (soft edge)')} className="w-full sm:w-56" value={feather} min={0} max={50} onChange={setFeather} format={(v) => `${v}%`} />
          <Checkbox
            label={t('Only connected area')}
            description={t('Flood-fill from the point you click (default: top-left corner).')}
            checked={contiguous}
            onChange={setContiguous}
          />
          {image && base && (
            <Button
              size="sm"
              variant="ghost"
              icon={Wand}
              onClick={() => {
                const b = base;
                setTarget(rgbToHex(guessBackground(b.data.data, b.data.width, b.data.height)));
                setSeed(null);
              }}
            >
              {t('Detect background')}
            </Button>
          )}
        </ToolBar>
      )}
      {!image && <FileDrop accept={IMAGE_ACCEPT} onFiles={(f) => void load(f[0])} icon={Droplets} title={t('Drop an image')} hint={t('Remove a solid background, recolor it, or flatten transparency. Nothing is uploaded.')} />}
      {loading && <Spinner label={t('Opening image…')} />}
      <ErrorMessage error={error} />
      {image && (
        <Panel
          title={image.file.name}
          description={t('{width} × {height} px{value}', { width: image.width, height: image.height, value: affected !== null && mode !== 'flatten' ? ` · ${(affected * 100).toFixed(1)}% of pixels affected` : '' })}
          actions={
            <>
              <Segmented
                label={t('Preview background')}
                size="sm"
                value={previewBg}
                onChange={setPreviewBg}
                options={[
                  { value: 'checker', label: t('Checker') },
                  { value: 'light', label: t('White') },
                  { value: 'dark', label: t('Black') },
                ]}
              />
              <Button size="sm" variant="ghost" onClick={clear}>
                {t('Choose another')}
              </Button>
            </>
          }
        >
          <div className={`flex justify-center overflow-hidden rounded-lg border border-line ${bgClass}`} style={bgStyle}>
            <canvas
              ref={canvasRef}
              role="img"
              onPointerDown={onPick}
              className={`block h-auto max-h-[65vh] max-w-full object-contain ${mode === 'flatten' ? '' : 'cursor-crosshair'}`}
              aria-label={mode === 'flatten' ? t('Preview') : t('Preview. Click to choose the color to change.')}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12.5px] text-fg-muted">{mode === 'flatten' ? t('Transparent areas are filled with the background color.') : t('Click the image to pick the color (and the starting point for “connected area”).')}</p>
            <Button variant="primary" icon={Download} loading={busy} onClick={exportPng}>
              {t('Download PNG')}
            </Button>
          </div>
        </Panel>
      )}
    </ToolStack>
  );
}
