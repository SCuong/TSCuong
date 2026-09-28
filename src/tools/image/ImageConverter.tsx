import { useCallback, useEffect, useState } from 'react';
import { Repeat } from 'lucide-react';
import { ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { FileDrop } from '@/components/ui/FileDrop';
import { Checkbox, Label } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Alert } from '@/components/ui/Alert';
import { useToolState } from '@/lib/hooks';
import { withExtension } from '@/lib/utils';
import { BatchFileList } from './components/BatchFileList';
import { ColorField, RangeField } from './components/controls';
import { useImageBatch } from './components/useImageBatch';
import { useImagePool } from './components/useImagePool';
import { canEncode, decodeImage, OUTPUT_INFO } from './lib/canvas';
import { buildIco, icoSizesFor } from './lib/favicon';
import { IMAGE_ACCEPT } from './lib/accept';

type Target = 'png' | 'jpeg' | 'webp' | 'avif' | 'bmp' | 'ico';

const LOSSY: Target[] = ['jpeg', 'webp', 'avif'];
const NO_ALPHA: Target[] = ['jpeg', 'bmp'];

export default function ImageConverter() {
  const [target, setTarget] = useToolState<Target>('image-convert', 'format', 'png');
  const [quality, setQuality] = useToolState('image-convert', 'quality', 90);
  const [background, setBackground] = useToolState('image-convert', 'background', '#ffffff');
  const [flatten, setFlatten] = useToolState('image-convert', 'flatten', false);
  const [webpOk, setWebpOk] = useState(true);
  const pool = useImagePool();

  useEffect(() => {
    void canEncode('webp').then(setWebpOk);
  }, []);

  const needsBackground = NO_ALPHA.includes(target) || flatten;

  const processor = useCallback(
    async (file: File, signal: AbortSignal) => {
      if (target === 'ico') {
        const decoded = await decodeImage(file);
        try {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
          const sizes = icoSizesFor(decoded.width, decoded.height);
          const blob = await buildIco(decoded.bitmap, sizes, { background: flatten ? background : null });
          return {
            blob,
            name: withExtension(file.name, 'ico'),
            width: Math.max(...sizes),
            height: Math.max(...sizes),
            note: `Icon sizes: ${sizes.map((s) => `${s}×${s}`).join(', ')}`,
          };
        } finally {
          decoded.bitmap.close();
        }
      }
      const r = await pool.run(
        file,
        { output: { format: target, quality: quality / 100, background, flatten: needsBackground } },
        signal,
      );
      return { blob: r.blob, name: withExtension(file.name, OUTPUT_INFO[r.format].ext), width: r.width, height: r.height };
    },
    [pool, target, quality, background, flatten, needsBackground],
  );

  const batch = useImageBatch(processor, `${target}|${quality}|${background}|${flatten}`);

  return (
    <ToolStack>
      <ToolBar>
        <div className="min-w-0">
          <Label>Convert to</Label>
          <Segmented
            label="Convert to"
            value={target}
            onChange={setTarget}
            options={[
              { value: 'png', label: 'PNG' },
              { value: 'jpeg', label: 'JPG' },
              ...(webpOk ? [{ value: 'webp' as const, label: 'WebP' }] : []),
              { value: 'avif', label: 'AVIF' },
              { value: 'bmp', label: 'BMP' },
              { value: 'ico', label: 'ICO' },
            ]}
          />
        </div>
        {LOSSY.includes(target) && (
          <RangeField
            label="Quality"
            className="w-full sm:w-56"
            value={quality}
            min={10}
            max={100}
            onChange={setQuality}
            format={(v) => `${v}%`}
          />
        )}
        {!NO_ALPHA.includes(target) && (
          <Checkbox label="Fill transparent areas" checked={flatten} onChange={setFlatten} className="pb-1.5" />
        )}
        {needsBackground && <ColorField label="Background" value={background} onChange={setBackground} />}
      </ToolBar>
      {NO_ALPHA.includes(target) && (
        <p className="-mt-1 text-[12.5px] text-fg-muted">
          {OUTPUT_INFO[target as 'jpeg' | 'bmp'].label} has no transparency, so transparent pixels are filled with the background color.
        </p>
      )}
      {target === 'ico' && (
        <p className="-mt-1 text-[12.5px] text-fg-muted">
          ICO files contain 16, 32 and 48 px icons plus 64, 128 and 256 px when the source is large enough. Non-square images are centered.
        </p>
      )}
      {!webpOk && <Alert tone="warning">This browser cannot encode WebP, so that option is hidden.</Alert>}
      <FileDrop
        multiple
        accept={IMAGE_ACCEPT}
        onFiles={batch.addFiles}
        icon={Repeat}
        compact={batch.items.length > 0}
        title="Drop images to convert"
        hint="Reads PNG, JPEG, WebP, AVIF, GIF, BMP, ICO and SVG. HEIC is not supported. Nothing is uploaded."
      />
      <BatchFileList
        items={batch.items}
        onRemove={batch.remove}
        onClear={batch.clear}
        onCancel={batch.cancel}
        onRetry={batch.retry}
        running={batch.running}
        progress={batch.progress}
        zipName={`converted-${target}.zip`}
      />
    </ToolStack>
  );
}
