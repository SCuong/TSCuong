import { useState } from 'react';
import { CircleCheck, FileSearch, TriangleAlert, X } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { FileDrop } from '@/components/ui/FileDrop';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Panel';
import { Checkbox } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Feedback';
import { CopyButton } from '@/components/ui/Actions';
import { errorMessage, formatBytes, pluralize } from '@/lib/utils';
import { asciiPreview, detectFileType, extensionMatches, extensionOf, hexPreview, type FileType } from './lib/magic';

interface Row {
  id: number;
  file: File;
  type: FileType | null;
  head: Uint8Array;
  error?: string;
}

let seq = 0;
const HEAD = 64 * 1024;
const TAIL = 1024;

async function inspect(file: File): Promise<Row> {
  try {
    const head = new Uint8Array(await file.slice(0, HEAD).arrayBuffer());
    const tail = file.size > HEAD ? new Uint8Array(await file.slice(Math.max(0, file.size - TAIL)).arrayBuffer()) : undefined;
    return {
      id: ++seq,
      file,
      head,
      type: detectFileType({ head, tail, size: file.size }),
    };
  } catch (e) {
    return {
      id: ++seq,
      file,
      head: new Uint8Array(0),
      type: null,
      error: errorMessage(e, 'The file could not be read.'),
    };
  }
}

export default function FileTypeDetector() {
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [onlyMismatch, setOnlyMismatch] = useState(false);

  async function add(files: File[]) {
    setBusy(true);
    const out: Row[] = [];
    for (const f of files) out.push(await inspect(f));
    setRows((r) => [...out, ...r]);
    setBusy(false);
  }

  const mismatch = (r: Row) => Boolean(r.type && !extensionMatches(r.type, r.file.name));
  const mismatches = rows.filter(mismatch).length;
  const shown = onlyMismatch ? rows.filter(mismatch) : rows;

  return (
    <ToolStack>
      <FileDrop
        multiple
        onFiles={(f) => void add(f)}
        icon={FileSearch}
        compact={rows.length > 0}
        title="Drop any files to identify them"
        hint="Only the first 64 KB (and last 1 KB) of each file is read, so huge files are fine. Nothing is uploaded."
      />
      {busy && <Spinner label="Reading files…" />}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-fg-secondary">
            {pluralize(rows.length, 'file')}
            {mismatches > 0 ? (
              <span className="ml-2 font-medium text-warning">· {pluralize(mismatches, 'extension mismatch', 'extension mismatches')}</span>
            ) : (
              <span className="ml-2 text-success">· all extensions match</span>
            )}
          </p>
          <div className="flex items-center gap-3">
            <Checkbox label="Only mismatches" checked={onlyMismatch} onChange={setOnlyMismatch} />
            <Button size="sm" variant="ghost" onClick={() => setRows([])}>
              Clear
            </Button>
          </div>
        </div>
      )}
      <ul className="flex flex-col gap-3">
        {shown.map((r) => {
          const bad = mismatch(r);
          const ext = extensionOf(r.file.name);
          return (
            <li key={r.id} className="rounded-xl border border-line bg-surface p-4 shadow-card">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 truncate text-[14px] font-semibold text-fg" title={r.file.name}>
                      {r.file.name}
                    </p>
                    {r.type && <Badge tone="accent">{r.type.name}</Badge>}
                    {r.type && (bad ? <Badge tone="warning">Mismatch</Badge> : <Badge tone="success">Extension OK</Badge>)}
                  </div>
                  {r.error && <p className="mt-1 text-[13px] text-danger">{r.error}</p>}
                  {r.type && bad && (
                    <p className="mt-1.5 flex items-start gap-1.5 text-[13px] text-warning">
                      <TriangleAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
                      <span>
                        {ext
                          ? `The name says .${ext}, but the contents are ${r.type.name}.`
                          : `The file has no extension; the contents are ${r.type.name}.`}
                        {r.type.exts.filter(Boolean).length > 0 && ` Expected .${r.type.exts.filter(Boolean).slice(0, 3).join(', .')}.`}
                      </span>
                    </p>
                  )}
                  {r.type && !bad && r.type.id !== 'binary' && r.type.id !== 'empty' && (
                    <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-fg-muted">
                      <CircleCheck size={13} className="text-success" aria-hidden /> Contents match the file name.
                    </p>
                  )}
                  <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <dt className="text-fg-muted">Detected MIME</dt>
                      <dd className="font-mono break-all text-fg">{r.type?.mime ?? '—'}</dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Browser-reported type</dt>
                      <dd className="font-mono break-all text-fg">{r.file.type || '(none)'}</dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Size</dt>
                      <dd className="font-mono text-fg">
                        {formatBytes(r.file.size)}
                        {r.file.size >= 1024 && <span className="text-fg-muted"> ({r.file.size.toLocaleString()} B)</span>}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-fg-muted">Last modified</dt>
                      <dd className="text-fg">{r.file.lastModified ? new Date(r.file.lastModified).toLocaleString() : '—'}</dd>
                    </div>
                  </dl>
                  {r.head.length > 0 && (
                    <div className="mt-3 rounded-lg border border-line bg-surface-sunken px-3 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[12px] text-fg-muted">First {Math.min(32, r.head.length)} bytes</span>
                        <CopyButton value={hexPreview(r.head, 32)} iconOnly label="Copy hex" />
                      </div>
                      <p className="overflow-x-auto font-mono text-[12.5px] whitespace-nowrap text-fg">{hexPreview(r.head, 32)}</p>
                      <p className="overflow-x-auto font-mono text-[12.5px] whitespace-pre text-fg-muted">{asciiPreview(r.head, 32)}</p>
                    </div>
                  )}
                </div>
                <IconButton
                  icon={X}
                  size="sm"
                  label={`Remove ${r.file.name}`}
                  onClick={() => setRows((l) => l.filter((x) => x.id !== r.id))}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </ToolStack>
  );
}
