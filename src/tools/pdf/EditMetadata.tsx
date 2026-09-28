import { useEffect, useId, useState } from 'react';
import { Eraser, Save, Tags } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Checkbox, Input, Label, Textarea } from '@/components/ui/Field';
import { KeyValueList, Panel } from '@/components/ui/Panel';
import { Spinner } from '@/components/ui/Feedback';
import { EMPTY_METADATA, parsePdfDate, type MetadataFields } from './lib/metadata';
import { outputName, pdfBlob, type OutputFile } from './lib/files';
import { runPdfOp } from './lib/runner';
import { docId } from './lib/thumbnails';
import { PdfInput, useEncryptionGate } from './components/PdfInput';
import { usePdfFile, type LoadedPdf } from './components/usePdfFile';
import { JobProgress, ResultFiles } from './components/Results';
import { usePdfJob } from './components/usePdfJob';
import { isoToLocalInput, localInputToIso } from './lib/dates';

export default function EditMetadata() {
  const controller = usePdfFile();
  return (
    <ToolStack>
      <PdfInput controller={controller} title="Drop a PDF to view or edit its metadata">
        {(pdf) => <MetadataWorkspace key={docId(pdf.doc)} pdf={pdf} />}
      </PdfInput>
    </ToolStack>
  );
}

interface Loaded {
  fields: MetadataFields;
  custom: Array<{ key: string; value: string }>;
  hasXmp: boolean;
}

const TEXT_FIELDS: Array<{ key: keyof MetadataFields; label: string; multiline?: boolean; hint?: string }> = [
  { key: 'title', label: 'Title' },
  { key: 'author', label: 'Author' },
  { key: 'subject', label: 'Subject', multiline: true },
  { key: 'keywords', label: 'Keywords', hint: 'Usually separated by commas.' },
  { key: 'creator', label: 'Creator', hint: 'The app that created the original document.' },
  { key: 'producer', label: 'Producer', hint: 'The app that produced the PDF.' },
];

async function readWithPdfjs(pdf: LoadedPdf): Promise<Loaded> {
  const meta = await pdf.doc.getMetadata();
  const info = (meta.info ?? {}) as Record<string, unknown>;
  const text = (k: string) => (typeof info[k] === 'string' ? (info[k] as string) : '');
  const date = (k: string) => {
    const d = text(k) ? parsePdfDate(text(k)) : null;
    return d ? d.toISOString() : '';
  };
  const customRaw = (info.Custom ?? {}) as Record<string, unknown>;
  return {
    fields: {
      title: text('Title'),
      author: text('Author'),
      subject: text('Subject'),
      keywords: text('Keywords'),
      creator: text('Creator'),
      producer: text('Producer'),
      creationDate: date('CreationDate'),
      modDate: date('ModDate'),
    },
    custom: Object.entries(customRaw).map(([key, value]) => ({
      key,
      value: typeof value === 'string' ? value : typeof value === 'object' && value && 'name' in value ? String((value as { name: string }).name) : String(value),
    })),
    hasXmp: Boolean(meta.metadata),
  };
}

function MetadataWorkspace({ pdf }: { pdf: LoadedPdf }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fields, setFields] = useState<MetadataFields>(EMPTY_METADATA);
  const [removeXmp, setRemoveXmp] = useState(true);
  const [confirmStrip, setConfirmStrip] = useState(false);
  const [result, setResult] = useState<OutputFile | null>(null);
  const job = usePdfJob();
  const gate = useEncryptionGate(pdf);
  const baseId = useId();

  useEffect(() => {
    let alive = true;
    readWithPdfjs(pdf)
      .then((data) => {
        if (!alive) return;
        setLoaded(data);
        setFields(data.fields);
      })
      .catch(() => alive && setLoadError('The metadata could not be read.'));
    return () => {
      alive = false;
    };
  }, [pdf]);

  const set = (key: keyof MetadataFields, value: string) => {
    setResult(null);
    setFields((f) => ({ ...f, [key]: value }));
  };

  const changed = loaded ? (Object.keys(fields) as Array<keyof MetadataFields>).some((k) => fields[k] !== loaded.fields[k]) : false;

  async function save(removeAll: boolean) {
    setConfirmStrip(false);
    setResult(null);
    const bytes = await job.run(({ signal, progress }) =>
      runPdfOp(
        'setMetadata',
        { bytes: pdf.bytes, fields, removeAll, removeXmp: removeAll || (loaded?.hasXmp ? removeXmp : false), ignoreEncryption: gate.ignoreEncryption },
        { signal, onProgress: progress },
      ),
    );
    if (bytes) {
      setResult({ name: outputName(pdf.file.name, removeAll ? 'no-metadata' : 'metadata'), data: pdfBlob(bytes), type: 'application/pdf' });
      if (removeAll) setFields(EMPTY_METADATA);
    }
  }

  if (loadError) return <ErrorMessage error={loadError} />;
  if (!loaded) return <Spinner label="Reading metadata…" />;

  return (
    <>
      {gate.notice}
      <Panel title="Document information" description="Leave a field empty to remove it.">
        <div className="grid gap-4 sm:grid-cols-2">
          {TEXT_FIELDS.map((f) => (
            <div key={f.key} className={f.multiline ? 'sm:col-span-2' : undefined}>
              <Label htmlFor={`${baseId}-${f.key}`}>{f.label}</Label>
              {f.multiline ? (
                <Textarea
                  id={`${baseId}-${f.key}`}
                  mono={false}
                  rows={2}
                  value={fields[f.key]}
                  onChange={(e) => set(f.key, e.target.value)}
                  className="resize-y"
                />
              ) : (
                <Input id={`${baseId}-${f.key}`} value={fields[f.key]} onChange={(e) => set(f.key, e.target.value)} />
              )}
              {f.hint && <p className="mt-1 text-[12px] text-fg-muted">{f.hint}</p>}
            </div>
          ))}
          {(['creationDate', 'modDate'] as const).map((key) => (
            <div key={key}>
              <Label htmlFor={`${baseId}-${key}`}>{key === 'creationDate' ? 'Created' : 'Modified'}</Label>
              <div className="flex gap-2">
                <Input
                  id={`${baseId}-${key}`}
                  type="datetime-local"
                  step={1}
                  value={isoToLocalInput(fields[key])}
                  onChange={(e) => set(key, localInputToIso(e.target.value))}
                />
                <Button size="md" variant="secondary" onClick={() => set(key, new Date().toISOString())}>
                  Now
                </Button>
              </div>
              <p className="mt-1 text-[12px] text-fg-muted">Your local time; saved in UTC.</p>
            </div>
          ))}
        </div>
        {loaded.custom.length > 0 && (
          <div className="mt-5">
            <p className="mb-1 text-[13px] font-medium text-fg-secondary">Custom properties (kept as they are)</p>
            <KeyValueList items={loaded.custom.map((c) => ({ key: c.key, label: c.key, value: c.value || '—' }))} />
          </div>
        )}
        <div className="mt-5 flex flex-col gap-3 border-t border-line pt-4">
          {loaded.hasXmp && (
            <Checkbox
              label="Also remove the XMP metadata packet"
              description="PDF viewers often prefer XMP over the fields above, so leaving an outdated packet can make your changes invisible."
              checked={removeXmp}
              onChange={setRemoveXmp}
            />
          )}
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={Save} disabled={!gate.ok || job.running || (!changed && !(loaded.hasXmp && removeXmp))} loading={job.running} onClick={() => void save(false)}>
              Save metadata
            </Button>
            <Button variant="secondary" icon={Eraser} disabled={!gate.ok || job.running} onClick={() => setConfirmStrip(true)}>
              Remove all metadata
            </Button>
            {changed && (
              <Button variant="ghost" onClick={() => setFields(loaded.fields)}>
                Revert changes
              </Button>
            )}
          </div>
        </div>
      </Panel>
      {pdf.encrypted && gate.ok && (
        <Alert tone="info">Metadata strings of encrypted PDFs are stored encrypted; values written here may not display correctly.</Alert>
      )}
      <JobProgress running={job.running} progress={job.progress} label={job.label} onCancel={job.cancel} />
      <ErrorMessage error={job.error} title="Could not save" />
      {result && <ResultFiles files={[result]} title="PDF saved with the new metadata" />}
      <ConfirmDialog
        open={confirmStrip}
        onCancel={() => setConfirmStrip(false)}
        onConfirm={() => void save(true)}
        title="Remove all metadata?"
        confirmLabel="Remove metadata"
      >
        The new PDF will have no title, author, dates, producer, keywords, custom properties or XMP packet. Pages are not changed.
      </ConfirmDialog>
      <p className="flex items-center gap-1.5 text-[12.5px] text-fg-muted">
        <Tags size={13} aria-hidden /> Your original file is never modified: a new copy is created.
      </p>
    </>
  );
}
