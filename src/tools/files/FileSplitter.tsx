import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, CircleCheck, CircleX, Combine, Download, FolderDown, Scissors, ShieldCheck, X } from 'lucide-react';
import { ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { FileDrop } from '@/components/ui/FileDrop';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Button, IconButton } from '@/components/ui/Button';
import { Checkbox, Input, Label, NumberInput, Select } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { Badge, Panel } from '@/components/ui/Panel';
import { ProgressBar } from '@/components/ui/Feedback';
import { CopyButton } from '@/components/ui/Actions';
import { toast } from '@/components/ui/Toast';
import { useAsyncJob, useToolState } from '@/lib/hooks';
import { cn, downloadBlob, errorMessage, formatBytes, pluralize } from '@/lib/utils';
import { checksumFile, createHasher, parseExpected } from './lib/fileHash';
import { moveItem, orderParts, partName, planSplit, SIZE_PRESETS, UNITS, type PartRange, type Unit } from './lib/split';

const CHUNK = 4 * 1024 * 1024;
const SHOWN_PARTS = 200;

const canPickFolder = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

type DirPicker = {
  showDirectoryPicker: (o: { mode: string }) => Promise<FileSystemDirectoryHandle>;
};

async function saveToFolder(files: Array<{ name: string; blob: Blob }>, onProgress: (i: number) => void, signal: AbortSignal) {
  const root = await (window as unknown as DirPicker).showDirectoryPicker({
    mode: 'readwrite',
  });
  for (let i = 0; i < files.length; i++) {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    onProgress(i);
    const handle = await root.getFileHandle(files[i].name, { create: true });
    const w = await handle.createWritable();
    await w.write(files[i].blob);
    await w.close();
  }
}

async function downloadSequentially(files: Array<{ name: string; blob: Blob }>) {
  for (const f of files) {
    downloadBlob(f.blob, f.name);
    await new Promise((r) => setTimeout(r, 350));
  }
}

// ---------------------------------------------------------------------------
// Split
// ---------------------------------------------------------------------------

interface SplitResult {
  file: File;
  parts: Array<{ name: string; blob: Blob; sha256?: string }>;
  sha256?: string;
}

function SplitMode() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useToolState<'parts' | 'size'>('file-splitter', 'mode', 'parts');
  const [parts, setParts] = useToolState<number | ''>('file-splitter', 'parts', 3);
  const [size, setSize] = useToolState<number | ''>('file-splitter', 'size', 10);
  const [unit, setUnit] = useToolState<Unit>('file-splitter', 'unit', 'MB');
  const [withHash, setWithHash] = useToolState('file-splitter', 'hash', true);
  const [result, setResult] = useState<SplitResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const job = useAsyncJob();

  const plan = useMemo(() => {
    if (!file) return null;
    return mode === 'parts'
      ? planSplit(file.size, { mode: 'parts', parts: parts === '' ? 0 : parts })
      : planSplit(file.size, {
          mode: 'size',
          partSize: size === '' ? 0 : size * UNITS[unit],
        });
  }, [file, mode, parts, size, unit]);

  function choose(f: File) {
    setFile(f);
    setResult(null);
    setError(null);
  }

  async function split() {
    if (!file || !plan?.ok) return;
    setError(null);
    const ranges: PartRange[] = plan.parts;
    const blobs = ranges.map((r) => ({
      name: partName(file.name, r.index, ranges.length),
      blob: file.slice(r.start, r.end),
    }));
    if (!withHash) {
      setResult({ file, parts: blobs });
      return;
    }
    try {
      const out = await job.run(async ({ signal, progress }) => {
        const whole = await createHasher('sha256');
        const partsOut: SplitResult['parts'] = [];
        for (let i = 0; i < ranges.length; i++) {
          const r = ranges[i];
          const h = await createHasher('sha256');
          for (let pos = r.start; pos < r.end; pos += CHUNK) {
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            const data = new Uint8Array(await file.slice(pos, Math.min(r.end, pos + CHUNK)).arrayBuffer());
            h.update(data);
            whole.update(data);
            progress(Math.min(r.end, pos + CHUNK) / file.size, `Checksumming part ${i + 1} of ${ranges.length}`);
          }
          partsOut.push({ ...blobs[i], sha256: h.digest() });
        }
        return { file, parts: partsOut, sha256: whole.digest() };
      });
      setResult(out);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(errorMessage(e, 'Could not split the file.'));
    }
  }

  const manifest = result?.sha256
    ? {
        name: `${result.file.name}.sha256`,
        blob: new Blob(
          [
            checksumFile([
              { name: result.file.name, hash: result.sha256 },
              ...result.parts.map((p) => ({ name: p.name, hash: p.sha256! })),
            ]),
          ],
          { type: 'text/plain' },
        ),
      }
    : null;
  const allFiles = result ? [...result.parts.map(({ name, blob }) => ({ name, blob })), ...(manifest ? [manifest] : [])] : [];

  async function saveAll() {
    try {
      await job.run(({ signal, progress }) =>
        saveToFolder(allFiles, (i) => progress(i / allFiles.length, `Saving ${allFiles[i].name}`), signal),
      );
      toast(`Saved ${pluralize(allFiles.length, 'file')}.`);
    } catch (e) {
      if (e instanceof DOMException && (e.name === 'AbortError' || e.name === 'NotAllowedError')) return;
      toast(errorMessage(e, 'Could not save the parts.'), 'error');
    }
  }

  return (
    <>
      <FileDrop
        onFiles={(f) => choose(f[0])}
        icon={Scissors}
        compact={Boolean(file)}
        title="Drop a file to split"
        hint="Any size: parts are sliced without loading the file into memory. Nothing is uploaded."
      />
      {file && (
        <>
          <ToolBar>
            <div className="min-w-0 basis-full">
              <p className="truncate text-[14px] font-semibold text-fg" title={file.name}>
                {file.name}
              </p>
              <p className="text-[12.5px] text-fg-muted">
                {formatBytes(file.size)} · {file.size.toLocaleString()} bytes
              </p>
            </div>
            <div>
              <Label>Split by</Label>
              <Segmented
                label="Split by"
                value={mode}
                onChange={(m) => {
                  setMode(m);
                  setResult(null);
                }}
                options={[
                  { value: 'parts', label: 'Number of parts' },
                  { value: 'size', label: 'Part size' },
                ]}
              />
            </div>
            {mode === 'parts' ? (
              <div className="w-32">
                <Label htmlFor="split-parts">Parts</Label>
                <NumberInput
                  id="split-parts"
                  min={2}
                  max={10000}
                  step={1}
                  value={parts}
                  onChange={(v) => {
                    setParts(v);
                    setResult(null);
                  }}
                />
              </div>
            ) : (
              <>
                <div className="flex items-end gap-2">
                  <div className="w-28">
                    <Label htmlFor="split-size">Part size</Label>
                    <NumberInput
                      id="split-size"
                      min={1}
                      step="any"
                      value={size}
                      onChange={(v) => {
                        setSize(v);
                        setResult(null);
                      }}
                    />
                  </div>
                  <Select
                    aria-label="Unit"
                    className="w-20"
                    value={unit}
                    onChange={(e) => {
                      setUnit(e.target.value as Unit);
                      setResult(null);
                    }}
                  >
                    {Object.keys(UNITS).map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </Select>
                </div>
                <div className="w-44">
                  <Label htmlFor="split-preset">Preset</Label>
                  <Select
                    id="split-preset"
                    value=""
                    onChange={(e) => {
                      const bytes = Number(e.target.value);
                      if (!bytes) return;
                      if (bytes % UNITS.MB === 0) {
                        setSize(bytes / UNITS.MB);
                        setUnit('MB');
                      } else {
                        setSize(bytes);
                        setUnit('B');
                      }
                      setResult(null);
                    }}
                  >
                    <option value="">Choose…</option>
                    {SIZE_PRESETS.map((p) => (
                      <option key={p.label} value={p.bytes}>
                        {p.label}
                      </option>
                    ))}
                  </Select>
                </div>
              </>
            )}
            <Checkbox
              label="SHA-256 checksum file"
              checked={withHash}
              onChange={(v) => {
                setWithHash(v);
                setResult(null);
              }}
              className="pb-1.5"
            />
            <Button
              variant="primary"
              icon={Scissors}
              disabled={!plan?.ok || job.running}
              loading={job.running && !result}
              onClick={() => void split()}
            >
              Split
            </Button>
          </ToolBar>
          {plan && !plan.ok && <ErrorMessage error={plan.error} />}
          <ErrorMessage error={error} />
          {job.running && <ProgressBar value={job.progress} label={job.label} onCancel={job.cancel} />}
          {plan?.ok && (
            <Panel
              title={result ? `${pluralize(result.parts.length, 'part')} ready` : `Plan: ${pluralize(plan.parts.length, 'part')}`}
              description={
                result
                  ? 'Download the parts, then join them here (or with cat / copy /b) to restore the original.'
                  : 'Parts are named file.ext.001, .002, … so they sort correctly.'
              }
              bodyClassName="p-0"
              actions={
                result && (
                  <>
                    {canPickFolder && (
                      <Button size="sm" variant="primary" icon={FolderDown} disabled={job.running} onClick={() => void saveAll()}>
                        Save all to folder…
                      </Button>
                    )}
                    <Button size="sm" icon={Download} disabled={job.running} onClick={() => void downloadSequentially(allFiles)}>
                      Download all
                    </Button>
                  </>
                )
              }
            >
              {result?.sha256 && (
                <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2.5 text-[12.5px]">
                  <span className="text-fg-muted">SHA-256 of {result.file.name}</span>
                  <code className="min-w-0 basis-full font-mono sm:flex-1 sm:basis-auto break-all text-fg">{result.sha256}</code>
                  <CopyButton value={result.sha256} iconOnly label="Copy SHA-256" />
                  {manifest && (
                    <Button size="sm" variant="ghost" icon={Download} onClick={() => downloadBlob(manifest.blob, manifest.name)}>
                      {manifest.name}
                    </Button>
                  )}
                </div>
              )}
              <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
                {(result
                  ? result.parts
                  : plan.parts.map((r) => ({
                      name: partName(file.name, r.index, plan.parts.length),
                      blob: null as Blob | null,
                      size: r.end - r.start,
                    }))
                )
                  .slice(0, SHOWN_PARTS)
                  .map((p) => {
                    const bytes = 'size' in p ? p.size : p.blob!.size;
                    return (
                      <li key={p.name} className="flex items-center gap-3 px-4 py-1.5 text-[13px]">
                        <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-fg">{p.name}</span>
                        <span className="shrink-0 font-mono text-[12px] text-fg-muted tabular-nums">{formatBytes(bytes)}</span>
                        {result && 'blob' in p && p.blob && (
                          <IconButton
                            icon={Download}
                            size="sm"
                            label={`Download ${p.name}`}
                            onClick={() => downloadBlob(p.blob!, p.name)}
                          />
                        )}
                      </li>
                    );
                  })}
              </ul>
              {plan.parts.length > SHOWN_PARTS && (
                <p className="border-t border-line px-4 py-2 text-[12.5px] text-fg-muted">
                  Showing the first {SHOWN_PARTS} of {plan.parts.length.toLocaleString()} parts
                  {result ? '; "Download all" includes every part.' : '.'}
                </p>
              )}
            </Panel>
          )}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Join
// ---------------------------------------------------------------------------

interface Part {
  id: number;
  file: File;
}
let partSeq = 0;
const isManifest = (f: File) => /\.(sha256|sha256sum|sha256sums)$|sha256sums?(\.txt)?$/i.test(f.name);

function JoinMode() {
  const [items, setItems] = useState<Part[]>([]);
  const [outName, setOutName] = useState('');
  const [expectedText, setExpectedText] = useState('');
  const [computed, setComputed] = useState<{
    key: string;
    hash: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const job = useAsyncJob();

  async function add(files: File[]) {
    const manifests = files.filter(isManifest);
    const parts = files.filter((f) => !isManifest(f));
    for (const m of manifests) {
      try {
        setExpectedText((await m.text()).trim());
      } catch {
        toast(`Could not read ${m.name}.`, 'error');
      }
    }
    if (!parts.length) return;
    const ordered = orderParts([...items.map((p) => p.file), ...parts], (f) => f.name);
    setItems(
      ordered.parts.map(
        (p) =>
          items.find((x) => x.file === p.item) ?? {
            id: ++partSeq,
            file: p.item,
          },
      ),
    );
    setOutName(ordered.outputName);
    setComputed(null);
  }

  const order = useMemo(() => orderParts(items, (p) => p.file.name), [items]);
  const total = items.reduce((n, p) => n + p.file.size, 0);
  const key = items.map((p) => p.id).join(',');
  const expected = useMemo(() => {
    const list = parseExpected(expectedText).filter((e) => e.hash.length === 64);
    return (
      list.find((e) => e.name && e.name.replace(/^.*[\\/]/, '') === outName) ??
      list.find((e) => !e.name) ??
      (list.length === 1 ? list[0] : undefined)
    );
  }, [expectedText, outName]);
  const hash = computed?.key === key ? computed.hash : null;
  const verdict = hash && expected ? (hash === expected.hash ? 'match' : 'mismatch') : null;

  const joined = () =>
    new Blob(
      items.map((p) => p.file),
      { type: 'application/octet-stream' },
    );
  const name = outName.trim() || 'joined.bin';

  async function verifyJoined() {
    setError(null);
    try {
      const h = await job.run(async ({ signal, progress }) => {
        const hasher = await createHasher('sha256');
        let done = 0;
        for (const p of items) {
          for (let pos = 0; pos < p.file.size; pos += CHUNK) {
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            const data = new Uint8Array(await p.file.slice(pos, Math.min(p.file.size, pos + CHUNK)).arrayBuffer());
            hasher.update(data);
            done += data.length;
            progress(done / (total || 1), `Hashing ${p.file.name}`);
          }
        }
        return hasher.digest();
      });
      setComputed({ key, hash: h });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(errorMessage(e, 'Could not read the parts.'));
    }
  }

  function move(from: number, to: number) {
    setItems((l) => moveItem(l, from, to));
  }

  return (
    <>
      <FileDrop
        multiple
        onFiles={(f) => void add(f)}
        icon={Combine}
        compact={items.length > 0}
        title="Drop all parts to join"
        hint="Parts like file.zip.001, .002… are sorted automatically. Drop the .sha256 file too to verify the result."
      />
      {items.length > 0 && (
        <>
          {order.missing.length > 0 && (
            <Alert tone="warning" title="Parts seem to be missing">
              No part {order.missing.slice(0, 10).join(', ')}
              {order.missing.length > 10 ? '…' : ''} was added. The joined file will be incomplete.
            </Alert>
          )}
          {order.duplicates.length > 0 && (
            <Alert tone="warning">Part {order.duplicates.join(', ')} was added more than once. Remove the duplicates.</Alert>
          )}
          <Panel
            title={`${pluralize(items.length, 'part')} · ${formatBytes(total)}`}
            description={
              order.numbered
                ? 'Ordered by part number. Use the arrows to change the order.'
                : 'Ordered by name. Use the arrows to change the order.'
            }
            bodyClassName="p-0"
            actions={
              <Button
                size="sm"
                variant="ghost"
                disabled={job.running}
                onClick={() => {
                  setItems([]);
                  setComputed(null);
                }}
              >
                Clear
              </Button>
            }
          >
            <ol className="max-h-[360px] divide-y divide-line overflow-y-auto">
              {items.map((p, i) => (
                <li key={p.id} className="flex items-center gap-2 py-1 pr-2 pl-4 text-[13px]">
                  <span className="w-8 shrink-0 text-right font-mono text-[12px] text-fg-muted tabular-nums">{i + 1}.</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-fg" title={p.file.name}>
                    {p.file.name}
                  </span>
                  <span className="hidden shrink-0 font-mono text-[12px] text-fg-muted tabular-nums sm:inline">
                    {formatBytes(p.file.size)}
                  </span>
                  <IconButton
                    icon={ArrowUp}
                    size="sm"
                    label={`Move ${p.file.name} up`}
                    disabled={i === 0 || job.running}
                    onClick={() => move(i, i - 1)}
                  />
                  <IconButton
                    icon={ArrowDown}
                    size="sm"
                    label={`Move ${p.file.name} down`}
                    disabled={i === items.length - 1 || job.running}
                    onClick={() => move(i, i + 1)}
                  />
                  <IconButton
                    icon={X}
                    size="sm"
                    label={`Remove ${p.file.name}`}
                    disabled={job.running}
                    onClick={() => setItems((l) => l.filter((x) => x.id !== p.id))}
                  />
                </li>
              ))}
            </ol>
          </Panel>
          <ToolBar>
            <div className="w-full sm:w-64">
              <Label htmlFor="join-name">Output file name</Label>
              <Input id="join-name" value={outName} onChange={(e) => setOutName(e.target.value)} placeholder="joined.bin" />
            </div>
            <div className="w-full min-w-0 sm:flex-1">
              <Label htmlFor="join-expected">Expected SHA-256 (optional)</Label>
              <div className="flex gap-1.5">
                <Input
                  id="join-expected"
                  mono
                  value={
                    expectedText.includes('\n')
                      ? `${pluralize(parseExpected(expectedText).length, 'checksum')} loaded from file`
                      : expectedText
                  }
                  readOnly={expectedText.includes('\n')}
                  onChange={(e) => setExpectedText(e.target.value)}
                  placeholder="Paste a hash, or drop the .sha256 file above"
                />
                {expectedText.includes('\n') && <IconButton icon={X} label="Clear loaded checksums" onClick={() => setExpectedText('')} />}
              </div>
            </div>
            <Button icon={ShieldCheck} disabled={job.running} onClick={() => void verifyJoined()}>
              Verify SHA-256
            </Button>
            <Button variant="primary" icon={Download} disabled={job.running} onClick={() => downloadBlob(joined(), name)}>
              Download joined file
            </Button>
          </ToolBar>
          <ErrorMessage error={error} />
          {job.running && <ProgressBar value={job.progress} label={job.label} onCancel={job.cancel} />}
          {hash && (
            <div
              role="status"
              className={cn(
                'flex flex-wrap items-center gap-2 rounded-xl border bg-surface px-4 py-3 text-[13px] shadow-card',
                verdict === 'match' ? 'border-success/50' : verdict === 'mismatch' ? 'border-danger/50' : 'border-line',
              )}
            >
              {verdict === 'match' && (
                <Badge tone="success">
                  <CircleCheck size={12} aria-hidden /> Checksum matches
                </Badge>
              )}
              {verdict === 'mismatch' && (
                <Badge tone="danger">
                  <CircleX size={12} aria-hidden /> Checksum does not match
                </Badge>
              )}
              <span className="text-fg-muted">SHA-256 of {name}</span>
              <code className="min-w-0 basis-full font-mono sm:flex-1 sm:basis-auto text-[12.5px] break-all text-fg">{hash}</code>
              <CopyButton value={hash} iconOnly label="Copy SHA-256" />
              {verdict === 'mismatch' && (
                <p className="basis-full text-[12.5px] text-danger">
                  Check that every part is present, in the right order, and fully downloaded.
                </p>
              )}
              {!expected && (
                <p className="basis-full text-[12.5px] text-fg-muted">Paste the expected hash (or drop the .sha256 file) to compare.</p>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}

export default function FileSplitter() {
  const [mode, setMode] = useToolState<'split' | 'join'>('file-splitter', 'tab', 'split');
  return (
    <ToolStack>
      <Segmented
        label="Mode"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'split', label: 'Split', icon: Scissors },
          { value: 'join', label: 'Join', icon: Combine },
        ]}
      />
      {mode === 'split' ? <SplitMode /> : <JoinMode />}
    </ToolStack>
  );
}
