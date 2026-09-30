import { useCallback, useMemo, useState } from 'react';
import { Trash } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { ErrorMessage } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Panel } from '@/components/ui/Panel';
import { pluralize } from '@/lib/utils';
import { formatPageList } from './lib/ranges';
import { outputName, pdfBlob, type OutputFile } from './lib/files';
import { runPdfOp } from './lib/runner';
import { docId } from './lib/thumbnails';
import { PdfInput, useEncryptionGate } from './components/PdfInput';
import { usePdfFile, type LoadedPdf } from './components/usePdfFile';
import { PagePicker, PageScopeControl, pageId, usePageScope } from './components/PageScope';
import { PageGrid, type GridItem } from './components/PageGrid';
import { JobProgress, ResultFiles } from './components/Results';
import { usePdfJob } from './components/usePdfJob';
import { useKeyedResult } from './components/useKeyedResult';
import { t } from '@/lib/i18n';

export default function DeletePages() {
  const controller = usePdfFile();
  return (
    <ToolStack>
      <PdfInput controller={controller} title={t('Drop a PDF to remove pages from')}>
        {(pdf) => <DeleteWorkspace key={docId(pdf.doc)} pdf={pdf} />}
      </PdfInput>
    </ToolStack>
  );
}

function DeleteWorkspace({ pdf }: { pdf: LoadedPdf }) {
  const scope = usePageScope(pdf.pageCount, 'pick');
  const [confirming, setConfirming] = useState(false);
  const job = usePdfJob();
  const gate = useEncryptionGate(pdf, 'copy');

  const removed = useMemo(() => new Set(scope.pages), [scope.pages]);
  const removedList = useMemo(() => [...removed].sort((a, b) => a - b), [removed]);
  const result = useKeyedResult<{ file: OutputFile; remaining: number }>(removedList.join(','));
  const isRemoved = useCallback((i: number) => removed.has(i), [removed]);
  const remaining = pdf.pageCount - removed.size;
  const everything = removed.size > 0 && remaining === 0;

  const previewItems = useMemo<GridItem[]>(
    () =>
      Array.from({ length: pdf.pageCount }, (_, i) => ({
        id: pageId(i),
        doc: pdf.doc,
        pageIndex: i,
        label: t('Page {i}', { i: i + 1 }),
        state: removed.has(i) ? 'removed' : 'normal',
      })),
    [pdf, removed],
  );

  async function run() {
    setConfirming(false);
    const key = removedList.join(',');
    result.clear();
    const keep = Array.from({ length: pdf.pageCount }, (_, i) => i).filter((i) => !removed.has(i));
    const bytes = await job.run(({ signal, progress }) =>
      runPdfOp('selectPages', { bytes: pdf.bytes, pages: keep, ignoreEncryption: gate.ignoreEncryption }, { signal, onProgress: progress }),
    );
    if (bytes) {
      result.set(key, {
        file: { name: outputName(pdf.file.name, 'edited'), data: pdfBlob(bytes), type: 'application/pdf' },
        remaining: keep.length,
      });
    }
  }

  const removedText = formatPageList(removedList.map((p) => p + 1));

  return (
    <>
      {gate.notice}
      <Panel title={t('Pages to delete')} description={t('Click pages to mark them for removal, or type a range.')}>
        <div className="flex flex-col gap-4">
          <PageScopeControl scope={scope} modes={['pick', 'range']} pickLabel={t('Select visually')} label={t('Choose pages')} />
          <ErrorMessage error={everything ? t('You cannot delete every page: a PDF needs at least one page.') : null} />
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Button
              variant="danger"
              icon={Trash}
              disabled={!gate.ok || removed.size === 0 || everything || Boolean(scope.error) || job.running}
              loading={job.running}
              onClick={() => setConfirming(true)}
            >
              Delete {removed.size ? pluralize(removed.size, t('page'), t('pages')) : 'pages'}
            </Button>
            {removed.size > 0 && !everything && (
              <span className="text-[13px] text-fg-muted">
                {t('{count} will remain. Your original file is not changed.', { count: pluralize(remaining, t('page'), t('pages')) })}
              </span>
            )}
          </div>
        </div>
      </Panel>
      <JobProgress running={job.running} progress={job.progress} label={job.label} onCancel={job.cancel} />
      <ErrorMessage error={job.error} title={t('Could not delete pages')} />
      {result.value && <ResultFiles files={[result.value.file]} title={t('New PDF with {count}', { count: pluralize(result.value.remaining, t('page'), t('pages')) })} />}
      {scope.mode === 'pick' ? (
        <PagePicker pdf={pdf} selected={scope.picked} onChange={scope.setPicked} removed={isRemoved} />
      ) : (
        <PageGrid items={previewItems} ariaLabel={t('Preview: crossed-out pages will be deleted')} />
      )}
      <ConfirmDialog
        open={confirming}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void run()}
        title={t('Delete {count}?', { count: pluralize(removed.size, t('page'), t('pages')) })}
        confirmLabel={t('Delete pages')}
      >
        {removed.size === 1 ? t('Page {removedText} will be removed.', { removedText }) : t('Pages {removedText} will be removed.', { removedText })}{' '}{t('The new PDF will have {count}. Your original file stays unchanged.', { count: pluralize(remaining, t('page'), t('pages')) })}
      </ConfirmDialog>
    </>
  );
}
