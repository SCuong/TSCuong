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

type Mode = 'lossless' | 'rasterize';

export default function CompressPdf() {
  const controller = usePdfFile();
  return (
    <ToolStack>
      <PdfInput controller={controller} title="Drop a PDF to compress">
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
  const [result, setResult] = useState<{ file: OutputFile; size: number; stats?: CompressStats; mode: Mode } | null>(null);
  const job = usePdfJob();
  const gate = useEncryptionGate(mode === 'lossless' ? pdf : null);
  const qualityId = useId();

  async function run() {
    setResult(null);
    if (mode === 'lossless') {
      const out = await job.run(({ signal, progress }) =>
        runPdfOp('compressLossless', { bytes: pdf.bytes, ignoreEncryption: gate.ignoreEncryption }, { signal, onProgress: progress }),
      );
      if (out) {
        setResult({
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
      setResult({
        file: { name: outputName(pdf.file.name, 'compressed'), data: pdfBlob(out), type: 'application/pdf' },
        size: out.byteLength,
        mode,
      });
    }
  }

  const before = pdf.file.size;
  const change = result ? (result.size - before) / before : 0;

  return (
    <>
      {gate.notice}
      <Panel title="Compression method">
        <div className="flex flex-col gap-4">
          <Segmented
            className="self-start"
            label="Compression method"
            value={mode}
            onChange={(m) => {
              setMode(m);
              setResult(null);
            }}
            options={[
              { value: 'lossless', label: 'Lossless' },
              { value: 'rasterize', label: 'Strong (rasterize)' },
            ]}
          />
          {mode === 'lossless' ? (
            <p className="max-w-2xl text-[13px] text-fg-secondary">
              Re-saves the PDF with compressed object streams, removes objects nothing refers to, and deflates uncompressed streams. Text,
              images, links and forms are kept exactly. Savings depend on how the file was made: already-optimized PDFs may not shrink.
            </p>
          ) : (
            <>
              <Alert tone="warning" title="Text will no longer be selectable">
                Every page is re-drawn as a JPEG image. This can shrink scans and image-heavy PDFs a lot, but text becomes a picture (no
                search, copy or screen readers) and links, bookmarks and form fields are removed.
              </Alert>
              <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
                <div>
                  <Label>Resolution</Label>
                  <Segmented
                    label="Resolution"
                    value={dpi}
                    onChange={(v) => {
                      setDpi(v);
                      setResult(null);
                    }}
                    options={[
                      { value: '72', label: '72 DPI' },
                      { value: '100', label: '100' },
                      { value: '150', label: '150' },
                      { value: '200', label: '200' },
                    ]}
                  />
                </div>
                <div className="w-56">
                  <Label htmlFor={qualityId}>JPEG quality: {Math.round(quality * 100)}%</Label>
                  <input
                    id={qualityId}
                    type="range"
                    className="lk-range"
                    min={0.3}
                    max={0.95}
                    step={0.05}
                    value={quality}
                    onChange={(e) => {
                      setQuality(Number(e.target.value));
                      setResult(null);
                    }}
                  />
                </div>
                <Checkbox label="Grayscale" checked={grayscale} onChange={setGrayscale} className="pb-1.5" />
              </div>
            </>
          )}
          <div className="border-t border-line pt-4">
            <Button variant="primary" icon={Minimize2} disabled={!gate.ok || job.running} loading={job.running} onClick={() => void run()}>
              Compress PDF
            </Button>
          </div>
        </div>
      </Panel>
      <JobProgress running={job.running} progress={job.progress} label={job.label} onCancel={job.cancel} />
      <ErrorMessage error={job.error} title="Compression failed" />
      {result && change >= 0 && (
        <Alert tone="warning" title={change === 0 ? 'No size reduction' : 'The result is larger than the original'}>
          {result.mode === 'lossless'
            ? 'This PDF is already well optimized. Keep your original file, or try the strong (rasterize) method if it is mostly scans or images.'
            : 'Rasterizing did not help for this file (it is probably mostly text or vector graphics). Keep your original, or try a lower resolution or quality.'}
        </Alert>
      )}
      {result && (
        <ResultFiles files={[result.file]} tone={change < 0 ? 'success' : 'neutral'} title={change < 0 ? `Reduced by ${Math.round(-change * 100)}%` : 'Compressed file'}>
          <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-fg-secondary">
            <span>
              Before: <strong className="font-medium text-fg">{formatBytes(before)}</strong>
            </span>
            <span>
              After: <strong className="font-medium text-fg">{formatBytes(result.size)}</strong>
            </span>
            <span>
              Change: <strong className={change < 0 ? 'font-medium text-success' : 'font-medium text-warning'}>{`${change > 0 ? '+' : ''}${(change * 100).toFixed(1)}%`}</strong>
            </span>
            {result.stats && (
              <span>
                {pluralize(result.stats.removedObjects, 'unused object')} removed · {pluralize(result.stats.compressedStreams, 'stream')} compressed
              </span>
            )}
          </div>
        </ResultFiles>
      )}
    </>
  );
}
