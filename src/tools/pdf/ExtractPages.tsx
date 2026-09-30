import { FileOutput } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { ErrorMessage } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Panel } from '@/components/ui/Panel';
import { pluralize } from '@/lib/utils';
import { formatPageList } from './lib/ranges';
import { outputName, pdfBlob, type OutputFile } from './lib/files';
import { runPdfOp } from './lib/runner';
import { docId } from './lib/thumbnails';
import { PdfInput, useEncryptionGate } from './components/PdfInput';
import { usePdfFile, type LoadedPdf } from './components/usePdfFile';
import { PagePicker, PageScopeControl, usePageScope } from './components/PageScope';
import { JobProgress, ResultFiles } from './components/Results';
import { usePdfJob } from './components/usePdfJob';
import { useKeyedResult } from './components/useKeyedResult';
import { t } from '@/lib/i18n';

export default function ExtractPages() {
  const controller = usePdfFile();
  return (
    <ToolStack>
      <PdfInput controller={controller} title={t('Drop a PDF to extract pages from')}>
        {(pdf) => <ExtractWorkspace key={docId(pdf.doc)} pdf={pdf} />}
      </PdfInput>
    </ToolStack>
  );
}

function ExtractWorkspace({ pdf }: { pdf: LoadedPdf }) {
  const scope = usePageScope(pdf.pageCount, 'pick');
  const result = useKeyedResult<{ file: OutputFile; count: number }>(scope.pages.join(','));
  const job = usePdfJob();
  const gate = useEncryptionGate(pdf, 'copy');

  async function run() {
    const pages = scope.pages;
    const key = pages.join(',');
    result.clear();
    const bytes = await job.run(({ signal, progress }) =>
      runPdfOp('selectPages', { bytes: pdf.bytes, pages, ignoreEncryption: gate.ignoreEncryption }, { signal, onProgress: progress }),
    );
    if (bytes) {
      result.set(key, {
        file: { name: outputName(pdf.file.name, 'extracted'), data: pdfBlob(bytes), type: 'application/pdf' },
        count: pages.length,
      });
    }
  }

  const summary =
    scope.pages.length > 0
      ? `${pluralize(scope.pages.length, t('page'), t('pages'))}: ${formatPageList(scope.pages.map((p) => p + 1))}`
      : t('No pages selected yet');

  return (
    <>
      {gate.notice}
      <Panel title={t('Pages to extract')} description={t('The new PDF keeps the order you give, so a range like 10-1 reverses the pages.')}>
        <div className="flex flex-col gap-4">
          <PageScopeControl scope={scope} modes={['pick', 'range']} pickLabel={t('Select visually')} />
          {scope.mode === 'pick' && <PagePicker pdf={pdf} selected={scope.picked} onChange={scope.setPicked} />}
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Button
              variant="primary"
              icon={FileOutput}
              disabled={!gate.ok || scope.pages.length === 0 || Boolean(scope.error) || job.running}
              loading={job.running}
              onClick={() => void run()}
            >
              {t('Extract pages')}
            </Button>
            <span className="min-w-0 truncate text-[13px] text-fg-muted">{summary}</span>
          </div>
        </div>
      </Panel>
      <JobProgress running={job.running} progress={job.progress} label={job.label} onCancel={job.cancel} />
      <ErrorMessage error={job.error} title={t('Extraction failed')} />
      {result.value && <ResultFiles files={[result.value.file]} title={t('Extracted {count}', { count: pluralize(result.value.count, t('page'), t('pages')) })} />}
    </>
  );
}
