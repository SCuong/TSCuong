import { useCallback } from 'react';
import { ArrowLeftRight, ArrowUpDown, RotateCcw, RotateCw } from 'lucide-react';
import { ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { FileDrop } from '@/components/ui/FileDrop';
import { Label, NumberInput, Select } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { useToolState } from '@/lib/hooks';
import { withExtension } from '@/lib/utils';
import { BatchFileList } from './components/BatchFileList';
import { ColorField, RangeField } from './components/controls';
import { useImageBatch } from './components/useImageBatch';
import { useImagePool } from './components/useImagePool';
import { firstFrameNote, joinNotes, OUTPUT_INFO } from './lib/canvas';
import { rotateFlipCss } from './lib/geometry';
import { IMAGE_ACCEPT } from './lib/accept';

type Format = 'keep' | 'png' | 'jpeg' | 'webp';

const norm = (a: number) => {
  let v = ((a % 360) + 360) % 360;
  if (v > 180) v -= 360;
  return Math.round(v * 10) / 10;
};

export default function ImageRotate() {
  const [angle, setAngle] = useToolState('image-rotate', 'angle', 90);
  const [flipH, setFlipH] = useToolState('image-rotate', 'flipH', false);
  const [flipV, setFlipV] = useToolState('image-rotate', 'flipV', false);
  const [fillMode, setFillMode] = useToolState<'transparent' | 'color'>('image-rotate', 'fillMode', 'transparent');
  const [fill, setFill] = useToolState('image-rotate', 'fill', '#ffffff');
  const [format, setFormat] = useToolState<Format>('image-rotate', 'format', 'keep');
  const pool = useImagePool();

  const rightAngle = angle % 90 === 0;
  const processor = useCallback(
    async (file: File, signal: AbortSignal) => {
      const r = await pool.run(
        file,
        {
          rotate: angle,
          flipH,
          flipV,
          rotateFill: fillMode === 'color' ? fill : null,
          output: { format, quality: 0.92, background: fillMode === 'color' ? fill : '#ffffff' },
        },
        signal,
      );
      return {
        blob: r.blob,
        name: withExtension(file.name, OUTPUT_INFO[r.format].ext),
        width: r.width,
        height: r.height,
        sourceWidth: r.sourceWidth,
        sourceHeight: r.sourceHeight,
        note: joinNotes(
          !rightAngle && fillMode === 'transparent' && !OUTPUT_INFO[r.format].alpha
            ? `${OUTPUT_INFO[r.format].label} has no transparency: corners were filled with white. Choose PNG or WebP to keep them transparent.`
            : undefined,
          firstFrameNote(r.sourceAnimated, r.sourceFormat),
        ),
        warning: r.sourceAnimated,
      };
    },
    [pool, angle, flipH, flipV, fillMode, fill, format, rightAngle],
  );
  const batch = useImageBatch(processor, `${angle}|${flipH}|${flipV}|${fillMode}|${fill}|${format}`);
  const preview = batch.items[0];

  return (
    <ToolStack>
      <ToolBar>
        <div>
          <Label>Rotate</Label>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" icon={RotateCcw} onClick={() => setAngle(norm(angle - 90))}>
              Left 90°
            </Button>
            <Button size="sm" icon={RotateCw} onClick={() => setAngle(norm(angle + 90))}>
              Right 90°
            </Button>
            <Button size="sm" onClick={() => setAngle(norm(angle + 180))}>
              180°
            </Button>
          </div>
        </div>
        <RangeField label="Angle" className="w-full sm:w-64" value={angle} min={-180} max={180} step={0.5} onChange={(v) => setAngle(norm(v))} format={(v) => `${v}°`} />
        <div className="w-24">
          <Label htmlFor="rot-angle">Degrees</Label>
          <NumberInput id="rot-angle" value={angle} onChange={(v) => setAngle(v === '' ? 0 : norm(v))} step={0.5} />
        </div>
        <div>
          <Label>Flip</Label>
          <div className="flex gap-1.5">
            <Button size="sm" icon={ArrowLeftRight} aria-pressed={flipH} variant={flipH ? 'primary' : 'secondary'} onClick={() => setFlipH(!flipH)}>
              Horizontal
            </Button>
            <Button size="sm" icon={ArrowUpDown} aria-pressed={flipV} variant={flipV ? 'primary' : 'secondary'} onClick={() => setFlipV(!flipV)}>
              Vertical
            </Button>
          </div>
        </div>
      </ToolBar>
      <ToolBar>
        <div className="min-w-0">
          <Label>Corner fill (angled rotation)</Label>
          <Segmented
            label="Corner fill"
            value={fillMode}
            onChange={setFillMode}
            options={[
              { value: 'transparent', label: 'Transparent' },
              { value: 'color', label: 'Color' },
            ]}
          />
        </div>
        {fillMode === 'color' && <ColorField label="Fill color" value={fill} onChange={setFill} />}
        <div className="w-40">
          <Label htmlFor="rot-fmt">Output format</Label>
          <Select id="rot-fmt" value={format} onChange={(e) => setFormat(e.target.value as Format)}>
            <option value="keep">Same as input</option>
            <option value="png">PNG</option>
            <option value="jpeg">JPEG</option>
            <option value="webp">WebP</option>
          </Select>
        </div>
        <Button size="sm" variant="ghost" className="mb-0.5" onClick={() => { setAngle(0); setFlipH(false); setFlipV(false); }}>
          Reset
        </Button>
      </ToolBar>
      <FileDrop multiple accept={IMAGE_ACCEPT} onFiles={batch.addFiles} icon={RotateCw} compact={batch.items.length > 0} title="Drop images to rotate or flip" />
      {preview && (
        <Panel title="Preview" description={`${preview.file.name} · the same transform is applied to every file`}>
          <div className="lk-checker flex h-72 items-center justify-center overflow-hidden rounded-lg border border-line sm:h-80">
            <img
              src={preview.thumbUrl}
              alt="Preview of the rotation"
              className="max-h-[60%] max-w-[60%] transition-transform duration-200"
              style={{ transform: rotateFlipCss(angle, flipH, flipV) }}
            />
          </div>
        </Panel>
      )}
      <BatchFileList
        items={batch.items}
        onRemove={batch.remove}
        onClear={batch.clear}
        onCancel={batch.cancel}
        onRetry={batch.retry}
        running={batch.running}
        progress={batch.progress}
        zipName="rotated-images.zip"
        showSavings={false}
      />
    </ToolStack>
  );
}
