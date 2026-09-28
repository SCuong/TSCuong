import { useCallback, useMemo, useState } from 'react';
import { Columns2, ImagePlus } from 'lucide-react';
import { ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { FileDrop } from '@/components/ui/FileDrop';
import { Checkbox, Label, Select } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { Alert } from '@/components/ui/Alert';
import { useObjectUrl, useToolState } from '@/lib/hooks';
import { formatBytes, withExtension } from '@/lib/utils';
import { BatchFileList, savingsPercent } from './components/BatchFileList';
import { CompareSlider } from './components/CompareSlider';
import { RangeField } from './components/controls';
import { useImageBatch, type BatchItem } from './components/useImageBatch';
import { useImagePool } from './components/useImagePool';
import { OUTPUT_INFO, readHeader, type OutputFormat } from './lib/canvas';
import { IMAGE_ACCEPT } from './lib/accept';

type Target = 'keep' | 'jpeg' | 'webp' | 'avif' | 'png-lossy';

const MAX_DIMS = ['0', '3840', '2560', '1920', '1280', '800'] as const;

/** For compression, "keep" re-encodes lossy formats and quantizes PNG-like ones. */
function compressFormat(target: Target, source: string | undefined): OutputFormat {
  if (target !== 'keep') return target;
  if (source === 'jpeg' || source === 'webp' || source === 'avif') return source;
  return 'png-lossy';
}

export default function ImageCompressor() {
  const [quality, setQuality] = useToolState('image-compress', 'quality', 75);
  const [target, setTarget] = useToolState<Target>('image-compress', 'format', 'keep');
  const [maxDim, setMaxDim] = useToolState<string>('image-compress', 'maxDim', '0');
  const [keepOriginal, setKeepOriginal] = useToolState('image-compress', 'keepOriginal', true);
  const [compareId, setCompareId] = useState<string | null>(null);
  const pool = useImagePool();

  const processor = useCallback(
    async (file: File, signal: AbortSignal) => {
      const header = await readHeader(file);
      const format = compressFormat(target, header?.format);
      const r = await pool.run(
        file,
        { maxDimension: Number(maxDim) || null, output: { format, quality: quality / 100, background: '#ffffff' } },
        signal,
      );
      const name = withExtension(file.name, OUTPUT_INFO[r.format].ext);
      const base = { width: r.width, height: r.height, sourceWidth: r.sourceWidth, sourceHeight: r.sourceHeight };
      if (r.blob.size >= file.size) {
        const larger = `${Math.abs(savingsPercent(file.size, r.blob.size)).toFixed(1)}% larger`;
        if (keepOriginal) {
          return {
            ...base,
            blob: file,
            name: file.name,
            width: r.sourceWidth,
            height: r.sourceHeight,
            note: `Original kept: the compressed version was ${larger} (${formatBytes(r.blob.size)}).`,
            warning: true,
          };
        }
        return { ...base, blob: r.blob, name, note: `The output is ${larger} than the original.`, warning: true };
      }
      return { ...base, blob: r.blob, name };
    },
    [pool, target, quality, maxDim, keepOriginal],
  );

  const settingsKey = `${target}|${quality}|${maxDim}|${keepOriginal}`;
  const batch = useImageBatch(processor, settingsKey);
  const compareItem = useMemo(
    () => batch.items.find((it) => it.id === compareId && it.output) ?? batch.items.find((it) => it.output),
    [batch.items, compareId],
  );
  const compareUrl = useObjectUrl(compareItem?.output?.blob);

  const pngNote = target === 'png-lossy' || target === 'keep';

  return (
    <ToolStack>
      <ToolBar>
        <div className="min-w-0">
          <Label>Output format</Label>
          <Segmented
            label="Output format"
            value={target}
            onChange={setTarget}
            options={[
              { value: 'keep', label: 'Same as input' },
              { value: 'jpeg', label: 'JPEG' },
              { value: 'webp', label: 'WebP' },
              { value: 'avif', label: 'AVIF' },
              { value: 'png-lossy', label: 'PNG (lossy)' },
            ]}
          />
        </div>
        <RangeField
          label="Quality"
          className="w-full sm:w-56"
          value={quality}
          min={10}
          max={100}
          onChange={setQuality}
          format={(v) => `${v}%`}
        />
        <div className="w-40">
          <Label htmlFor="cmp-max">Max dimension</Label>
          <Select id="cmp-max" value={maxDim} onChange={(e) => setMaxDim(e.target.value)}>
            {MAX_DIMS.map((d) => (
              <option key={d} value={d}>
                {d === '0' ? 'Original size' : `${d} px`}
              </option>
            ))}
          </Select>
        </div>
        <Checkbox label="Keep original when the result is larger" checked={keepOriginal} onChange={setKeepOriginal} className="pb-1.5" />
      </ToolBar>
      {pngNote && (
        <p className="-mt-1 text-[12.5px] text-fg-muted">
          {target === 'keep'
            ? 'JPEG, WebP and AVIF are re-encoded at the chosen quality. PNG, GIF and BMP become lossy PNG: fewer colors (quality sets the palette size, 8–256) with transparency kept.'
            : 'Lossy PNG reduces the number of colors (quality sets the palette size, 8–256) and keeps transparency.'}
        </p>
      )}
      {target === 'avif' && (
        <Alert tone="info">AVIF encoding is slow in the browser (a WebAssembly encoder is used when needed). Large photos can take several seconds each.</Alert>
      )}
      <FileDrop
        multiple
        accept={IMAGE_ACCEPT}
        onFiles={batch.addFiles}
        icon={ImagePlus}
        compact={batch.items.length > 0}
        title="Drop images to compress"
        hint="JPEG, PNG, WebP, AVIF, GIF (first frame) or BMP. Processed on this device, never uploaded."
      />
      <BatchFileList
        items={batch.items}
        onRemove={batch.remove}
        onClear={batch.clear}
        onCancel={batch.cancel}
        onRetry={batch.retry}
        running={batch.running}
        progress={batch.progress}
        zipName="compressed-images.zip"
        extra={(it: BatchItem) =>
          it.output && it.output.blob !== it.file ? (
            <button
              type="button"
              onClick={() => setCompareId(it.id)}
              className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-accent-text hover:underline"
            >
              <Columns2 size={12} aria-hidden /> Compare
            </button>
          ) : null
        }
      />
      {compareItem?.output && compareUrl && compareItem.output.blob !== compareItem.file && (
        <Panel
          title="Before / after"
          description={`${compareItem.file.name}: ${formatBytes(compareItem.file.size)} → ${formatBytes(compareItem.output.blob.size)}`}
          actions={
            <Button size="sm" variant="ghost" onClick={() => setCompareId(null)}>
              First file
            </Button>
          }
        >
          <CompareSlider
            before={compareItem.thumbUrl}
            after={compareUrl}
            afterLabel="Compressed"
            width={compareItem.output.width ?? 4}
            height={compareItem.output.height ?? 3}
          />
          <p className="mt-2 text-center text-[12.5px] text-fg-muted">Drag the handle or use the arrow keys to compare. Zoom in with your browser for detail.</p>
        </Panel>
      )}
    </ToolStack>
  );
}
