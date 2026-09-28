import { useEffect, useMemo, useState } from 'react';
import { CircleCheck, CircleX, FileCheck } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Field, Select, Textarea } from '@/components/ui/Field';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Badge, Panel } from '@/components/ui/Panel';
import { EmptyState, ProgressBar } from '@/components/ui/Feedback';
import { FileDrop } from '@/components/ui/FileDrop';
import { useAsyncJob } from '@/lib/hooks';
import { cn, errorMessage, formatBytes } from '@/lib/utils';
import { bytesToHex, equalBytes } from './shared-a/bytes';
import { compareDigests, parseExpectedHash } from './lib/checksum';
import { HASH_ALGORITHMS, getAlgorithm, hashBlob, isAlgorithmId, type DigestMap, type HashAlgorithmId } from './lib/hash';
import { DigestRow, FileChip } from './shared-a/ui';

interface Computed {
  file: File;
  ids: HashAlgorithmId[];
  digests: DigestMap;
}

function listLabels(ids: HashAlgorithmId[]): string {
  return ids.map((id) => getAlgorithm(id).label).join(', ');
}

export default function ChecksumVerifier() {
  const [file, setFile] = useState<File | null>(null);
  const [expectedInput, setExpectedInput] = useState('');
  const [forced, setForced] = useState<'auto' | HashAlgorithmId>('auto');
  const [computed, setComputed] = useState<Computed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const job = useAsyncJob();
  const { run, cancel } = job;

  const parsed = useMemo(() => parseExpectedHash(expectedInput, file?.name), [expectedInput, file?.name]);
  const expected = parsed?.ok ? parsed.value : null;

  // Which algorithms to compute: the forced one, or every algorithm matching the digest length.
  const ids = useMemo<HashAlgorithmId[]>(() => {
    if (!expected) return [];
    if (forced !== 'auto') return [forced];
    return expected.candidates;
  }, [expected, forced]);
  const idsKey = ids.join(',');

  const forcedLengthError =
    expected && forced !== 'auto' && getAlgorithm(forced).bytes !== expected.bytes.length
      ? `${getAlgorithm(forced).label} digests are ${getAlgorithm(forced).bytes * 2} hex characters, but the expected hash is ${expected.bytes.length * 2}.`
      : null;

  const haveDigests = Boolean(computed && computed.file === file && ids.every((id) => computed.digests[id]));

  useEffect(() => {
    if (!file || !idsKey || haveDigests || forcedLengthError) return;
    const wanted = idsKey.split(',').filter(isAlgorithmId);
    setError(null);
    run(({ signal, progress }) =>
      hashBlob(file, wanted, {
        signal,
        onProgress: (fraction, done, total) => progress(fraction, `Hashing ${formatBytes(done)} of ${formatBytes(total)}`),
      }),
    )
      .then((digests) =>
        setComputed((prev) =>
          prev && prev.file === file
            ? { file, ids: [...new Set([...prev.ids, ...wanted])], digests: { ...prev.digests, ...digests } }
            : { file, ids: wanted, digests },
        ),
      )
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setError(errorMessage(e, 'Could not read the file.'));
      });
    return () => cancel();
  }, [file, idsKey, haveDigests, forcedLengthError, run, cancel]);

  const outcome = expected && haveDigests && computed && !forcedLengthError ? compareDigests(expected.bytes, computed.digests, ids) : null;
  const nameMismatch =
    expected?.filename && file && expected.filename.split(/[\\/]/).pop()!.toLowerCase() !== file.name.toLowerCase();

  return (
    <ToolStack>
      <div className="grid min-w-0 grid-cols-1 items-start gap-4 lg:grid-cols-2">
        <Panel title="1. File">
          {file ? (
            <div className="flex flex-col gap-3">
              <FileChip
                file={file}
                onClear={() => {
                  setFile(null);
                  setComputed(null);
                }}
              />
              {job.running && <ProgressBar value={job.progress} label={job.label || 'Starting…'} onCancel={cancel} />}
            </div>
          ) : (
            <FileDrop
              compact
              onFiles={(files) => {
                setFile(files[0]);
                setComputed(null);
              }}
              title="Drop the downloaded file"
              hint="Read in chunks on this device. Nothing is uploaded."
            />
          )}
        </Panel>

        <Panel title="2. Expected checksum">
          <div className="flex flex-col gap-3">
            <Field
              label="Expected hash"
              hint="Hex or Base64. Lines from sha256sum / SHA256SUMS files and “SHA256 (file) = …” work too."
              error={parsed && !parsed.ok ? parsed.error : null}
            >
              {({ id, describedBy, invalid }) => (
                <Textarea
                  id={id}
                  aria-describedby={describedBy}
                  aria-invalid={invalid || undefined}
                  value={expectedInput}
                  onChange={(e) => setExpectedInput(e.target.value)}
                  placeholder="e.g. e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
                  rows={3}
                  className="resize-y break-all"
                />
              )}
            </Field>
            <Field label="Algorithm">
              {({ id }) => (
                <Select id={id} value={forced} onChange={(e) => setForced(e.target.value as 'auto' | HashAlgorithmId)}>
                  <option value="auto">Auto-detect from length</option>
                  {HASH_ALGORITHMS.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {expected && (
              <p className="text-[12.5px] text-fg-muted">
                {expected.bytes.length * 2} hex characters ({expected.encoding === 'base64' ? 'Base64 input, ' : ''}
                {expected.bytes.length * 8}-bit){' '}
                {forced === 'auto' &&
                  (expected.hint
                    ? `· named as ${getAlgorithm(expected.hint).label}`
                    : expected.candidates.length > 1
                      ? `· could be ${listLabels(expected.candidates)}. All are checked.`
                      : `· ${getAlgorithm(expected.candidates[0]).label}`)}
              </p>
            )}
          </div>
        </Panel>
      </div>

      <ErrorMessage error={forcedLengthError ?? error} title={error ? 'Could not verify' : 'Length mismatch'} />
      {nameMismatch && (
        <Alert tone="info">
          The checksum line is for <span className="font-mono break-all">{expected!.filename}</span>, but the selected
          file is <span className="font-mono break-all">{file!.name}</span>. The content is compared either way.
        </Alert>
      )}

      {outcome && expected ? (
        <section
          aria-live="polite"
          className={cn(
            'flex flex-col overflow-hidden rounded-xl border shadow-card',
            outcome.match ? 'border-success/40' : 'border-danger/50',
          )}
        >
          <div className={cn('flex items-start gap-3 px-4 py-4', outcome.match ? 'bg-success-soft' : 'bg-danger-soft')}>
            {outcome.match ? (
              <CircleCheck size={26} className="mt-0.5 shrink-0 text-success" aria-hidden />
            ) : (
              <CircleX size={26} className="mt-0.5 shrink-0 text-danger" aria-hidden />
            )}
            <div className="min-w-0">
              <p className={cn('text-[16px] font-semibold', outcome.match ? 'text-success' : 'text-danger')}>
                {outcome.match ? 'Checksum matches' : 'Checksum does not match'}
              </p>
              <p className="mt-0.5 text-[13px] text-fg-secondary">
                {outcome.match
                  ? `The file's ${getAlgorithm(outcome.matchedAlgorithm!).label} digest is identical to the expected value. The file is intact.`
                  : ids.length > 1
                    ? `None of ${listLabels(ids)} produced the expected value. The file is corrupted, a different version, or the checksum is for another file.`
                    : `The file's ${getAlgorithm(ids[0]).label} digest differs. The file is corrupted, a different version, or the checksum is for another file.`}
              </p>
            </div>
          </div>
          <div className="divide-y divide-line border-t border-line bg-surface">
            <DigestRow label="Expected" value={bytesToHex(expected.bytes)} />
            {ids.map((id) => {
              const d = computed!.digests[id]!;
              const same = equalBytes(d, expected.bytes);
              return (
                <DigestRow
                  key={id}
                  label={getAlgorithm(id).label}
                  value={bytesToHex(d)}
                  highlight={same ? 'success' : undefined}
                  badge={same ? <Badge tone="success">match</Badge> : undefined}
                />
              );
            })}
          </div>
        </section>
      ) : (
        !job.running && (
          <Panel>
            <EmptyState icon={FileCheck} title={!file ? 'Add a file and its expected checksum' : 'Paste the expected checksum'}>
              Verification runs automatically once both are present.
            </EmptyState>
          </Panel>
        )
      )}
    </ToolStack>
  );
}
