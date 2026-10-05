import { useEffect, useRef, useState } from 'react';
import { ScanText } from 'lucide-react';
import { EditorPanel, ToolStack } from '@/components/tool/EditorPanel';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Checkbox, Label } from '@/components/ui/Field';
import { Badge, Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { formatNumber, pluralize } from '@/lib/utils';
import { throwIfAborted } from '@/lib/hooks';
import { createOcrEngine, type OcrEngine, type OcrProgress } from '../ocr/lib/engine';
import { confidenceLevel } from '../ocr/lib/result';
import { releaseCanvas, renderPageToCanvas } from './lib/pdfjs';
import { joinPages, runsToLines, type PageText, type TextRun } from './lib/text';
import type { OcrPage } from './lib/ops';
import { outputName, pdfBlob, type OutputFile } from './lib/files';
import { runPdfOp } from './lib/runner';
import { PdfError } from './lib/errors';
import { docId } from './lib/thumbnails';
import { PdfInput, useEncryptionGate } from './components/PdfInput';
import { usePdfFile, type LoadedPdf } from './components/usePdfFile';
import { PageScopeControl, usePageScope } from './components/PageScope';
import { JobProgress, ResultFiles, ShareResult } from './components/Results';
import { usePdfJob } from './components/usePdfJob';
import { t } from '@/lib/i18n';
import { MobileRasterNotice, useRasterLimits } from './components/MobileRasterNotice';

type Dpi = '150' | '200' | '300';

interface PageOutcome extends PageText {
  source: 'ocr' | 'text-layer';
  confidence?: number;
}

/**
 * Start the OCR engine, giving up as soon as the job is cancelled (loading takes a few
 * seconds). An engine that finishes loading after the cancel is terminated right away.
 */
function startEngine(signal: AbortSignal, onProgress: OcrProgress): Promise<OcrEngine> {
  const creating = createOcrEngine(onProgress);
  return new Promise<OcrEngine>((resolve, reject) => {
    const onAbort = () => {
      reject(new PdfError('cancelled', 'The operation was cancelled.'));
      creating.then((e) => e.terminate(), () => {});
    };
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
    creating.then(
      (e) => {
        signal.removeEventListener('abort', onAbort);
        if (signal.aborted) void e.terminate();
        else resolve(e);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      },
    );
  });
}

/** Explains pages that were read from their text layer instead of being recognized. */
function skippedNote(skipped: number, keptInPdf: boolean): string {
  const count = pluralize(skipped, t('page'), t('pages'));
  if (skipped === 1) {
    return keptInPdf
      ? t('{count} already had selectable text, so it was read directly and left unchanged in the PDF.', { count })
      : t('{count} already had selectable text, so it was read directly.', { count });
  }
  return keptInPdf
    ? t('{count} already had selectable text, so they were read directly and left unchanged in the PDF.', { count })
    : t('{count} already had selectable text, so they were read directly.', { count });
}

export default function OcrPdf() {
  const controller = usePdfFile();
  return (
    <ToolStack>
      <Alert tone="info">
        {t('OCR runs on this device with Tesseract. Only')}{' '}<strong>{t('English')}</strong>{' '}{t('language data is included, so other languages will be recognized poorly. Expect a few seconds per page.')}
      </Alert>
      <PdfInput controller={controller} title={t('Drop a scanned PDF')}>
        {(pdf) => <OcrWorkspace key={docId(pdf.doc)} pdf={pdf} />}
      </PdfInput>
    </ToolStack>
  );
}

function OcrWorkspace({ pdf }: { pdf: LoadedPdf }) {
  const limits = useRasterLimits();
  const scope = usePageScope(pdf.pageCount, 'all');
  const [dpi, setDpi] = useState<Dpi>('300');
  const [searchable, setSearchable] = useState(true);
  const [skipText, setSkipText] = useState(true);
  const [pages, setPages] = useState<PageOutcome[] | null>(null);
  const [file, setFile] = useState<OutputFile | null>(null);
  const job = usePdfJob();
  const gate = useEncryptionGate(
    searchable ? pdf : null,
    'draw',
    'A text layer added to an encrypted PDF comes out unreadable, so the new file would not be searchable. Turn off “Create a searchable PDF” to only read the text.',
  );
  const engine = useRef<OcrEngine | null>(null);

  useEffect(
    () => () => {
      void engine.current?.terminate();
    },
    [],
  );

  async function run() {
    setPages(null);
    setFile(null);
    const list = scope.pages;
    const out = await job.run(async ({ signal, progress }) => {
      const stop = () => {
        const e = engine.current;
        engine.current = null;
        void e?.terminate();
      };
      signal.addEventListener('abort', stop, { once: true });
      try {
        const outcomes: PageOutcome[] = [];
        const layers: OcrPage[] = [];
        const share = searchable ? 0.93 : 1;
        for (let k = 0; k < list.length; k++) {
          throwIfAborted(signal);
          const pageNo = list[k] + 1;
          const base = k / list.length;
          const step = 1 / list.length;
          const page = await pdf.doc.getPage(pageNo);
          try {
            if (skipText) {
              const content = await page.getTextContent();
              const lines = runsToLines(content.items.filter((it) => 'str' in it) as unknown as TextRun[]);
              const existing = lines.join('\n');
              if (existing.replace(/\s/g, '').length >= 20) {
                outcomes.push({ page: pageNo, text: existing, source: 'text-layer' });
                continue;
              }
            }
            progress(base * share, `Rendering page ${pageNo}`);
            const canvas = await renderPageToCanvas(page, { scale: Number(dpi) / 72, signal, intent: 'print', ...limits });
            try {
              if (!engine.current) {
                engine.current = await startEngine(signal, (_v, label) => progress(base * share, label));
              }
              throwIfAborted(signal);
              const current = engine.current;
              const result = await current.recognize(canvas, (v, label) => {
                if (label === 'Recognizing text') progress((base + v * step) * share, `Recognizing page ${pageNo} (${k + 1} of ${list.length})`);
              });
              throwIfAborted(signal);
              outcomes.push({ page: pageNo, text: result.text, source: 'ocr', confidence: result.confidence });
              layers.push({
                index: list[k],
                imageWidth: result.width,
                imageHeight: result.height,
                lines: result.lines.map((l) => l.words.map((w) => ({ text: w.text, ...w.bbox }))),
              });
            } finally {
              releaseCanvas(canvas);
            }
          } finally {
            page.cleanup();
          }
        }
        let bytes: Uint8Array | null = null;
        if (searchable && layers.length > 0) {
          progress(share, 'Building the searchable PDF');
          bytes = await runPdfOp(
            'addTextLayer',
            { bytes: pdf.bytes, pages: layers, ignoreEncryption: gate.ignoreEncryption },
            { signal, onProgress: (v) => progress(share + v * (1 - share), 'Building the searchable PDF') },
          );
        }
        return { outcomes, bytes };
      } catch (error) {
        if (signal.aborted) throw new PdfError('cancelled', 'The operation was cancelled.');
        throw error;
      } finally {
        signal.removeEventListener('abort', stop);
        // Free the engine's memory (~100 MB) between runs.
        const e = engine.current;
        engine.current = null;
        await e?.terminate();
      }
    });
    if (out) {
      setPages(out.outcomes);
      if (out.bytes) setFile({ name: outputName(pdf.file.name, 'searchable'), data: pdfBlob(out.bytes), type: 'application/pdf' });
    }
  }

  const text = pages ? joinPages(pages, true) : '';
  const ocrPages = pages?.filter((p) => p.source === 'ocr') ?? [];
  const avg = ocrPages.length ? ocrPages.reduce((n, p) => n + (p.confidence ?? 0), 0) / ocrPages.length : null;
  const skipped = pages ? pages.length - ocrPages.length : 0;

  return (
    <>
      <MobileRasterNotice />
      {gate.notice}
      <Panel>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
            <div>
              <Label>{t('Scan resolution')}</Label>
              <Segmented
                label={t('Scan resolution')}
                value={dpi}
                onChange={setDpi}
                options={[
                  { value: '150', label: t('150 DPI (fast)') },
                  { value: '200', label: '200' },
                  { value: '300', label: t('300 (accurate)') },
                ]}
              />
            </div>
            <PageScopeControl scope={scope} modes={['all', 'range']} />
          </div>
          <div className="flex flex-col gap-2.5">
            <Checkbox
              label={t('Create a searchable PDF')}
              description={t('Adds an invisible text layer on top of each scanned page, so you can search, select and copy. The page images are not changed.')}
              checked={searchable}
              onChange={setSearchable}
            />
            <Checkbox
              label={t('Skip pages that already have text')}
              description={t('Pages with a real text layer are read directly instead of being OCR\'d.')}
              checked={skipText}
              onChange={setSkipText}
            />
          </div>
          <div className="border-t border-line pt-4">
            <Button
              variant="primary"
              icon={ScanText}
              disabled={!gate.ok || scope.pages.length === 0 || Boolean(scope.error) || job.running}
              loading={job.running}
              onClick={() => void run()}
            >
              {t('Run OCR on')}{' '}{scope.pages.length ? pluralize(scope.pages.length, t('page'), t('pages')) : t('pages')}
            </Button>
          </div>
        </div>
      </Panel>
      <JobProgress running={job.running} progress={job.progress} label={job.label} onCancel={job.cancel} />
      <ErrorMessage error={job.error} title={t('OCR failed')} />
      {pages && skipped > 0 && (
        <Alert tone="info">
          {skippedNote(skipped, searchable && ocrPages.length > 0)}
        </Alert>
      )}
      {pages && searchable && !file && ocrPages.length === 0 && (
        <Alert tone="info">{t('No page needed OCR, so no new PDF was created.')}</Alert>
      )}
      {file && (
        <ResultFiles files={[file]} title={t('Searchable PDF ready')}>
          <p className="text-[12.5px] text-fg-secondary">
            {t('Text layer added to {count}. Open it in any PDF viewer and search or select text.', { count: pluralize(ocrPages.length, t('page'), t('pages')) })}
          </p>
        </ResultFiles>
      )}
      {pages && (
        <EditorPanel
          actions={<ShareResult files={[{ name: outputName(pdf.file.name, 'ocr', 'txt'), data: new Blob([text], { type: 'text/plain' }), type: 'text/plain' }]} />}
          title={
            <span className="inline-flex items-center gap-2">
              {t('Recognized text')}
              {avg !== null && (
                <Badge tone={confidenceLevel(avg) === 'high' ? 'success' : confidenceLevel(avg) === 'medium' ? 'warning' : 'danger'}>
                  {t('{round}% avg. confidence', { round: Math.round(avg) })}
                </Badge>
              )}
            </span>
          }
          ariaLabel={t('Recognized text')}
          value={text}
          readOnly
          height="480px"
          downloadName={outputName(pdf.file.name, 'ocr', 'txt')}
          placeholder={t('No text was recognized.')}
          footer={
            <>
              <span>{pluralize(pages.length, t('page'), t('pages'))}</span>
              <span>{t('{count} words', { count: formatNumber(text.split(/\s+/).filter(Boolean).length, 0) })}</span>
            </>
          }
        />
      )}
    </>
  );
}
