import { useEffect, useId, useMemo, useState } from 'react';
import { ImageDown } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Label, NumberInput } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { formatBytes, pluralize } from '@/lib/utils';
import { throwIfAborted } from '@/lib/hooks';
import { MAX_CANVAS_AREA, MAX_CANVAS_SIDE, canvasToBlob, releaseCanvas, renderPageToCanvas } from './lib/pdfjs';
import { outputName, padIndex, type OutputFile } from './lib/files';
import { docId } from './lib/thumbnails';
import { PdfInput } from './components/PdfInput';
import { usePdfFile, type LoadedPdf } from './components/usePdfFile';
import { PageScopeControl, usePageScope } from './components/PageScope';
import { JobProgress, ResultFiles } from './components/Results';
import { usePdfJob } from './components/usePdfJob';
import { useKeyedResult } from './components/useKeyedResult';
import { t } from '@/lib/i18n';

type Format = 'png' | 'jpeg' | 'webp';
const MIME: Record<Format, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
const EXT: Record<Format, string> = { png: 'png', jpeg: 'jpg', webp: 'webp' };
const DPI_PRESETS = ['72', '96', '150', '200', '300', 'custom'] as const;
type DpiPreset = (typeof DPI_PRESETS)[number];

export default function PdfToImages() {
  const controller = usePdfFile();
  return (
    <ToolStack>
      <PdfInput controller={controller} title={t('Drop a PDF to convert to images')}>
        {(pdf) => <ImagesWorkspace key={docId(pdf.doc)} pdf={pdf} />}
      </PdfInput>
    </ToolStack>
  );
}

function supportsEncoding(type: string): boolean {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  return canvas.toDataURL(type).startsWith(`data:${type}`);
}

function ImagesWorkspace({ pdf }: { pdf: LoadedPdf }) {
  const scope = usePageScope(pdf.pageCount, 'all');
  const [format, setFormat] = useState<Format>('png');
  const [quality, setQuality] = useState(0.9);
  const [preset, setPreset] = useState<DpiPreset>('150');
  const [customDpi, setCustomDpi] = useState<number | ''>(240);
  const [sizes, setSizes] = useState<Array<{ w: number; h: number }> | null>(null);
  const job = usePdfJob();
  const dpiId = useId();
  const qualityId = useId();
  const webpOk = useMemo(() => supportsEncoding('image/webp'), []);

  const dpi = preset === 'custom' ? (customDpi === '' ? 0 : customDpi) : Number(preset);
  const dpiError = preset === 'custom' && (!dpi || dpi < 18 || dpi > 1200) ? 'Choose a DPI between 18 and 1200.' : null;

  // Page sizes for the memory estimate (cheap: no rendering).
  useEffect(() => {
    let alive = true;
    (async () => {
      const list: Array<{ w: number; h: number }> = [];
      for (let i = 1; i <= pdf.pageCount; i++) {
        const page = await pdf.doc.getPage(i);
        const vp = page.getViewport({ scale: 1 });
        list.push({ w: vp.width, h: vp.height });
        if (!alive) return;
      }
      setSizes(list);
    })().catch(() => alive && setSizes([]));
    return () => {
      alive = false;
    };
  }, [pdf]);

  const estimate = useMemo(() => {
    if (!sizes || sizes.length === 0 || !dpi) return null;
    const scale = dpi / 72;
    let pixels = 0;
    let largest = 0;
    let clamped = 0;
    for (const p of scope.pages) {
      const s = sizes[p];
      if (!s) continue;
      const w = s.w * scale;
      const h = s.h * scale;
      const px = w * h;
      largest = Math.max(largest, px);
      if (w > MAX_CANVAS_SIDE || h > MAX_CANVAS_SIDE || px > MAX_CANVAS_AREA) clamped++;
      pixels += Math.min(px, MAX_CANVAS_AREA);
    }
    const bytesPerPixel = format === 'png' ? 0.9 : 0.12 + quality * 0.25;
    return { pixels, largest, clamped, bytes: pixels * bytesPerPixel };
  }, [sizes, dpi, scope.pages, format, quality]);

  const heavy = estimate && (estimate.bytes > 400 * 1024 * 1024 || estimate.largest > 40e6);

  const inputKey = JSON.stringify([scope.pages, format, format === 'png' ? null : quality, dpi]);
  const result = useKeyedResult<OutputFile[]>(inputKey);

  async function run() {
    const key = inputKey;
    result.clear();
    const type = MIME[format];
    const files: OutputFile[] = [];
    const pages = scope.pages;
    const ok = await job.run(async ({ signal, progress }) => {
      for (let k = 0; k < pages.length; k++) {
        throwIfAborted(signal);
        progress(k / pages.length, `Rendering page ${pages[k] + 1} (${k + 1} of ${pages.length})`);
        const page = await pdf.doc.getPage(pages[k] + 1);
        const canvas = await renderPageToCanvas(page, { scale: dpi / 72, signal, intent: 'print' });
        try {
          const blob = await canvasToBlob(canvas, type, format === 'png' ? undefined : quality);
          files.push({ name: outputName(pdf.file.name, `page-${padIndex(pages[k] + 1, pdf.pageCount)}`, EXT[format]), data: blob, type });
        } finally {
          releaseCanvas(canvas);
          page.cleanup();
        }
      }
      return true;
    });
    if (ok) result.set(key, files);
  }

  return (
    <>
      <Panel title={t('Image settings')}>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start gap-x-6 gap-y-4">
            <div>
              <Label>{t('Format')}</Label>
              <Segmented
                label={t('Format')}
                value={format}
                onChange={setFormat}
                options={[
                  { value: 'png', label: 'PNG' },
                  { value: 'jpeg', label: 'JPEG' },
                  ...(webpOk ? [{ value: 'webp' as const, label: t('WebP') }] : []),
                ]}
              />
            </div>
            {format !== 'png' && (
              <div className="w-56">
                <Label htmlFor={qualityId}>{t('Quality: {round}%', { round: Math.round(quality * 100) })}</Label>
                <input
                  id={qualityId}
                  type="range"
                  className="lk-range"
                  min={0.3}
                  max={1}
                  step={0.05}
                  value={quality}
                  onChange={(e) => setQuality(Number(e.target.value))}
                />
              </div>
            )}
            <div>
              <Label>{t('Resolution (DPI)')}</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Segmented
                  label={t('Resolution')}
                  value={preset}
                  onChange={setPreset}
                  options={DPI_PRESETS.map((d) => ({ value: d, label: d === 'custom' ? t('Custom') : d }))}
                />
                {preset === 'custom' && (
                  <div className="w-24">
                    <label htmlFor={dpiId} className="sr-only">
                      {t('Custom DPI')}
                    </label>
                    <NumberInput
                      id={dpiId}
                      min={18}
                      max={1200}
                      value={customDpi}
                      onChange={setCustomDpi}
                      aria-invalid={dpiError ? true : undefined}
                      className="h-8 py-1"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
          <PageScopeControl scope={scope} modes={['all', 'range']} />
          <ErrorMessage error={dpiError} />
          {estimate && !dpiError && (
            <p className="text-[12.5px] text-fg-muted">
              {t('{count} at {dpi} DPI · about {pixels} megapixels in total · output up to about {size}', { count: pluralize(scope.pages.length, t('image'), t('images')), dpi, pixels: (estimate.pixels / 1e6).toFixed(estimate.pixels > 1e8 ? 0 : 1), size: formatBytes(estimate.bytes) })}
            </p>
          )}
          {heavy && !dpiError && (
            <Alert tone="warning" title={t('This will use a lot of memory')}>
              {estimate!.largest > 40e6
                ? t('High resolution times many pages produces very large images (the largest page is over 40 megapixels).')
                : t('High resolution times many pages produces very large images.')}{' '}
              {t('Pages are rendered one at a time, but all images are kept in memory until you download them. Consider a lower DPI, JPEG, or fewer pages if your browser struggles.')}
            </Alert>
          )}
          {estimate && estimate.clamped > 0 && !dpiError && (
            <Alert tone="info">
              {t('{count} would exceed the browser\'s maximum canvas size and will be rendered at the largest size the browser allows.', { count: pluralize(estimate.clamped, t('page'), t('pages')) })}
            </Alert>
          )}
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Button
              variant="primary"
              icon={ImageDown}
              disabled={scope.pages.length === 0 || Boolean(scope.error) || Boolean(dpiError) || job.running}
              loading={job.running}
              onClick={() => void run()}
            >
              {t('Convert')}{' '}{scope.pages.length ? pluralize(scope.pages.length, t('page'), t('pages')) : 'pages'}
            </Button>
          </div>
        </div>
      </Panel>
      <JobProgress running={job.running} progress={job.progress} label={job.label} onCancel={job.cancel} />
      <ErrorMessage error={job.error} title={t('Conversion failed')} />
      <ResultFiles files={result.value ?? []} zipName={outputName(pdf.file.name, EXT[format], 'zip')} />
    </>
  );
}
