import { useCallback } from 'react';
import { ImageUp } from 'lucide-react';
import { ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { FileDrop } from '@/components/ui/FileDrop';
import { Label, NumberInput } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { ErrorMessage } from '@/components/ui/Alert';
import { useToolState } from '@/lib/hooks';
import { withExtension } from '@/lib/utils';
import { BatchFileList } from './components/BatchFileList';
import { ColorField, RangeField } from './components/controls';
import { useImageBatch } from './components/useImageBatch';
import { createCanvas, encodeCanvas, getContext, OUTPUT_INFO, rasterizeSvg, svgIntrinsicSize } from './lib/canvas';
import { analyzeSvg } from './lib/svg';
import { SVG_ACCEPT } from './lib/accept';
import { t } from '@/lib/i18n';

type SizeMode = 'scale' | 'width' | 'height';
type Format = 'png' | 'jpeg' | 'webp';

export default function SvgToPng() {
  const [sizeMode, setSizeMode] = useToolState<SizeMode>('svg-to-png', 'sizeMode', 'scale');
  const [scale, setScale] = useToolState('svg-to-png', 'scale', 2);
  const [target, setTarget] = useToolState<number | ''>('svg-to-png', 'target', 1024);
  const [bgMode, setBgMode] = useToolState<'transparent' | 'color'>('svg-to-png', 'bgMode', 'transparent');
  const [bg, setBg] = useToolState('svg-to-png', 'bg', '#ffffff');
  const [format, setFormat] = useToolState<Format>('svg-to-png', 'format', 'png');
  const [quality, setQuality] = useToolState('svg-to-png', 'quality', 92);

  const targetError = sizeMode !== 'scale' && (target === '' || target < 1 || target > 16384) ? 'Enter a size between 1 and 16384 px.' : null;

  const processor = useCallback(
    async (file: File) => {
      const text = await file.text();
      const info = analyzeSvg(text);
      if (!info.ok) throw new Error(info.error ?? t('This is not a valid SVG.'));
      const intrinsic = svgIntrinsicSize(text);
      const base = info.size ?? { width: intrinsic.width, height: intrinsic.height };
      let w: number;
      let h: number;
      if (sizeMode === 'scale') {
        w = base.width * scale;
        h = base.height * scale;
      } else if (sizeMode === 'width') {
        w = Number(target);
        h = (w * base.height) / base.width;
      } else {
        h = Number(target);
        w = (h * base.width) / base.height;
      }
      w = Math.max(1, Math.round(w));
      h = Math.max(1, Math.round(h));
      const bitmap = await rasterizeSvg(text, w, h);
      try {
        const c = createCanvas(w, h);
        const ctx = getContext(c);
        const fill = bgMode === 'color' || format === 'jpeg' ? bg : null;
        if (fill) {
          ctx.fillStyle = fill;
          ctx.fillRect(0, 0, w, h);
        }
        ctx.drawImage(bitmap, 0, 0);
        const blob = await encodeCanvas(c, { format, quality: quality / 100 });
        return {
          blob,
          name: withExtension(file.name, OUTPUT_INFO[format].ext),
          width: w,
          height: h,
          note: info.size ? undefined : t('No width, height or viewBox: the SVG was assumed to be 512 × 512 px before scaling.'),
          warning: !info.size,
        };
      } finally {
        bitmap.close();
      }
    },
    [sizeMode, scale, target, bgMode, bg, format, quality],
  );

  const batch = useImageBatch(processor, `${sizeMode}|${scale}|${target}|${bgMode}|${bg}|${format}|${quality}`, { enabled: !targetError });

  return (
    <ToolStack>
      <ToolBar>
        <div className="min-w-0">
          <Label>{t('Size')}</Label>
          <Segmented
            label={t('Size')}
            value={sizeMode}
            onChange={setSizeMode}
            options={[
              { value: 'scale', label: t('Scale') },
              { value: 'width', label: t('Width') },
              { value: 'height', label: t('Height') },
            ]}
          />
        </div>
        {sizeMode === 'scale' ? (
          <div className="min-w-0">
            <Label>{t('Scale factor')}</Label>
            <Segmented
              label={t('Scale factor')}
              value={String(scale)}
              onChange={(v) => setScale(Number(v))}
              options={['0.5', '1', '2', '3', '4', '8'].map((v) => ({ value: v, label: `${v}×` }))}
            />
          </div>
        ) : (
          <div className="w-32">
            <Label htmlFor="svg-target">{(sizeMode === 'width') ? t('Width (px)') : t('Height (px)')}</Label>
            <NumberInput id="svg-target" value={target} onChange={setTarget} min={1} max={16384} />
          </div>
        )}
        <div className="min-w-0">
          <Label>{t('Format')}</Label>
          <Segmented
            label={t('Format')}
            value={format}
            onChange={setFormat}
            options={[
              { value: 'png', label: 'PNG' },
              { value: 'jpeg', label: 'JPEG' },
              { value: 'webp', label: t('WebP') },
            ]}
          />
        </div>
        {format !== 'png' && <RangeField label={t('Quality')} className="w-full sm:w-44" value={quality} min={10} max={100} onChange={setQuality} format={(v) => `${v}%`} />}
        {format !== 'jpeg' && (
          <div className="min-w-0">
            <Label>{t('Background')}</Label>
            <Segmented
              label={t('Background')}
              value={bgMode}
              onChange={setBgMode}
              options={[
                { value: 'transparent', label: t('Transparent') },
                { value: 'color', label: t('Color') },
              ]}
            />
          </div>
        )}
        {(bgMode === 'color' || format === 'jpeg') && <ColorField label={t('Background color')} value={bg} onChange={setBg} />}
      </ToolBar>
      <ErrorMessage error={targetError} />
      <FileDrop
        multiple
        accept={SVG_ACCEPT}
        onFiles={batch.addFiles}
        icon={ImageUp}
        compact={batch.items.length > 0}
        title={t('Drop SVG files to convert')}
        hint={t('Rendered by your browser, never uploaded. External images and fonts referenced by URL are not loaded.')}
      />
      <BatchFileList
        items={batch.items}
        onRemove={batch.remove}
        onClear={batch.clear}
        onCancel={batch.cancel}
        onRetry={batch.retry}
        running={batch.running}
        progress={batch.progress}
        zipName={`svg-to-${format}.zip`}
        showSavings={false}
      />
    </ToolStack>
  );
}
