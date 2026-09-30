import { useEffect, useId, useMemo, useState } from 'react';
import { ImageIcon, Stamp, Type, X } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { ErrorMessage } from '@/components/ui/Alert';
import { Button, IconButton } from '@/components/ui/Button';
import { FileDrop } from '@/components/ui/FileDrop';
import { Checkbox, Input, Label, NumberInput } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { useObjectUrl } from '@/lib/hooks';
import { cn } from '@/lib/utils';
import { anchorCenter, rotatedBounds, tileCenters, type Position } from './lib/geometry';
import { hexToRgb01 } from './lib/color';
import { prepareImage, type PreparedImage } from './lib/imagePrep';
import { toPdfError, unsupportedCharacterMessage } from './lib/errors';
import { unsupportedCharacters } from './lib/winansi';
import { outputName, pdfBlob, type OutputFile } from './lib/files';
import { runPdfOp } from './lib/runner';
import { docId } from './lib/thumbnails';
import { PdfInput, useEncryptionGate } from './components/PdfInput';
import { usePdfFile, type LoadedPdf } from './components/usePdfFile';
import { PageScopeControl, usePageScope } from './components/PageScope';
import { PreviewPage } from './components/PreviewPage';
import { JobProgress, ResultFiles } from './components/Results';
import { usePdfJob } from './components/usePdfJob';
import { useKeyedResult } from './components/useKeyedResult';
import { PositionGrid } from './components/PositionGrid';
import { t } from '@/lib/i18n';

const POSITIONS: Array<{ value: Position; label: string }> = [
  { value: 'top-left', label: t('Top left') },
  { value: 'top-center', label: t('Top center') },
  { value: 'top-right', label: t('Top right') },
  { value: 'middle-left', label: t('Middle left') },
  { value: 'center', label: t('Center') },
  { value: 'middle-right', label: t('Middle right') },
  { value: 'bottom-left', label: t('Bottom left') },
  { value: 'bottom-center', label: t('Bottom center') },
  { value: 'bottom-right', label: t('Bottom right') },
];

let measureCtx: CanvasRenderingContext2D | null = null;
function measure(text: string, size: number, bold: boolean): number {
  measureCtx ??= document.createElement('canvas').getContext('2d');
  if (!measureCtx) return text.length * size * 0.55;
  measureCtx.font = `${bold ? 'bold ' : ''}${size}px Helvetica, Arial, sans-serif`;
  return measureCtx.measureText(text).width;
}

export default function AddWatermark() {
  const controller = usePdfFile();
  return (
    <ToolStack>
      <PdfInput controller={controller} title={t('Drop a PDF to watermark')}>
        {(pdf) => <WatermarkWorkspace key={docId(pdf.doc)} pdf={pdf} />}
      </PdfInput>
    </ToolStack>
  );
}

function WatermarkWorkspace({ pdf }: { pdf: LoadedPdf }) {
  const scope = usePageScope(pdf.pageCount, 'all');
  const [kind, setKind] = useState<'text' | 'image'>('text');
  const [text, setText] = useState('CONFIDENTIAL');
  const [fontSize, setFontSize] = useState<number | ''>(48);
  const [bold, setBold] = useState(true);
  const [color, setColor] = useState('#d12a2a');
  const [opacity, setOpacity] = useState(0.25);
  const [angle, setAngle] = useState(45);
  const [position, setPosition] = useState<Position>('center');
  const [tile, setTile] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [imageScale, setImageScale] = useState(0.4);
  const job = usePdfJob();
  const gate = useEncryptionGate(pdf, 'draw');
  const imageUrl = useObjectUrl(imageFile);
  const ids = { text: useId(), size: useId(), color: useId(), opacity: useId(), angle: useId(), scale: useId() };

  useEffect(() => {
    if (!imageFile) {
      setImage(null);
      return;
    }
    let alive = true;
    setImageError(null);
    prepareImage(imageFile)
      .then((img) => alive && setImage(img))
      .catch((e) => {
        if (!alive) return;
        setImage(null);
        setImageError(toPdfError(e).message);
      });
    return () => {
      alive = false;
    };
  }, [imageFile]);

  const margin = 36;
  const unsupported = unsupportedCharacters(text);
  const errors = [
    kind === 'text' && !text.trim() ? 'Enter the watermark text.' : null,
    kind === 'text' && unsupported.length ? unsupportedCharacterMessage(unsupported) : null,
    kind === 'text' && (fontSize === '' || fontSize < 4 || fontSize > 400) ? 'Font size must be between 4 and 400 pt.' : null,
    kind === 'image' && !image ? (imageError ?? 'Choose an image for the watermark.') : null,
  ].filter(Boolean) as string[];

  const previewPage = scope.pages[0];
  const inputKey = JSON.stringify([
    kind,
    kind === 'text' ? [text, fontSize, bold, color] : [imageFile?.name, imageFile?.size, imageFile?.lastModified, imageScale],
    opacity,
    angle,
    tile ? 'tile' : position,
    scope.pages,
  ]);
  const result = useKeyedResult<OutputFile>(inputKey);

  async function run() {
    const key = inputKey;
    result.clear();
    const mark =
      kind === 'text'
        ? { kind: 'text' as const, text, fontSize: Number(fontSize), color: hexToRgb01(color), bold }
        : { kind: 'image' as const, bytes: image!.bytes, format: image!.format, scale: imageScale };
    const bytes = await job.run(({ signal, progress }) =>
      runPdfOp(
        'addWatermark',
        { bytes: pdf.bytes, pages: scope.pages, mark, opacity, angle, position, tile, margin, ignoreEncryption: gate.ignoreEncryption },
        { signal, onProgress: progress },
      ),
    );
    if (bytes) result.set(key, { name: outputName(pdf.file.name, 'watermarked'), data: pdfBlob(bytes), type: 'application/pdf' });
  }

  return (
    <>
      {gate.notice}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Panel title={t('Watermark')}>
          <div className="flex flex-col gap-4">
            <Segmented
              className="self-start"
              label={t('Watermark type')}
              value={kind}
              onChange={setKind}
              options={[
                { value: 'text', label: t('Text'), icon: Type },
                { value: 'image', label: t('Image'), icon: ImageIcon },
              ]}
            />
            {kind === 'text' ? (
              <>
                <div>
                  <Label htmlFor={ids.text}>{t('Text')}</Label>
                  <Input id={ids.text} value={text} maxLength={200} onChange={(e) => setText(e.target.value)} />
                  <p className="mt-1.5 text-[12.5px] text-fg-muted">{t('Uses the standard Helvetica font: Latin letters, digits and common symbols.')}</p>
                </div>
                <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <div>
                    <Label htmlFor={ids.size}>{t('Font size (pt)')}</Label>
                    <NumberInput id={ids.size} min={4} max={400} value={fontSize} onChange={setFontSize} />
                  </div>
                  <div>
                    <Label htmlFor={ids.color}>{t('Color')}</Label>
                    <input
                      id={ids.color}
                      type="color"
                      value={color}
                      onChange={(e) => setColor(e.target.value)}
                      className="h-9 w-full cursor-pointer rounded-lg border border-line-strong bg-surface-sunken p-1"
                    />
                  </div>
                  <Checkbox label={t('Bold')} checked={bold} onChange={setBold} className="self-end pb-2" />
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-3">
                {imageFile ? (
                  <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-sunken p-2">
                    <div className="lk-checker flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-md border border-line">
                      {imageUrl && <img src={imageUrl} alt="" className="max-h-full max-w-full object-contain" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium text-fg">{imageFile.name}</p>
                      <p className="text-[12.5px] text-fg-muted">{image ? t('{width} × {height} px', { width: image.width, height: image.height }) : imageError ? t('Unreadable') : t('Reading…')}</p>
                    </div>
                    <IconButton icon={X} label={t('Remove image')} size="sm" onClick={() => setImageFile(null)} />
                  </div>
                ) : (
                  <FileDrop
                    compact
                    accept="image/png,image/jpeg,image/webp,image/gif,image/avif,.png,.jpg,.jpeg,.webp,.gif,.avif"
                    onFiles={(files) => setImageFile(files[0])}
                    icon={ImageIcon}
                    title={t('Drop a logo or image')}
                    hint={t('PNG with transparency works best.')}
                  />
                )}
                <div>
                  <Label htmlFor={ids.scale}>{t('Width: {round}% of the page', { round: Math.round(imageScale * 100) })}</Label>
                  <input
                    id={ids.scale}
                    type="range"
                    className="lk-range"
                    min={0.05}
                    max={1}
                    step={0.05}
                    value={imageScale}
                    onChange={(e) => setImageScale(Number(e.target.value))}
                  />
                </div>
              </div>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor={ids.opacity}>{t('Opacity: {round}%', { round: Math.round(opacity * 100) })}</Label>
                <input
                  id={ids.opacity}
                  type="range"
                  className="lk-range"
                  min={0.05}
                  max={1}
                  step={0.05}
                  value={opacity}
                  onChange={(e) => setOpacity(Number(e.target.value))}
                />
              </div>
              <div>
                <Label htmlFor={ids.angle}>{t('Rotation: {angle}°', { angle })}</Label>
                <input
                  id={ids.angle}
                  type="range"
                  className="lk-range"
                  min={-90}
                  max={90}
                  step={5}
                  value={angle}
                  onChange={(e) => setAngle(Number(e.target.value))}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
              <div>
                <Label>{t('Position')}</Label>
                <PositionGrid
                  label={t('Position')}
                  value={position}
                  onChange={setPosition}
                  options={POSITIONS}
                  disabled={tile}
                  className="w-32 gap-1"
                  cellClassName={() => 'h-8 justify-center rounded-md'}
                  indicator={(selected) => <span className={cn('size-2 rounded-full', selected ? 'bg-accent' : 'bg-fg-muted/50')} />}
                />
              </div>
              <Checkbox
                label={t('Tile across the page')}
                description={t('Repeat the watermark in a staggered grid.')}
                checked={tile}
                onChange={setTile}
                className="pt-6"
              />
            </div>
            <PageScopeControl scope={scope} modes={['all', 'range']} />
            {errors.map((e) => (
              <ErrorMessage key={e} error={e} />
            ))}
            <div className="border-t border-line pt-4">
              <Button
                variant="primary"
                icon={Stamp}
                disabled={!gate.ok || errors.length > 0 || scope.pages.length === 0 || Boolean(scope.error) || job.running}
                loading={job.running}
                onClick={() => void run()}
              >
                {t('Add watermark')}
              </Button>
            </div>
          </div>
        </Panel>
        <Panel title={t('Preview')} description={previewPage !== undefined ? t('Page {previewPage}', { previewPage: previewPage + 1 }) : undefined} className="h-fit">
          {previewPage !== undefined ? (
            <div className="flex justify-center">
              <PreviewPage doc={pdf.doc} pageIndex={previewPage} width={300}>
                {(g) => (
                  <WatermarkOverlay
                    geometry={g}
                    kind={kind}
                    text={text}
                    fontSize={Number(fontSize) || 0}
                    bold={bold}
                    color={color}
                    opacity={opacity}
                    angle={angle}
                    position={position}
                    tile={tile}
                    margin={margin}
                    imageUrl={imageUrl}
                    image={image}
                    imageScale={imageScale}
                  />
                )}
              </PreviewPage>
            </div>
          ) : (
            <p className="text-[13px] text-fg-muted">{t('Select pages to see a preview.')}</p>
          )}
        </Panel>
      </div>
      <JobProgress running={job.running} progress={job.progress} label={job.label} onCancel={job.cancel} />
      <ErrorMessage error={job.error} title={t('Could not add the watermark')} />
      {result.value && <ResultFiles files={[result.value]} />}
    </>
  );
}

function WatermarkOverlay({
  geometry,
  kind,
  text,
  fontSize,
  bold,
  color,
  opacity,
  angle,
  position,
  tile,
  margin,
  imageUrl,
  image,
  imageScale,
}: {
  geometry: { width: number; height: number; scale: number };
  kind: 'text' | 'image';
  text: string;
  fontSize: number;
  bold: boolean;
  color: string;
  opacity: number;
  angle: number;
  position: Position;
  tile: boolean;
  margin: number;
  imageUrl: string | null;
  image: PreparedImage | null;
  imageScale: number;
}) {
  const { width: pw, height: ph, scale } = geometry;
  const size = useMemo(() => {
    if (kind === 'text') return { w: measure(text, fontSize, bold), h: fontSize * 0.72 };
    if (!image) return null;
    const w = pw * imageScale;
    return { w, h: (w * image.height) / image.width };
  }, [kind, text, fontSize, bold, image, pw, imageScale]);
  if (!size || size.w <= 0) return null;

  const centers: Array<{ cx: number; cy: number }> = [];
  const bounds = rotatedBounds(size.w, size.h, angle);
  if (tile) {
    centers.push(...tileCenters(pw, ph, size.w, size.h, angle, 400));
  } else {
    centers.push(anchorCenter(position, bounds.width, bounds.height, pw, ph, margin));
  }

  return (
    <>
      {centers.map(({ cx, cy }, i) => (
        <div
          key={i}
          className="absolute flex items-center justify-center whitespace-nowrap"
          style={{
            left: cx * scale,
            top: (ph - cy) * scale,
            width: size.w * scale,
            height: size.h * scale,
            transform: `translate(-50%, -50%) rotate(${-angle}deg)`,
            opacity,
          }}
        >
          {kind === 'text' ? (
            <span
              style={{
                fontSize: fontSize * scale,
                lineHeight: 1,
                color,
                fontWeight: bold ? 700 : 400,
                fontFamily: 'Helvetica, Arial, sans-serif',
              }}
            >
              {text}
            </span>
          ) : (
            imageUrl && <img src={imageUrl} alt="" className="h-full w-full object-fill" />
          )}
        </div>
      ))}
    </>
  );
}
