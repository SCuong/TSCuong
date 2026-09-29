import { useId, useMemo, useState } from 'react';
import { Scissors } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { ErrorMessage } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input, Label, NumberInput } from '@/components/ui/Field';
import { Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { pluralize } from '@/lib/utils';
import { chunkPages, formatPageList, parseRangeGroups } from './lib/ranges';
import { outputName, pdfBlob, splitFileNames, type OutputFile } from './lib/files';
import { runPdfOp } from './lib/runner';
import { docId } from './lib/thumbnails';
import { PdfInput, useEncryptionGate } from './components/PdfInput';
import { usePdfFile, type LoadedPdf } from './components/usePdfFile';
import { JobProgress, ResultFiles } from './components/Results';
import { usePdfJob } from './components/usePdfJob';
import { useKeyedResult } from './components/useKeyedResult';

type Mode = 'single' | 'every' | 'ranges';

export default function SplitPdf() {
  const controller = usePdfFile();
  return (
    <ToolStack>
      <PdfInput controller={controller} title="Drop a PDF to split">
        {(pdf) => <SplitWorkspace key={docId(pdf.doc)} pdf={pdf} />}
      </PdfInput>
    </ToolStack>
  );
}

function SplitWorkspace({ pdf }: { pdf: LoadedPdf }) {
  const [mode, setMode] = useState<Mode>(pdf.pageCount > 1 ? 'single' : 'ranges');
  const [every, setEvery] = useState<number | ''>(2);
  const [ranges, setRanges] = useState('');
  const job = usePdfJob();
  const gate = useEncryptionGate(pdf, 'copy');
  const everyId = useId();
  const rangesId = useId();

  const plan = useMemo((): { groups: number[][]; error: string | null } => {
    if (mode === 'single') return { groups: chunkPages(pdf.pageCount, 1), error: null };
    if (mode === 'every') {
      if (every === '' || !Number.isInteger(every) || every < 1) return { groups: [], error: 'Enter a whole number of pages per file.' };
      return { groups: chunkPages(pdf.pageCount, every), error: null };
    }
    if (!ranges.trim()) return { groups: [], error: null };
    const r = parseRangeGroups(ranges, pdf.pageCount);
    return r.ok ? { groups: r.groups, error: null } : { groups: [], error: r.error };
  }, [mode, every, ranges, pdf.pageCount]);

  const inputKey = `${mode}|${JSON.stringify(plan.groups)}`;
  const result = useKeyedResult<OutputFile[]>(inputKey);

  async function run() {
    const key = inputKey;
    const groups = plan.groups;
    result.clear();
    const out = await job.run(({ signal, progress }) =>
      runPdfOp(
        'split',
        { bytes: pdf.bytes, groups: groups.map((g) => g.map((p) => p - 1)), ignoreEncryption: gate.ignoreEncryption },
        { signal, onProgress: progress },
      ),
    );
    if (out) {
      const fileNames = splitFileNames(pdf.file.name, mode, groups, pdf.pageCount);
      result.set(
        key,
        out.map((bytes, i) => ({ name: fileNames[i], data: pdfBlob(bytes), type: 'application/pdf' })),
      );
    }
  }

  const preview = plan.groups.slice(0, 60);

  return (
    <>
      {gate.notice}
      <Panel title="How to split">
        <div className="flex flex-col gap-4">
          <Segmented
            className="self-start"
            label="Split mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'single', label: 'Every page' },
              { value: 'every', label: 'Every N pages' },
              { value: 'ranges', label: 'Custom ranges' },
            ]}
          />
          {mode === 'single' && (
            <p className="text-[13px] text-fg-secondary">
              Creates {pluralize(pdf.pageCount, 'PDF')}, one for each page.
            </p>
          )}
          {mode === 'every' && (
            <div className="w-40">
              <Label htmlFor={everyId}>Pages per file</Label>
              <NumberInput id={everyId} min={1} max={pdf.pageCount} step={1} value={every} onChange={setEvery} />
            </div>
          )}
          {mode === 'ranges' && (
            <div className="max-w-xl">
              <Label htmlFor={rangesId}>Ranges (one file per comma-separated item)</Label>
              <Input
                id={rangesId}
                mono
                value={ranges}
                placeholder="e.g. 1-3, 4-6, 7-  or  odd, even"
                onChange={(e) => setRanges(e.target.value)}
                aria-invalid={plan.error ? true : undefined}
              />
              <p className="mt-1.5 text-[12.5px] text-fg-muted">
                Each item becomes one PDF. Use "last" for the final page, "8-" for page 8 to the end.
              </p>
            </div>
          )}
          <ErrorMessage error={plan.error} />
          {plan.groups.length > 0 && (
            <div>
              <p className="mb-2 text-[12.5px] font-medium text-fg-secondary">
                {pluralize(plan.groups.length, 'file')} will be created
              </p>
              <ul className="flex flex-wrap gap-1.5" aria-label="Files that will be created">
                {preview.map((g, i) => (
                  <li
                    key={i}
                    className="rounded-md border border-line bg-surface-sunken px-2 py-1 text-[12px] text-fg-secondary tabular-nums"
                  >
                    <span className="text-fg-muted">#{i + 1}</span> {g.length === 1 ? `page ${g[0]}` : `pages ${formatPageList(g)}`}
                  </li>
                ))}
                {plan.groups.length > preview.length && (
                  <li className="px-2 py-1 text-[12px] text-fg-muted">+{plan.groups.length - preview.length} more</li>
                )}
              </ul>
            </div>
          )}
          <div>
            <Button
              variant="primary"
              icon={Scissors}
              disabled={!gate.ok || plan.groups.length === 0 || job.running}
              loading={job.running}
              onClick={() => void run()}
            >
              Split PDF
            </Button>
          </div>
        </div>
      </Panel>
      <JobProgress running={job.running} progress={job.progress} label={job.label} onCancel={job.cancel} />
      <ErrorMessage error={job.error} title="Split failed" />
      <ResultFiles files={result.value ?? []} zipName={outputName(pdf.file.name, 'split', 'zip')} />
    </>
  );
}
