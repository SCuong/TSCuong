import { useEffect, useMemo, useState } from 'react';
import { CircleCheck, CircleX, FingerprintPattern, RotateCcw, X } from 'lucide-react';
import { ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { FileDrop } from '@/components/ui/FileDrop';
import { Button, IconButton } from '@/components/ui/Button';
import { Checkbox, Label, Textarea } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Panel';
import { ProgressBar } from '@/components/ui/Feedback';
import { CopyButton, DownloadButton } from '@/components/ui/Actions';
import { ErrorMessage } from '@/components/ui/Alert';
import { useAsyncJob, useToolState } from '@/lib/hooks';
import { cn, errorMessage, formatBytes, pluralize } from '@/lib/utils';
import { algoLabel, checksumFile, HASH_ALGOS, hashBlob, parseExpected, verify, type HashAlgo } from './lib/fileHash';

interface Row {
  id: number;
  file: File;
  digests: Partial<Record<HashAlgo, string>>;
  status: 'queued' | 'hashing' | 'done' | 'error' | 'cancelled';
  error?: string;
}

let seq = 0;

export default function FileHasher() {
  const [algos, setAlgos] = useToolState<HashAlgo[]>('file-hasher', 'algos', ['md5', 'sha1', 'sha256']);
  const [expectedText, setExpectedText] = useState('');
  const [uppercase, setUppercase] = useToolState('file-hasher', 'upper', false);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const job = useAsyncJob();

  const expected = useMemo(() => parseExpected(expectedText), [expectedText]);
  const selected = HASH_ALGOS.filter((a) => algos.includes(a.id)).map((a) => a.id);

  async function hashAll(list: Row[], chosen: HashAlgo[]) {
    if (!list.length || !chosen.length) return;
    setError(null);
    const total = list.reduce((n, r) => n + r.file.size, 0) || 1;
    let before = 0;
    try {
      await job.run(async ({ signal, progress }) => {
        for (const row of list) {
          setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, status: 'hashing', error: undefined } : r)));
          try {
            const digests = await hashBlob(row.file, chosen, {
              signal,
              onProgress: (done) => progress((before + done) / total, `Hashing ${row.file.name}`),
            });
            setRows((rs) => rs.map((r) => (r.id === row.id ? { ...r, digests, status: 'done' } : r)));
          } catch (e) {
            if (signal.aborted) throw e;
            setRows((rs) =>
              rs.map((r) =>
                r.id === row.id
                  ? {
                      ...r,
                      status: 'error',
                      error: errorMessage(e, 'The file could not be read.'),
                    }
                  : r,
              ),
            );
          }
          before += row.file.size;
        }
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        setRows((rs) => rs.map((r) => (r.status === 'hashing' || r.status === 'queued' ? { ...r, status: 'cancelled' } : r)));
      } else setError(errorMessage(e, 'Hashing failed.'));
    }
  }

  function addFiles(files: File[]) {
    const added: Row[] = files.map((file) => ({
      id: ++seq,
      file,
      digests: {},
      status: 'queued',
    }));
    setRows((rs) => [...rs, ...added]);
  }

  // Process queued files whenever the hasher is idle (new drops while hashing wait their turn).
  const selectedKey = selected.join(',');
  useEffect(() => {
    if (job.running || !selectedKey) return;
    const queued = rows.filter((r) => r.status === 'queued');
    if (queued.length) void hashAll(queued, selectedKey.split(',') as HashAlgo[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.running, rows, selectedKey]);

  function toggleAlgo(id: HashAlgo, on: boolean) {
    setAlgos((list) => (on ? [...new Set([...list, id])] : list.filter((x) => x !== id)));
  }

  // Rows missing a selected digest (after changing algorithms) can be re-run.
  const stale = rows.filter((r) => r.status !== 'hashing' && r.status !== 'queued' && selected.some((a) => !r.digests[a]));
  const fmt = (h: string) => (uppercase ? h.toUpperCase() : h);
  const doneRows = rows.filter((r) => r.status === 'done');
  const verdicts = doneRows.map((r) => verify(r.file.name, r.digests, expected));
  const matched = verdicts.filter((v) => v.status === 'match').length;
  const mismatched = verdicts.filter((v) => v.status === 'mismatch').length;

  return (
    <ToolStack>
      <ToolBar>
        <div className="min-w-0">
          <Label>Algorithms</Label>
          <div className="flex flex-wrap gap-x-4 gap-y-2 pt-1">
            {HASH_ALGOS.map((a) => (
              <Checkbox key={a.id} label={a.label} checked={algos.includes(a.id)} onChange={(on) => toggleAlgo(a.id, on)} />
            ))}
          </div>
        </div>
        <Checkbox label="Uppercase hex" checked={uppercase} onChange={setUppercase} />
      </ToolBar>
      <FileDrop
        multiple
        onFiles={addFiles}
        icon={FingerprintPattern}
        compact={rows.length > 0}
        title="Drop files to hash"
        hint="Files are read in 4 MB chunks, so multi-gigabyte files work. Nothing is uploaded."
      />
      <div>
        <Label htmlFor="expected-hash">Expected hash or checksum list (optional)</Label>
        <Textarea
          id="expected-hash"
          value={expectedText}
          onChange={(e) => setExpectedText(e.target.value)}
          rows={3}
          placeholder={'Paste a hash to compare, or a SHA256SUMS / .md5 file:\ne3b0c44298fc1c149afbf4c8996fb924…  file.iso'}
          className="resize-y"
        />
        {expectedText.trim() && !expected.length && (
          <p className="mt-1.5 text-[12.5px] text-danger" role="alert">
            No hexadecimal hash found in that text.
          </p>
        )}
        {expected.length > 0 && (
          <p className="mt-1.5 text-[12.5px] text-fg-muted">
            {pluralize(expected.length, 'expected hash', 'expected hashes')}
            {doneRows.length > 0 && (
              <>
                {' · '}
                <span className={matched ? 'text-success' : undefined}>{matched} matched</span>
                {mismatched > 0 && <span className="text-danger"> · {mismatched} mismatched</span>}
              </>
            )}
          </p>
        )}
      </div>
      <ErrorMessage error={error} />
      {selected.length === 0 && <p className="text-[13px] text-warning">Select at least one algorithm.</p>}
      {job.running && <ProgressBar value={job.progress} label={job.label} onCancel={job.cancel} />}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[13px] text-fg-secondary">
            {pluralize(rows.length, 'file')} · {formatBytes(rows.reduce((n, r) => n + r.file.size, 0))}
          </p>
          <div className="flex flex-wrap gap-2">
            {stale.length > 0 && !job.running && selected.length > 0 && (
              <Button size="sm" icon={RotateCcw} onClick={() => void hashAll(stale, selected)}>
                Hash {stale.length === rows.length ? 'all' : pluralize(stale.length, 'file')} again
              </Button>
            )}
            {doneRows.length > 0 &&
              (['sha256', 'md5', 'sha512', 'sha1', 'sha384', 'crc32'] as HashAlgo[])
                .filter((a) => selected.includes(a) && doneRows.every((r) => r.digests[a]))
                .slice(0, 2)
                .map((a) => (
                  <DownloadButton
                    key={a}
                    label={`${algoLabel(a)} list`}
                    filename={doneRows.length === 1 ? `${doneRows[0].file.name}.${a}` : `checksums.${a}`}
                    data={() =>
                      checksumFile(
                        doneRows.map((r) => ({
                          name: r.file.name,
                          hash: fmt(r.digests[a]!),
                        })),
                      )
                    }
                  />
                ))}
            <Button size="sm" variant="ghost" disabled={job.running} onClick={() => setRows([])}>
              Clear
            </Button>
          </div>
        </div>
      )}
      <ul className="flex flex-col gap-3">
        {rows.map((r) => {
          const verdict = r.status === 'done' ? verify(r.file.name, r.digests, expected) : { status: 'none' as const };
          return (
            <li
              key={r.id}
              className={cn(
                'rounded-xl border bg-surface p-4 shadow-card',
                verdict.status === 'match' ? 'border-success/50' : verdict.status === 'mismatch' ? 'border-danger/50' : 'border-line',
              )}
            >
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="min-w-0 truncate text-[14px] font-semibold text-fg" title={r.file.name}>
                      {r.file.name}
                    </p>
                    <span className="text-[12.5px] text-fg-muted">{formatBytes(r.file.size)}</span>
                    {r.status === 'hashing' && <Badge tone="accent">Hashing…</Badge>}
                    {r.status === 'queued' && <Badge>Queued</Badge>}
                    {r.status === 'cancelled' && <Badge tone="warning">Cancelled</Badge>}
                    {verdict.status === 'match' && (
                      <Badge tone="success">
                        <CircleCheck size={12} aria-hidden /> {algoLabel(verdict.algo)} matches
                      </Badge>
                    )}
                    {verdict.status === 'mismatch' && (
                      <Badge tone="danger">
                        <CircleX size={12} aria-hidden /> {verdict.algo ? `${algoLabel(verdict.algo)} mismatch` : 'No match'}
                      </Badge>
                    )}
                  </div>
                  {r.error && <p className="mt-1 text-[13px] text-danger">{r.error}</p>}
                  {verdict.status === 'mismatch' && verdict.algo && !verdict.computed && (
                    <p className="mt-1 text-[12.5px] text-warning">
                      The expected hash looks like {algoLabel(verdict.algo)}, which is not selected. Enable it and hash again.
                    </p>
                  )}
                </div>
                <IconButton
                  icon={X}
                  size="sm"
                  label={`Remove ${r.file.name}`}
                  disabled={r.status === 'hashing'}
                  onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                />
              </div>
              {Object.keys(r.digests).length > 0 && (
                <dl className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface-sunken">
                  {HASH_ALGOS.filter((a) => r.digests[a.id]).map((a) => {
                    const value = fmt(r.digests[a.id]!);
                    const hit = verdict.status === 'match' && verdict.algo === a.id;
                    return (
                      // A <dl> group may only contain <dt>/<dd>, so the copy button lives inside the <dd>.
                      <div key={a.id} className="flex items-center gap-3 px-3 py-1.5">
                        <dt className="w-16 shrink-0 text-[12px] font-medium text-fg-muted">{a.label}</dt>
                        <dd className="flex min-w-0 flex-1 items-center gap-3">
                          <span className={cn('min-w-0 flex-1 font-mono text-[12.5px] break-all', hit ? 'text-success' : 'text-fg')}>{value}</span>
                          <CopyButton value={value} iconOnly label={`Copy ${a.label}`} />
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              )}
            </li>
          );
        })}
      </ul>
    </ToolStack>
  );
}
