import { useCallback, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { FileDrop } from '@/components/ui/FileDrop';
import { Button } from '@/components/ui/Button';
import { Label, Select } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';
import { useToolState } from '@/lib/hooks';
import { cn, withExtension } from '@/lib/utils';
import { BatchFileList } from './components/BatchFileList';
import { RangeField } from './components/controls';
import { useImageBatch } from './components/useImageBatch';
import { useImagePool } from './components/useImagePool';
import { firstFrameNote, OUTPUT_INFO } from './lib/canvas';
import { DEFAULT_FILTERS, filterString, isIdentity, type FilterSettings } from './lib/filters';
import { IMAGE_ACCEPT } from './lib/accept';

type Format = 'keep' | 'png' | 'jpeg' | 'webp';

const PRESETS: Array<{ label: string; value: Partial<FilterSettings> }> = [
  { label: 'Original', value: {} },
  { label: 'Grayscale', value: { grayscale: 100 } },
  { label: 'Sepia', value: { sepia: 100 } },
  { label: 'Vintage', value: { sepia: 45, contrast: 90, saturate: 80, brightness: 105 } },
  { label: 'High contrast', value: { contrast: 150, saturate: 110 } },
  { label: 'Noir', value: { grayscale: 100, contrast: 140, brightness: 95 } },
  { label: 'Vivid', value: { saturate: 160, contrast: 110 } },
  { label: 'Invert', value: { invert: 100 } },
  { label: 'Soft blur', value: { blur: 3 } },
];

const SLIDERS: Array<{ key: keyof FilterSettings; label: string; min: number; max: number; unit: string; step?: number }> = [
  { key: 'brightness', label: 'Brightness', min: 0, max: 200, unit: '%' },
  { key: 'contrast', label: 'Contrast', min: 0, max: 200, unit: '%' },
  { key: 'saturate', label: 'Saturation', min: 0, max: 300, unit: '%' },
  { key: 'grayscale', label: 'Grayscale', min: 0, max: 100, unit: '%' },
  { key: 'sepia', label: 'Sepia', min: 0, max: 100, unit: '%' },
  { key: 'hueRotate', label: 'Hue rotate', min: -180, max: 180, unit: '°' },
  { key: 'invert', label: 'Invert', min: 0, max: 100, unit: '%' },
  { key: 'blur', label: 'Blur', min: 0, max: 20, unit: ' px', step: 0.5 },
];

export default function ImageFilters() {
  const [filters, setFilters] = useToolState<FilterSettings>('image-filters', 'filters', DEFAULT_FILTERS);
  const [format, setFormat] = useToolState<Format>('image-filters', 'format', 'keep');
  const [previewScale, setPreviewScale] = useState(1);
  const [showOriginal, setShowOriginal] = useState(false);
  const pool = useImagePool();

  const processor = useCallback(
    async (file: File, signal: AbortSignal) => {
      const r = await pool.run(file, { filters, output: { format, quality: 0.92, background: '#ffffff' } }, signal);
      const firstFrame = firstFrameNote(r.sourceAnimated, r.sourceFormat);
      return {
        blob: r.blob,
        name: withExtension(file.name, OUTPUT_INFO[r.format].ext),
        width: r.width,
        height: r.height,
        note: firstFrame,
        warning: Boolean(firstFrame),
      };
    },
    [pool, filters, format],
  );
  const batch = useImageBatch(processor, `${JSON.stringify(filters)}|${format}`);
  const preview = batch.items[0];
  const set = (key: keyof FilterSettings, v: number) => setFilters({ ...filters, [key]: v });
  const previewFilter = filterString({ ...filters, blur: filters.blur * previewScale });

  return (
    <ToolStack>
      <ToolBar>
        <div className="min-w-0">
          <Label>Presets</Label>
          <div className="flex flex-wrap gap-1">
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setFilters({ ...DEFAULT_FILTERS, ...p.value })}
                className="h-7 rounded-md border border-line bg-surface-sunken px-2 text-[12.5px] font-medium text-fg-secondary hover:bg-surface-hover hover:text-fg"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <div className="w-40">
          <Label htmlFor="flt-fmt">Output format</Label>
          <Select id="flt-fmt" value={format} onChange={(e) => setFormat(e.target.value as Format)}>
            <option value="keep">Same as input</option>
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
            <option value="webp">WebP</option>
          </Select>
        </div>
      </ToolBar>
      <div className="grid min-w-0 gap-4 lg:grid-cols-[300px_1fr]">
        <Panel title="Adjustments" actions={<Button size="sm" variant="ghost" disabled={isIdentity(filters)} onClick={() => setFilters(DEFAULT_FILTERS)}>Reset</Button>}>
          <div className="space-y-3.5">
            {SLIDERS.map((s) => (
              <RangeField
                key={s.key}
                label={s.label}
                value={filters[s.key]}
                min={s.min}
                max={s.max}
                step={s.step ?? 1}
                onChange={(v) => set(s.key, v)}
                format={(v) => `${v}${s.unit}`}
              />
            ))}
          </div>
        </Panel>
        <div className="flex min-w-0 flex-col gap-4">
          {preview ? (
            <Panel
              title="Preview"
              description={preview.file.name}
              actions={
                <Button
                  size="sm"
                  variant={showOriginal ? 'primary' : 'secondary'}
                  onPointerDown={() => setShowOriginal(true)}
                  onPointerUp={() => setShowOriginal(false)}
                  onPointerLeave={() => setShowOriginal(false)}
                  onKeyDown={(e) => (e.key === ' ' || e.key === 'Enter') && setShowOriginal(true)}
                  onKeyUp={() => setShowOriginal(false)}
                >
                  Hold to compare
                </Button>
              }
            >
              <div className="lk-checker flex justify-center overflow-hidden rounded-lg border border-line">
                <img
                  src={preview.thumbUrl}
                  alt="Filtered preview"
                  className={cn('max-h-[55vh] max-w-full object-contain')}
                  style={{ filter: showOriginal ? 'none' : previewFilter }}
                  onLoad={(e) => setPreviewScale(e.currentTarget.clientWidth / (e.currentTarget.naturalWidth || 1))}
                />
              </div>
              <p className="mt-2 font-mono text-[12px] break-all text-fg-muted">filter: {filterString(filters)};</p>
            </Panel>
          ) : null}
          <FileDrop
            multiple
            accept={IMAGE_ACCEPT}
            onFiles={batch.addFiles}
            icon={SlidersHorizontal}
            compact={batch.items.length > 0}
            title="Drop images to apply filters"
            hint="The same adjustments are applied to every image. Nothing is uploaded."
          />
          <BatchFileList
            items={batch.items}
            onRemove={batch.remove}
            onClear={batch.clear}
            onCancel={batch.cancel}
            onRetry={batch.retry}
            running={batch.running}
            progress={batch.progress}
            zipName="filtered-images.zip"
            showSavings={false}
          />
        </div>
      </div>
    </ToolStack>
  );
}
