import { useEffect, useMemo, useState } from 'react';
import { FileText, Hash, Upload } from 'lucide-react';
import { EditorPanel, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Segmented } from '@/components/ui/Segmented';
import { Label, Select, Switch } from '@/components/ui/Field';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Badge, Panel } from '@/components/ui/Panel';
import { EmptyState, ProgressBar } from '@/components/ui/Feedback';
import { FileDrop } from '@/components/ui/FileDrop';
import { useAsyncJob, useDebouncedValue, useToolState } from '@/lib/hooks';
import { errorMessage, formatBytes, formatDuration, pluralize } from '@/lib/utils';
import {
  HASH_ALGORITHMS,
  formatDigest,
  getAlgorithm,
  hashBlob,
  hashBytes,
  isAlgorithmId,
  type DigestFormat,
  type DigestMap,
  type HashAlgorithmId,
} from './lib/hash';
import { DigestRow, FileChip } from './shared-a/ui';

const TOOL = 'hash-generator';
const SAMPLE = 'The quick brown fox jumps over the lazy dog';
const GROUPS = ['SHA-2', 'SHA-3', 'BLAKE', 'Legacy', 'Checksum'] as const;
const ALL_IDS = HASH_ALGORITHMS.map((a) => a.id);

function AlgoBadge({ id }: { id: HashAlgorithmId }) {
  if (id === 'md5' || id === 'sha1') return <Badge tone="warning">not for security</Badge>;
  if (id === 'crc32' || id === 'xxhash64') return <Badge>non-crypto</Badge>;
  return null;
}

interface Result {
  digests: DigestMap;
  ids: HashAlgorithmId[];
  bytes: number;
  ms: number;
}

export default function HashGenerator() {
  const [source, setSource] = useToolState<'text' | 'file'>(TOOL, 'source', 'text');
  const [format, setFormat] = useToolState<DigestFormat>(TOOL, 'format', 'hex');
  const [all, setAll] = useToolState(TOOL, 'all', false);
  const [storedAlgo, setAlgo] = useToolState<string>(TOOL, 'algo', 'sha256');
  const algo: HashAlgorithmId = isAlgorithmId(storedAlgo) ? storedAlgo : 'sha256';
  const [text, setText] = useToolState(TOOL, 'text', '');
  const [file, setFile] = useState<File | null>(null);

  const ids = useMemo<HashAlgorithmId[]>(() => (all ? ALL_IDS : [algo]), [all, algo]);
  const debouncedText = useDebouncedValue(text, 120);

  const [textResult, setTextResult] = useState<Result | null>(null);
  const [fileResult, setFileResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const job = useAsyncJob();
  const { run, cancel } = job;

  // Text: hash live (fast, in memory).
  useEffect(() => {
    if (source !== 'text') return;
    let stale = false;
    const start = performance.now();
    const bytes = new TextEncoder().encode(debouncedText);
    hashBytes(bytes, ids)
      .then((digests) => {
        if (!stale) {
          setTextResult({ digests, ids, bytes: bytes.length, ms: performance.now() - start });
          setError(null);
        }
      })
      .catch((e) => !stale && setError(errorMessage(e, 'Could not compute the hash.')));
    return () => {
      stale = true;
    };
  }, [source, debouncedText, ids]);

  // File: stream in chunks with progress; re-run when the file or algorithms change.
  useEffect(() => {
    if (source !== 'file' || !file) return;
    setFileResult(null);
    setError(null);
    const start = performance.now();
    run(async ({ signal, progress }) => {
      const digests = await hashBlob(file, ids, {
        signal,
        onProgress: (fraction, done, total) =>
          progress(fraction, `Hashing ${formatBytes(done)} of ${formatBytes(total)}`),
      });
      return digests;
    })
      .then((digests) => setFileResult({ digests, ids, bytes: file.size, ms: performance.now() - start }))
      .catch((e) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setError(errorMessage(e, 'Could not read the file.'));
      });
    return () => cancel();
  }, [source, file, ids, run, cancel]);

  const result = source === 'text' ? textResult : fileResult;
  const showResult = source === 'text' ? text.length > 0 && result : Boolean(file && result);
  const selected = getAlgorithm(algo);

  return (
    <ToolStack>
      <ToolBar>
        <div>
          <Label>Input</Label>
          <Segmented
            label="Input"
            value={source}
            onChange={setSource}
            options={[
              { value: 'text', label: 'Text', icon: FileText },
              { value: 'file', label: 'File', icon: Upload },
            ]}
          />
        </div>
        <div className="min-w-44">
          <Label htmlFor="hash-algo">Algorithm</Label>
          <Select id="hash-algo" value={algo} onChange={(e) => setAlgo(e.target.value)} disabled={all} className="h-9 py-1">
            {GROUPS.map((group) => (
              <optgroup key={group} label={group}>
                {HASH_ALGORITHMS.filter((a) => a.group === group).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        </div>
        <Switch label="All algorithms" checked={all} onChange={setAll} className="h-9" />
        <div>
          <Label>Output</Label>
          <Segmented
            label="Output format"
            value={format}
            onChange={setFormat}
            options={[
              { value: 'hex', label: 'hex' },
              { value: 'HEX', label: 'HEX' },
              { value: 'base64', label: 'Base64' },
            ]}
          />
        </div>
      </ToolBar>

      {!all && selected.note && (
        <Alert tone="warning" title={`${selected.label} is ${selected.id === 'md5' || selected.id === 'sha1' ? 'not for security' : 'not cryptographic'}`}>
          {selected.note} For integrity against tampering or for signatures use SHA-256, SHA-512, SHA-3 or BLAKE3.
        </Alert>
      )}

      {source === 'text' ? (
        <EditorPanel
          title="Text to hash"
          value={text}
          onChange={setText}
          placeholder="Type or paste text. It is hashed as UTF-8 bytes, exactly as typed (including trailing newlines)."
          sample={SAMPLE}
          fileAccept=".txt,text/*,.json,.csv,.md,.xml,.yaml,.yml,.log"
          height="180px"
          footer={
            text ? (
              <>
                <span className="tabular-nums">{formatBytes(new TextEncoder().encode(text).length)} UTF-8</span>
                <span className="tabular-nums">{pluralize(text.length, 'character')}</span>
              </>
            ) : undefined
          }
        />
      ) : file ? (
        <div className="flex flex-col gap-3">
          <FileChip file={file} onClear={() => setFile(null)} />
          {job.running && <ProgressBar value={job.progress} label={job.label || 'Starting…'} onCancel={cancel} />}
        </div>
      ) : (
        <FileDrop
          onFiles={(files) => setFile(files[0])}
          title="Drop a file to hash"
          hint="Any size. The file is read in chunks on this device and never uploaded."
        />
      )}

      <ErrorMessage error={error} title="Hashing failed" />

      <Panel
        title={all ? 'Digests' : `${selected.label} digest`}
        description={
          showResult && result
            ? `${formatBytes(result.bytes)} hashed in ${formatDuration(result.ms)}`
            : undefined
        }
        bodyClassName="p-0!"
      >
        {showResult && result ? (
          <div className="divide-y divide-line">
            {result.ids.map((id) => (
              <DigestRow
                key={id}
                label={getAlgorithm(id).label}
                badge={all ? <AlgoBadge id={id} /> : undefined}
                value={formatDigest(result.digests[id]!, format)}
              />
            ))}
          </div>
        ) : (
          <EmptyState icon={Hash} title={source === 'text' ? 'Enter some text' : job.running ? 'Hashing…' : 'Choose a file'}>
            {source === 'text'
              ? 'The digest updates as you type.'
              : 'Hashes are computed incrementally, so even multi-gigabyte files work.'}
          </EmptyState>
        )}
      </Panel>
    </ToolStack>
  );
}
