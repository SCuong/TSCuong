import { useCallback, useMemo, useState } from 'react';
import { RotateCcw, RotateCw } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { ErrorMessage } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Label } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { pluralize } from '@/lib/utils';
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
import { verifyEncryptedEdit } from './components/verifyEdit';

type Angle = '90' | '180' | '270';

export default function RotatePdf() {
  const controller = usePdfFile();
  return (
    <ToolStack>
      <PdfInput controller={controller} title="Drop a PDF to rotate">
        {(pdf) => <RotateWorkspace key={docId(pdf.doc)} pdf={pdf} />}
      </PdfInput>
    </ToolStack>
  );
}

function RotateWorkspace({ pdf }: { pdf: LoadedPdf }) {
  const scope = usePageScope(pdf.pageCount, 'all');
  const [angle, setAngle] = useState<Angle>('90');
  const inputKey = `${angle}|${scope.pages.join(',')}`;
  const result = useKeyedResult<OutputFile>(inputKey);
  const job = usePdfJob();
  const gate = useEncryptionGate(pdf, 'structure');

  const affected = useMemo(() => new Set(scope.pages), [scope.pages]);
  const rotationOf = useCallback((i: number) => (affected.has(i) ? Number(angle) : 0), [affected, angle]);

  const previewItems = useMemo<GridItem[]>(
    () =>
      Array.from({ length: pdf.pageCount }, (_, i) => ({
        id: pageId(i),
        doc: pdf.doc,
        pageIndex: i,
        rotation: rotationOf(i),
        label: `Page ${i + 1}`,
        state: affected.has(i) ? 'highlight' : 'normal',
      })),
    [pdf, rotationOf, affected],
  );

  async function run() {
    const key = inputKey;
    result.clear();
    const bytes = await job.run(async ({ signal, progress }) => {
      const out = await runPdfOp(
        'rotate',
        { bytes: pdf.bytes, pages: scope.pages, angle: Number(angle), ignoreEncryption: gate.ignoreEncryption },
        { signal, onProgress: progress },
      );
      await verifyEncryptedEdit(pdf, out);
      return out;
    });
    if (bytes) result.set(key, { name: outputName(pdf.file.name, 'rotated'), data: pdfBlob(bytes), type: 'application/pdf' });
  }

  return (
    <>
      {gate.notice}
      <Panel>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
            <div>
              <Label>Rotation</Label>
              <Segmented
                label="Rotation"
                value={angle}
                onChange={setAngle}
                options={[
                  { value: '270', label: '90° left', icon: RotateCcw },
                  { value: '90', label: '90° right', icon: RotateCw },
                  { value: '180', label: '180°' },
                ]}
              />
            </div>
            <PageScopeControl scope={scope} label="Pages to rotate" pickLabel="Select pages" />
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <Button
              variant="primary"
              icon={angle === '270' ? RotateCcw : RotateCw}
              disabled={!gate.ok || scope.pages.length === 0 || Boolean(scope.error) || job.running}
              loading={job.running}
              onClick={() => void run()}
            >
              Rotate {scope.pages.length ? pluralize(scope.pages.length, 'page') : 'pages'}
            </Button>
            <span className="text-[13px] text-fg-muted">The preview below shows the result. Rotation adds to any existing page rotation.</span>
          </div>
        </div>
      </Panel>
      <JobProgress running={job.running} progress={job.progress} label={job.label} onCancel={job.cancel} />
      <ErrorMessage error={job.error} title="Rotation failed" />
      {result.value && <ResultFiles files={[result.value]} />}
      {scope.mode === 'pick' ? (
        <PagePicker pdf={pdf} selected={scope.picked} onChange={scope.setPicked} rotation={rotationOf} />
      ) : (
        <PageGrid items={previewItems} ariaLabel="Preview of rotated pages" />
      )}
    </>
  );
}
