import { useMemo, useState } from 'react';
import { FilePlus, FileText, RotateCcw } from 'lucide-react';
import { Dialog } from '@/components/ui/Dialog';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { CopyButton, DownloadButton } from '@/components/ui/Actions';
import { FileDrop } from '@/components/ui/FileDrop';
import { Label, Textarea } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { cn, errorMessage, formatBytes } from '@/lib/utils';
import { applyFilePatch, type ApplyOutcome, type HunkConflict } from '../lib/applyPatch';
import { displayPath, type DiffFile } from '../lib/diffParse';

const MAX_SIZE = 20 * 1024 * 1024;

function baseName(path: string | null): string {
  if (!path) return 'patched.txt';
  const parts = path.split('/');
  return parts[parts.length - 1] || 'patched.txt';
}

function countLines(text: string): number {
  if (!text) return 0;
  const lines = text.split(String.fromCharCode(10));
  if (lines[lines.length - 1] === '') lines.pop();
  return lines.length;
}

interface Source {
  name: string;
  text: string;
}

export function ApplyPatchDialog({ file, onClose }: { file: DiffFile | null; onClose: () => void }) {
  return (
    <Dialog
      open={file !== null}
      onClose={onClose}
      size="lg"
      title="Apply patch to a file"
      description={file ? displayPath(file) : undefined}
    >
      {file && <ApplyBody key={displayPath(file)} file={file} />}
    </Dialog>
  );
}

function ApplyBody({ file }: { file: DiffFile }) {
  const [source, setSource] = useState<Source | null>(null);
  const [pasted, setPasted] = useState('');
  const [fuzz, setFuzz] = useState<'0' | '1' | '2'>('0');
  const [readError, setReadError] = useState<string | null>(null);
  const createsFile = file.hunks.length > 0 && file.hunks.every((h) => h.oldStart === 0 && h.oldLines === 0);

  const outcome = useMemo<ApplyOutcome | null>(() => (source ? applyFilePatch(source.text, file, Number(fuzz)) : null), [source, file, fuzz]);
  const outName = baseName(file.newPath ?? file.oldPath);

  async function readFile(f: File) {
    setReadError(null);
    try {
      const buffer = await f.arrayBuffer();
      const bytes = new Uint8Array(buffer.slice(0, 8000));
      if (bytes.includes(0)) {
        setReadError('This looks like a binary file. Patches can only be applied to text files.');
        return;
      }
      const text = new TextDecoder('utf-8').decode(buffer);
      setSource({ name: f.name, text: text.charCodeAt(0) === 0xfeff ? text.slice(1) : text });
    } catch (error) {
      setReadError(errorMessage(error, 'Could not read the file.'));
    }
  }

  if (!source) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-[13px] leading-relaxed text-fg-secondary">
          Provide the original version of <span className="font-mono text-fg">{baseName(file.oldPath ?? file.newPath)}</span>. The{' '}
          {file.hunks.length === 1 ? 'hunk is' : `${file.hunks.length} hunks are`} applied in your browser and you can download the result.
        </p>
        {createsFile && (
          <Alert
            tone="info"
            title="This patch creates a new file"
            action={
              <Button size="sm" variant="primary" icon={FilePlus} onClick={() => setSource({ name: '(new file)', text: '' })}>
                Create it
              </Button>
            }
          >
            No original is needed.
          </Alert>
        )}
        <FileDrop
          onFiles={(files) => void readFile(files[0])}
          maxSize={MAX_SIZE}
          compact
          icon={FileText}
          title="Drop the original file"
          hint={`Any text file up to ${formatBytes(MAX_SIZE)}. It stays on this device.`}
        />
        {readError && (
          <p role="alert" className="text-[13px] text-danger">
            {readError}
          </p>
        )}
        <div>
          <Label htmlFor="apply-paste">…or paste its contents</Label>
          <Textarea id="apply-paste" value={pasted} onChange={(e) => setPasted(e.target.value)} rows={6} placeholder="Original file text" />
          <Button size="sm" variant="primary" className="mt-2" disabled={!pasted} onClick={() => setSource({ name: 'pasted text', text: pasted })}>
            Apply to pasted text
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-[13px] text-fg-secondary">
          Original: <span className="font-mono break-all text-fg">{source.name}</span>{' '}
          <span className="text-fg-muted">({countLines(source.text)} lines)</span>
        </p>
        <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setSource(null)}>
          Choose another
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Label className="mb-0">Fuzz</Label>
        <Segmented
          label="Fuzz factor"
          size="sm"
          value={fuzz}
          onChange={setFuzz}
          options={[
            { value: '0', label: 'Exact', title: 'Every context line must match' },
            { value: '1', label: '1 line', title: 'Allow one mismatching context line per hunk' },
            { value: '2', label: '2 lines', title: 'Allow two mismatching context lines per hunk' },
          ]}
        />
        <span className="text-[12px] text-fg-muted">Hunks may also shift up or down to find their place.</span>
      </div>
      {outcome && <OutcomeView outcome={outcome} outName={outName} fuzz={fuzz} />}
    </div>
  );
}

function OutcomeView({ outcome, outName, fuzz }: { outcome: ApplyOutcome; outName: string; fuzz: string }) {
  if (outcome.ok) {
    return (
      <>
        <Alert
          tone="success"
          title="Patch applied"
          action={
            <div className="flex gap-1.5">
              <CopyButton value={outcome.text} />
              <DownloadButton data={outcome.text} filename={outName} variant="primary" label={`Download ${outName}`} />
            </div>
          }
        >
          {outcome.text === '' ? 'The result is empty (the patch removes all content).' : `${countLines(outcome.text)} lines.`}
        </Alert>
        <Textarea value={outcome.text} readOnly rows={12} aria-label="Patched file" className="whitespace-pre" wrap="off" />
      </>
    );
  }
  if (outcome.reason !== 'conflict') {
    return <Alert tone="warning">{outcome.message}</Alert>;
  }
  return (
    <>
      <Alert tone={outcome.alreadyApplied ? 'warning' : 'danger'} title={outcome.alreadyApplied ? 'Already applied' : 'The patch does not apply'}>
        {outcome.message}
        {!outcome.alreadyApplied && fuzz === '0' && ' You can try a higher fuzz factor if only nearby context lines differ.'}
      </Alert>
      {!outcome.alreadyApplied && <ConflictView conflict={outcome.conflict} />}
    </>
  );
}

function ConflictView({ conflict }: { conflict: HunkConflict }) {
  const rows = Math.max(conflict.expected.length, conflict.actual.length);
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <LinesBox
        title="Patch expects"
        lines={conflict.expected}
        start={conflict.actualStart}
        mismatch={conflict.firstMismatch}
        rows={rows}
      />
      <LinesBox
        title={`Your file at line ${conflict.actualStart}`}
        lines={conflict.actual}
        start={conflict.actualStart}
        mismatch={conflict.firstMismatch}
        rows={rows}
      />
    </div>
  );
}

function LinesBox({ title, lines, start, mismatch, rows }: { title: string; lines: string[]; start: number; mismatch: number; rows: number }) {
  return (
    <div className="min-w-0 rounded-lg border border-line">
      <p className="border-b border-line px-3 py-1.5 text-[12px] font-medium text-fg-secondary">{title}</p>
      <div className="max-h-56 overflow-auto">
        <table className="min-w-full font-mono text-[12px] leading-5">
          <tbody>
            {Array.from({ length: rows }, (_, i) => (
              <tr key={i} className={cn(i === mismatch && 'bg-[var(--lk-diff-del)]')}>
                <td className="w-[1%] px-2 text-right text-fg-muted tabular-nums select-none">{start + i}</td>
                <td className="pr-3 whitespace-pre text-fg">{lines[i] ?? (i === lines.length ? <span className="font-sans text-fg-muted italic">(end of file)</span> : '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
