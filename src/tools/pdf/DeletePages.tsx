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

export default function DeletePages() {
  const controller = usePdfFile();
  return (
    <ToolStack>
      <PdfInput controller={controller} title="Drop a PDF to remove pages from">
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
        label: `Page ${i + 1}`,
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
      <Panel title="Pages to delete" description="Click pages to mark them for removal, or type a range.">
        <div className="flex flex-col gap-4">
          <PageScopeControl scope={scope} modes={['pick', 'range']} pickLabel="Select visually" label="Choose pages" />
          <ErrorMessage error={everything ? 'You cannot delete every page: a PDF needs at least one page.' : null} />
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Button
              variant="danger"
              icon={Trash}
              disabled={!gate.ok || removed.size === 0 || everything || Boolean(scope.error) || job.running}
              loading={job.running}
              onClick={() => setConfirming(true)}
            >
              Delete {removed.size ? pluralize(removed.size, 'page') : 'pages'}
            </Button>
            {removed.size > 0 && !everything && (
              <span className="text-[13px] text-fg-muted">
                {pluralize(remaining, 'page')} will remain. Your original file is not changed.
              </span>
            )}
          </div>
        </div>
      </Panel>
      <JobProgress running={job.running} progress={job.progress} label={job.label} onCancel={job.cancel} />
      <ErrorMessage error={job.error} title="Could not delete pages" />
      {result.value && <ResultFiles files={[result.value.file]} title={`New PDF with ${pluralize(result.value.remaining, 'page')}`} />}
      {scope.mode === 'pick' ? (
        <PagePicker pdf={pdf} selected={scope.picked} onChange={scope.setPicked} removed={isRemoved} />
      ) : (
        <PageGrid items={previewItems} ariaLabel="Preview: crossed-out pages will be deleted" />
      )}
      <ConfirmDialog
        open={confirming}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void run()}
        title={`Delete ${pluralize(removed.size, 'page')}?`}
        confirmLabel="Delete pages"
      >
        {removed.size === 1 ? `Page ${removedText} will be removed.` : `Pages ${removedText} will be removed.`} The new PDF will have{' '}
        {pluralize(remaining, 'page')}. Your original file stays unchanged.
      </ConfirmDialog>
    </>
  );
}
