import { useId, useState } from 'react';
import { Minimize2 } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Checkbox, Label } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { formatBytes, pluralize } from '@/lib/utils';
import { throwIfAborted } from '@/lib/hooks';
import { canvasToBlob, releaseCanvas, renderPageToCanvas } from './lib/pdfjs';
import { outputName, pdfBlob, type OutputFile } from './lib/files';
import type { CompressStats, ImagePageInput } from './lib/ops';
import { runPdfOp } from './lib/runner';
import { docId } from './lib/thumbnails';
import { PdfInput, useEncryptionGate } from './components/PdfInput';
import { usePdfFile, type LoadedPdf } from './components/usePdfFile';
import { JobProgress, ResultFiles } from './components/Results';
import { usePdfJob } from './components/usePdfJob';
import { useKeyedResult } from './components/useKeyedResult';
import { sizeChange } from './lib/sizeChange';
import { verifyEncryptedEdit } from './components/verifyEdit';
import { t } from '@/lib/i18n';

type Mode = 'lossless' | 'rasterize';

const NOT_SMALLER_TITLE = {
  same: 'No size reduction',
  marginal: 'Almost no size reduction',
  larger: 'The result is larger than the original',
} as const;

export default function CompressPdf() {
  const controller = usePdfFile();
  return (
    <ToolStack>
      <PdfInput controller={controller} title={t('Drop a PDF to compress')}>
        {(pdf) => <CompressWorkspace key={docId(pdf.doc)} pdf={pdf} />}
      </PdfInput>
    </ToolStack>
  );
}

function CompressWorkspace({ pdf }: { pdf: LoadedPdf }) {
  const [mode, setMode] = useState<Mode>('lossless');
  const [dpi, setDpi] = useState<'72' | '100' | '150' | '200'>('150');
  const [quality, setQuality] = useState(0.7);
  const [grayscale, setGrayscale] = useState(false);
  const inputKey = mode === 'lossless' ? mode : JSON.stringify([mode, dpi, quality, grayscale]);
  const result = useKeyedResult<{ file: OutputFile; size: number; stats?: CompressStats; mode: Mode }>(inputKey);
  const job = usePdfJob();
  // Rasterizing renders with pdf.js (which decrypts), so only the lossless re-save touches encryption.
  const gate = useEncryptionGate(mode === 'lossless' ? pdf : null, 'structure');
  const qualityId = useId();

  async function run() {
    const key = inputKey;
    result.clear();
    if (mode === 'lossless') {
      const out = await job.run(async ({ signal, progress }) => {
        const done = await runPdfOp('compressLossless', { bytes: pdf.bytes, ignoreEncryption: gate.ignoreEncryption }, { signal, onProgress: progress });
        await verifyEncryptedEdit(pdf, done.bytes);
        return done;
      });
      if (out) {
        result.set(key, {
          file: { name: outputName(pdf.file.name, 'compressed'), data: pdfBlob(out.bytes), type: 'application/pdf' },
          size: out.bytes.byteLength,
          stats: out.stats,
          mode,
        });
      }
      return;
    }
    const scale = Number(dpi) / 72;
    const out = await job.run(async ({ signal, progress }) => {
      const images: ImagePageInput[] = [];
      for (let i = 1; i <= pdf.pageCount; i++) {
        throwIfAborted(signal);
        progress(((i - 1) / pdf.pageCount) * 0.85, `Rendering page ${i} of ${pdf.pageCount}`);
        const page = await pdf.doc.getPage(i);
        const vp = page.getViewport({ scale: 1 });
        const canvas = await renderPageToCanvas(page, { scale, signal, intent: 'print' });
        try {
          if (grayscale) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.globalCompositeOperation = 'saturation';
              ctx.fillStyle = '#000';
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.globalCompositeOperation = 'source-over';
            }
          }
          const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
          images.push({
            bytes: new Uint8Array(await blob.arrayBuffer()),
            format: 'jpg',
            width: canvas.width,
            height: canvas.height,
            pageWidth: vp.width,
            pageHeight: vp.height,
          });
        } finally {
          releaseCanvas(canvas);
          page.cleanup();
        }
      }
      return runPdfOp('imagesToPdf', { images, layout: { pageSize: 'fit', orientation: 'auto', margin: 0 } }, {
        signal,
        onProgress: (v, label) => progress(0.85 + v * 0.15, label),
      });
    });
    if (out) {
      result.set(key, {
        file: { name: outputName(pdf.file.name, 'compressed'), data: pdfBlob(out), type: 'application/pdf' },
        size: out.byteLength,
        mode,
      });
    }
  }

  const before = pdf.file.size;
  const done = result.value;
  const change = done ? sizeChange(before, done.size) : null;

  return (
    <>
      {gate.notice}
      <Panel title={t('Compression method')}>
        <div className="flex flex-col gap-4">
          <Segmented
            className="self-start"
            label={t('Compression method')}
            value={mode}
            onChange={setMode}
            options={[
              { value: 'lossless', label: t('Lossless') },
              { value: 'rasterize', label: t('Strong (rasterize)') },
            ]}
          />
          {mode === 'lossless' ? (
            <p className="max-w-2xl text-[13px] text-fg-secondary">
              {t('Re-saves the PDF with compressed object streams, removes objects nothing refers to, and deflates uncompressed streams. Text, images, links and forms are kept exactly. Savings depend on how the file was made: already-optimized PDFs may not shrink.')}
            </p>
          ) : (
            <>
              <Alert tone="warning" title={t('Text will no longer be selectable')}>
                {t('Every page is re-drawn as a JPEG image. This can shrink scans and image-heavy PDFs a lot, but text becomes a picture (no search, copy or screen readers) and links, bookmarks and form fields are removed.')}
                {pdf.encrypted && ' The new file is not encrypted: its password and permission restrictions are not carried over.'}
              </Alert>
              <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
                <div>
                  <Label>{t('Resolution')}</Label>
                  <Segmented
                    label={t('Resolution')}
                    value={dpi}
                    onChange={setDpi}
                    options={[
                      { value: '72', label: '72 DPI' },
                      { value: '100', label: '100' },
                      { value: '150', label: '150' },
                      { value: '200', label: '200' },
                    ]}
                  />
                </div>
                <div className="w-56">
                  <Label htmlFor={qualityId}>{t('JPEG quality: {round}%', { round: Math.round(quality * 100) })}</Label>
                  <input
                    id={qualityId}
                    type="range"
                    className="lk-range"
                    min={0.3}
                    max={0.95}
                    step={0.05}
                    value={quality}
                    onChange={(e) => setQuality(Number(e.target.value))}
                  />
                </div>
                <Checkbox label={t('Grayscale')} checked={grayscale} onChange={setGrayscale} className="pb-1.5" />
              </div>
            </>
          )}
          <div className="border-t border-line pt-4">
            <Button variant="primary" icon={Minimize2} disabled={!gate.ok || job.running} loading={job.running} onClick={() => void run()}>
              {t('Compress PDF')}
            </Button>
          </div>
        </div>
      </Panel>
      <JobProgress running={job.running} progress={job.progress} label={job.label} onCancel={job.cancel} />
      <ErrorMessage error={job.error} title={t('Compression failed')} />
      {done && change && change.verdict !== 'smaller' && (
        <Alert tone="warning" title={NOT_SMALLER_TITLE[change.verdict]}>
          {done.mode === 'lossless'
            ? t('This PDF is already well optimized. Keep your original file, or try the strong (rasterize) method if it is mostly scans or images.')
            : t('Rasterizing did not help for this file (it is probably mostly text or vector graphics). Keep your original, or try a lower resolution or quality.')}
        </Alert>
      )}
      {done && change && (
        <ResultFiles
          files={[done.file]}
          tone={change.verdict === 'smaller' ? 'success' : 'neutral'}
          title={change.verdict === 'smaller' ? t('Reduced by {round}%', { round: Math.round(-change.fraction * 100) }) : t('Compressed file')}
        >
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-fg-secondary">
            <span>
              {t('Before:')}{' '}<strong className="font-medium text-fg">{formatBytes(before)}</strong>
            </span>
            <span>
              {t('After:')}{' '}<strong className="font-medium text-fg">{formatBytes(done.size)}</strong>
            </span>
            <span>
              {t('Change:')}{' '}<strong className={change.verdict === 'smaller' ? 'font-medium text-success' : 'font-medium text-warning'}>{change.percent}</strong>
            </span>
            {done.stats && (
              <span>
                {t('{count} removed · {count2} compressed', { count: pluralize(done.stats.removedObjects, t('unused object'), t('unused objects')), count2: pluralize(done.stats.compressedStreams, t('stream'), t('streams')) })}
              </span>
            )}
          </div>
        </ResultFiles>
      )}
    </>
  );
}
