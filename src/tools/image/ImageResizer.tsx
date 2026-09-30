import { useCallback, useEffect, useState } from 'react';
import { Link2, Link2Off, Scaling } from 'lucide-react';
import { ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { FileDrop } from '@/components/ui/FileDrop';
import { Checkbox, Label, NumberInput, Select } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { IconButton } from '@/components/ui/Button';
import { ErrorMessage } from '@/components/ui/Alert';
import { useToolState } from '@/lib/hooks';
import { withExtension } from '@/lib/utils';
import { BatchFileList } from './components/BatchFileList';
import { RangeField } from './components/controls';
import { useImageBatch } from './components/useImageBatch';
import { useImagePool } from './components/useImagePool';
import { firstFrameNote, joinNotes, OUTPUT_INFO, readHeader } from './lib/canvas';
import { computeResize, type ResizeSpec } from './lib/geometry';
import { IMAGE_ACCEPT } from './lib/accept';
import { t } from '@/lib/i18n';

type Mode = 'percent' | 'exact' | 'fit' | 'width' | 'height';
type Format = 'keep' | 'png' | 'jpeg' | 'webp';

const PRESETS: Array<{ label: string; mode: Mode; w?: number; h?: number; pct?: number }> = [
  { label: '50%', mode: 'percent', pct: 50 },
  { label: '25%', mode: 'percent', pct: 25 },
  { label: '4K (3840)', mode: 'fit', w: 3840, h: 3840 },
  { label: t('Full HD (1920)'), mode: 'fit', w: 1920, h: 1920 },
  { label: 'HD (1280)', mode: 'fit', w: 1280, h: 1280 },
  { label: t('Web (1024)'), mode: 'fit', w: 1024, h: 1024 },
  { label: t('Square 1080'), mode: 'exact', w: 1080, h: 1080 },
  { label: t('Thumbnail (320)'), mode: 'fit', w: 320, h: 320 },
];

export default function ImageResizer() {
  const [mode, setMode] = useToolState<Mode>('image-resize', 'mode', 'fit');
  const [percent, setPercent] = useToolState<number | ''>('image-resize', 'percent', 50);
  const [width, setWidth] = useToolState<number | ''>('image-resize', 'width', 1920);
  const [height, setHeight] = useToolState<number | ''>('image-resize', 'height', 1080);
  const [lock, setLock] = useToolState('image-resize', 'lock', true);
  const [noUpscale, setNoUpscale] = useToolState('image-resize', 'noUpscale', true);
  const [format, setFormat] = useToolState<Format>('image-resize', 'format', 'keep');
  const [quality, setQuality] = useToolState('image-resize', 'quality', 90);
  const [firstRatio, setFirstRatio] = useState<number | null>(null);
  const pool = useImagePool();

  const spec: ResizeSpec = {
    mode,
    percent: percent === '' ? undefined : percent,
    width: width === '' ? undefined : width,
    height: height === '' ? undefined : height,
    noUpscale,
  };

  let specError: string | null = null;
  try {
    computeResize({ width: 1000, height: 1000 }, spec);
    if (mode === 'percent' && typeof percent === 'number' && percent > 1000) specError = 'Use a percentage of 1000% or less.';
  } catch (e) {
    specError = (e as Error).message;
  }

  const processor = useCallback(
    async (file: File, signal: AbortSignal) => {
      const r = await pool.run(file, { resize: spec, output: { format, quality: quality / 100, background: '#ffffff' } }, signal);
      const upscaleSkipped =
        noUpscale && r.width === r.sourceWidth && r.height === r.sourceHeight && mode !== 'exact'
          ? 'Already within the target size, so it keeps its original dimensions.'
          : undefined;
      const firstFrame = firstFrameNote(r.sourceAnimated, r.sourceFormat);
      return {
        blob: r.blob,
        name: withExtension(file.name, OUTPUT_INFO[r.format].ext),
        width: r.width,
        height: r.height,
        sourceWidth: r.sourceWidth,
        sourceHeight: r.sourceHeight,
        note: joinNotes(upscaleSkipped, firstFrame),
        warning: Boolean(firstFrame),
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pool, JSON.stringify(spec), format, quality, noUpscale, mode],
  );

  const batch = useImageBatch(processor, `${JSON.stringify(spec)}|${format}|${quality}`, { enabled: !specError });

  // Remember the first image's aspect ratio for the aspect lock.
  const first = batch.items[0]?.file;
  useEffect(() => {
    if (!first) return setFirstRatio(null);
    let cancelled = false;
    void readHeader(first).then((h) => {
      if (!cancelled && h?.width && h.height) setFirstRatio(h.width / h.height);
    });
    return () => {
      cancelled = true;
    };
  }, [first]);

  const ratio = firstRatio ?? (typeof width === 'number' && typeof height === 'number' && height > 0 ? width / height : 1);

  // With the aspect lock on, the height follows the first image's shape as soon as it is
  // known (otherwise the lock would show "locked" while the output is stretched).
  const lockActive = lock && mode === 'exact';
  const [syncedRatio, setSyncedRatio] = useState<number | null>(null);
  if (!lockActive || !firstRatio) {
    if (syncedRatio !== null) setSyncedRatio(null);
  } else if (firstRatio !== syncedRatio && typeof width === 'number') {
    setSyncedRatio(firstRatio);
    setHeight(Math.max(1, Math.round(width / firstRatio)));
  }

  function changeWidth(v: number | '') {
    setWidth(v);
    if (lock && mode === 'exact' && typeof v === 'number') setHeight(Math.max(1, Math.round(v / ratio)));
  }
  function changeHeight(v: number | '') {
    setHeight(v);
    if (lock && mode === 'exact' && typeof v === 'number') setWidth(Math.max(1, Math.round(v * ratio)));
  }

  const showW = mode === 'exact' || mode === 'fit' || mode === 'width';
  const showH = mode === 'exact' || mode === 'fit' || mode === 'height';

  return (
    <ToolStack>
      <ToolBar>
        <div className="min-w-0">
          <Label>{t('Resize by')}</Label>
          <Segmented
            label={t('Resize by')}
            value={mode}
            onChange={setMode}
            options={[
              { value: 'fit', label: t('Fit within') },
              { value: 'exact', label: t('Exact size') },
              { value: 'percent', label: t('Percent') },
              { value: 'width', label: t('Width') },
              { value: 'height', label: t('Height') },
            ]}
          />
        </div>
        {mode === 'percent' && (
          <div className="w-28">
            <Label htmlFor="rs-pct">{t('Percent')}</Label>
            <NumberInput id="rs-pct" value={percent} onChange={setPercent} min={1} max={1000} />
          </div>
        )}
        {(showW || showH) && (
          <div className="flex items-end gap-2">
            {showW && (
              <div className="w-28">
                <Label htmlFor="rs-w">{(mode === 'fit') ? t('Max width (px)') : t('Width (px)')}</Label>
                <NumberInput id="rs-w" value={width} onChange={changeWidth} min={1} max={32767} />
              </div>
            )}
            {mode === 'exact' && (
              <IconButton
                icon={lock ? Link2 : Link2Off}
                label={lock ? t('Aspect ratio locked') : t('Aspect ratio unlocked')}
                active={lock}
                variant="secondary"
                onClick={() => setLock(!lock)}
                aria-pressed={lock}
                className="mb-0.5"
              />
            )}
            {showH && (
              <div className="w-28">
                <Label htmlFor="rs-h">{(mode === 'fit') ? t('Max height (px)') : t('Height (px)')}</Label>
                <NumberInput id="rs-h" value={height} onChange={changeHeight} min={1} max={32767} />
              </div>
            )}
          </div>
        )}
        {mode !== 'exact' && <Checkbox label={t('Don\'t enlarge')} checked={noUpscale} onChange={setNoUpscale} className="pb-1.5" />}
      </ToolBar>
      <ToolBar>
        <div className="w-40">
          <Label htmlFor="rs-fmt">{t('Output format')}</Label>
          <Select id="rs-fmt" value={format} onChange={(e) => setFormat(e.target.value as Format)}>
            <option value="keep">{t('Same as input')}</option>
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
            <option value="webp">{t('WebP')}</option>
          </Select>
        </div>
        <RangeField label={t('Quality (JPEG/WebP)')} className="w-full sm:w-56" value={quality} min={10} max={100} onChange={setQuality} format={(v) => `${v}%`} />
        <div className="min-w-0">
          <Label>{t('Presets')}</Label>
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => {
                  setMode(p.mode);
                  if (p.pct) setPercent(p.pct);
                  if (p.w) setWidth(p.w);
                  if (p.h) setHeight(p.h);
                  if (p.mode === 'exact') setLock(false);
                }}
                className="h-7 rounded-md border border-line bg-surface-sunken px-2 text-[12.5px] font-medium text-fg-secondary hover:bg-surface-hover hover:text-fg"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </ToolBar>
      <ErrorMessage error={specError} />
      {mode === 'exact' && lock && batch.items.length > 1 && (
        <p className="-mt-1 text-[12.5px] text-fg-muted">
          {t('The aspect lock follows the first image. Images with a different shape are stretched to the exact size; use “Fit within” to keep every image’s proportions.')}
        </p>
      )}
      <FileDrop
        multiple
        accept={IMAGE_ACCEPT}
        onFiles={batch.addFiles}
        icon={Scaling}
        compact={batch.items.length > 0}
        title={t('Drop images to resize')}
        hint={t('High-quality downscaling in your browser. Nothing is uploaded.')}
      />
      <BatchFileList
        items={batch.items}
        onRemove={batch.remove}
        onClear={batch.clear}
        onCancel={batch.cancel}
        onRetry={batch.retry}
        running={batch.running}
        progress={batch.progress}
        zipName="resized-images.zip"
      />
    </ToolStack>
  );
}
