import { useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  FileArchive,
  FilePlus,
  File as FileIcon,
  Folder,
  FolderOpen,
  FolderPlus,
  Lock,
  X,
} from 'lucide-react';
import { ToolBar } from '@/components/tool/EditorPanel';
import { FileDrop } from '@/components/ui/FileDrop';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Button, IconButton } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Field';
import { Badge, Panel, Stat } from '@/components/ui/Panel';
import { EmptyState, ProgressBar, Spinner } from '@/components/ui/Feedback';
import { Dialog } from '@/components/ui/Dialog';
import { toast } from '@/components/ui/Toast';
import { useAsyncJob, useObjectUrl } from '@/lib/hooks';
import { cn, downloadBlob, errorMessage, formatBytes, pluralize } from '@/lib/utils';
import { RangeField } from './components/RangeField';
import { collectEntries, droppedDirectories } from './lib/folderDrop';
import {
  buildTree,
  crc32,
  entryDataRange,
  readZipDirectory,
  safeEntryPath,
  savedPercent,
  ZipError,
  type TreeNode,
  type ZipDirectory,
  type ZipEntry,
} from './lib/zip';
import { buildZip, uniquePaths } from './lib/zipBuild';
import { detectFileType } from './lib/magic';

const MAX_EXTRACT = 1024 * 1024 * 1024;
const PREVIEW_TEXT = 256 * 1024;

async function extract(file: File, entry: ZipEntry): Promise<Uint8Array> {
  if (entry.encrypted) throw new ZipError('This entry is encrypted (password-protected). Encrypted ZIP entries are not supported.');
  if (!entry.supported)
    throw new ZipError(`This entry uses ${entry.methodName} compression, which is not supported here (only Stored and Deflate).`);
  if (entry.size > MAX_EXTRACT) throw new ZipError('This entry is larger than 1 GB and cannot be extracted in the browser.');
  const read = async (s: number, e: number) => new Uint8Array(await file.slice(s, e).arrayBuffer());
  const [start, end] = await entryDataRange(entry, file.size, read);
  const raw = await read(start, end);
  let data: Uint8Array;
  if (entry.method === 0) data = raw;
  else {
    const { inflate, inflateSync } = await import('fflate');
    data =
      raw.length < 512 * 1024
        ? inflateSync(raw)
        : await new Promise<Uint8Array>((resolve, reject) =>
            inflate(raw, (err, out) => (err ? reject(new ZipError('The compressed data is corrupt.')) : resolve(out))),
          );
  }
  if (data.length !== entry.size || crc32(data) !== entry.crc32) throw new ZipError(`“${entry.name}” is corrupt (checksum mismatch).`);
  return data;
}

function isUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, Math.max(0, bytes.length - 3)));
    return true;
  } catch {
    return false;
  }
}

function FileRow({
  node,
  depth,
  onPreview,
  onDownload,
}: {
  node: TreeNode;
  depth: number;
  onPreview: (e: ZipEntry) => void;
  onDownload: (e: ZipEntry) => void;
}) {
  const e = node.entry!;
  const pct = savedPercent(e.size, e.compressedSize);
  return (
    <li className="flex items-center gap-2 py-1.5 pr-2 text-[13px] hover:bg-surface-hover" style={{ paddingLeft: 12 + depth * 18 }}>
      <FileIcon size={14} className="shrink-0 text-fg-muted" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-fg" title={e.name}>
        {node.name}
      </span>
      {e.encrypted && (
        <Badge tone="warning">
          <Lock size={11} aria-hidden /> Encrypted
        </Badge>
      )}
      {!e.encrypted && !e.supported && <Badge tone="warning">{e.methodName}</Badge>}
      <span className="hidden w-20 text-right font-mono text-[12px] tabular-nums text-fg-secondary sm:block">{formatBytes(e.size)}</span>
      <span className="hidden w-16 text-right font-mono text-[12px] tabular-nums text-fg-muted md:block">
        {e.size ? `${Math.round(pct)}%` : '—'}
      </span>
      <span className="hidden w-36 text-right text-[12px] text-fg-muted lg:block">
        {e.modified
          ? e.modified.toLocaleString(undefined, {
              dateStyle: 'short',
              timeStyle: 'short',
            })
          : ''}
      </span>
      <IconButton icon={Eye} size="sm" label={`Preview ${node.name}`} disabled={!e.supported} onClick={() => onPreview(e)} />
      <IconButton icon={Download} size="sm" label={`Download ${node.name}`} disabled={!e.supported} onClick={() => onDownload(e)} />
    </li>
  );
}

function FolderRow({
  node,
  depth,
  open,
  toggle,
  children,
}: {
  node: TreeNode;
  depth: number;
  open: boolean;
  toggle: () => void;
  children: ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 py-1.5 pr-2 text-left text-[13px] hover:bg-surface-hover"
        style={{ paddingLeft: 12 + depth * 18 }}
      >
        {open ? (
          <ChevronDown size={14} className="shrink-0 text-fg-muted" aria-hidden />
        ) : (
          <ChevronRight size={14} className="shrink-0 text-fg-muted" aria-hidden />
        )}
        {open ? (
          <FolderOpen size={14} className="shrink-0 text-accent-text" aria-hidden />
        ) : (
          <Folder size={14} className="shrink-0 text-accent-text" aria-hidden />
        )}
        <span className="min-w-0 flex-1 truncate font-medium text-fg">{node.name}</span>
        <span className="text-[12px] text-fg-muted">{pluralize(node.files, 'file')}</span>
        <span className="hidden w-20 text-right font-mono text-[12px] tabular-nums text-fg-secondary sm:block">
          {formatBytes(node.size)}
        </span>
        <span className="hidden w-16 md:block" />
        <span className="hidden w-36 lg:block" />
        <span className="w-[60px]" />
      </button>
      {open && <ul>{children}</ul>}
    </li>
  );
}

export function OpenMode() {
  const [file, setFile] = useState<File | null>(null);
  const [dir, setDir] = useState<ZipDirectory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<{
    entry: ZipEntry;
    text?: string;
    blob?: Blob;
    note?: string;
  } | null>(null);
  const job = useAsyncJob();
  const previewUrl = useObjectUrl(preview?.blob);

  async function load(f: File) {
    setLoading(true);
    setError(null);
    setDir(null);
    setFile(f);
    try {
      const d = await readZipDirectory(f.size, async (s, e) => new Uint8Array(await f.slice(s, e).arrayBuffer()));
      setDir(d);
      const tree = buildTree(d.entries);
      setOpen(new Set(tree.children.length === 1 && tree.children[0].children.length ? [tree.children[0].path] : []));
    } catch (e) {
      setError(errorMessage(e, 'This ZIP archive could not be read.'));
    } finally {
      setLoading(false);
    }
  }

  const tree = useMemo(() => (dir ? buildTree(dir.entries) : null), [dir]);
  const encrypted = dir?.entries.filter((e) => e.encrypted).length ?? 0;
  const unsupported = dir?.entries.filter((e) => !e.encrypted && !e.supported && !e.isDirectory).length ?? 0;

  async function download(e: ZipEntry) {
    try {
      const data = await extract(file!, e);
      downloadBlob(new Blob([data as Uint8Array<ArrayBuffer>]), e.name.split('/').pop() || 'file');
    } catch (err) {
      toast(errorMessage(err, 'Could not extract this file.'), 'error');
    }
  }

  async function showPreview(e: ZipEntry) {
    try {
      const data = await extract(file!, e);
      const type = detectFileType({
        head: data.subarray(0, 65536),
        size: data.length,
      });
      if (type.category === 'text') {
        const truncated = data.length > PREVIEW_TEXT;
        const label =
          type.id === 'utf16'
            ? data[0] === 0xfe
              ? 'utf-16be'
              : 'utf-16le'
            : type.id === 'text' && !isUtf8(data.subarray(0, PREVIEW_TEXT))
              ? 'windows-1252'
              : 'utf-8';
        setPreview({
          entry: e,
          text: new TextDecoder(label).decode(data.subarray(0, PREVIEW_TEXT)),
          note: truncated ? `Showing the first ${formatBytes(PREVIEW_TEXT)}.` : undefined,
        });
      } else if (['png', 'apng', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'svg'].includes(type.id)) {
        setPreview({
          entry: e,
          blob: new Blob([data as Uint8Array<ArrayBuffer>], {
            type: type.mime,
          }),
        });
      } else {
        setPreview({
          entry: e,
          note: `No preview for ${type.name}. Download the file to open it.`,
        });
      }
    } catch (err) {
      toast(errorMessage(err, 'Could not read this file.'), 'error');
    }
  }

  const canPickFolder = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  async function extractAll() {
    if (!dir || !file) return;
    let root: FileSystemDirectoryHandle;
    try {
      root = await (
        window as unknown as {
          showDirectoryPicker: (o: { mode: string }) => Promise<FileSystemDirectoryHandle>;
        }
      ).showDirectoryPicker({ mode: 'readwrite' });
    } catch {
      return; // user cancelled
    }
    const files = dir.entries.filter((e) => !e.isDirectory);
    let written = 0;
    const failed: string[] = [];
    try {
      await job.run(async ({ signal, progress }) => {
        for (let i = 0; i < files.length; i++) {
          if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
          const e = files[i];
          progress(i / files.length, e.name);
          const safe = safeEntryPath(e.name);
          if (!safe || !e.supported) {
            failed.push(e.name);
            continue;
          }
          try {
            const data = await extract(file, e);
            const parts = safe.split('/');
            let folder = root;
            for (const p of parts.slice(0, -1)) folder = await folder.getDirectoryHandle(p, { create: true });
            const handle = await folder.getFileHandle(parts[parts.length - 1], {
              create: true,
            });
            const w = await handle.createWritable();
            await w.write(data as Uint8Array<ArrayBuffer>);
            await w.close();
            written++;
          } catch {
            failed.push(e.name);
          }
        }
      });
      toast(
        `Extracted ${pluralize(written, 'file')}${failed.length ? `, ${failed.length} skipped` : ''}.`,
        failed.length ? 'info' : 'success',
      );
    } catch (e) {
      toast(errorMessage(e, 'Extraction failed.'), 'error');
    }
  }

  const render = (nodes: TreeNode[], depth: number): ReactNode =>
    nodes.map((n) =>
      n.entry && !n.entry.isDirectory ? (
        <FileRow key={n.path} node={n} depth={depth} onPreview={showPreview} onDownload={download} />
      ) : (
        <FolderRow
          key={n.path}
          node={n}
          depth={depth}
          open={open.has(n.path)}
          toggle={() =>
            setOpen((s) => {
              const next = new Set(s);
              if (next.has(n.path)) next.delete(n.path);
              else next.add(n.path);
              return next;
            })
          }
        >
          {render(n.children, depth + 1)}
        </FolderRow>
      ),
    );

  return (
    <>
      <FileDrop
        accept=".zip,.jar,.apk,.epub,.docx,.xlsx,.pptx,.odt,.ods,.cbz,application/zip"
        onFiles={(f) => void load(f[0])}
        icon={FileArchive}
        compact={Boolean(dir)}
        title="Drop a .zip file to browse it"
        hint="Only the directory is read up front; files are decompressed when you open them. Nothing is uploaded."
      />
      {loading && <Spinner label="Reading archive…" />}
      <ErrorMessage error={error} title="Can't open this archive" />
      {dir && tree && file && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Files" value={tree.files.toLocaleString()} />
            <Stat label="Uncompressed" value={formatBytes(tree.size)} />
            <Stat label="Compressed" value={formatBytes(tree.compressedSize)} />
            <Stat label="Space saved" value={`${Math.round(savedPercent(tree.size, tree.compressedSize))}%`} />
          </div>
          {encrypted > 0 && (
            <Alert tone="warning" title={`${pluralize(encrypted, 'entry', 'entries')} encrypted`}>
              Password-protected entries are listed but cannot be extracted here (encrypted ZIP entries are not supported).
            </Alert>
          )}
          {unsupported > 0 && (
            <Alert tone="warning">
              {pluralize(unsupported, 'entry', 'entries')} use a compression method other than Deflate or Stored and cannot be extracted
              here.
            </Alert>
          )}
          {dir.comment && (
            <Alert tone="info" title="Archive comment">
              {dir.comment}
            </Alert>
          )}
          <Panel
            title={file.name}
            description={`${formatBytes(file.size)}${dir.zip64 ? ' · ZIP64' : ''}`}
            bodyClassName="p-0"
            actions={
              <>
                {tree.children.some((c) => c.children.length) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setOpen(
                        open.size
                          ? new Set()
                          : new Set(
                              dir.entries.flatMap((e) => {
                                const parts = e.name.replace(/\/+$/, '').split('/');
                                return parts
                                  .slice(0, -1)
                                  .map((_, i) => parts.slice(0, i + 1).join('/'))
                                  .concat(e.isDirectory ? [parts.join('/')] : []);
                              }),
                            ),
                      )
                    }
                  >
                    {open.size ? 'Collapse all' : 'Expand all'}
                  </Button>
                )}
                {canPickFolder && (
                  <Button size="sm" variant="primary" icon={FolderOpen} disabled={job.running || tree.files === 0} onClick={extractAll}>
                    Extract all to folder…
                  </Button>
                )}
              </>
            }
          >
            {!canPickFolder && (
              <p className="border-b border-line px-4 py-2 text-[12.5px] text-fg-muted">
                “Extract all” needs folder access (Chrome or Edge). In this browser, download files individually with the buttons on each
                row.
              </p>
            )}
            {job.running && (
              <div className="border-b border-line px-4 py-2.5">
                <ProgressBar value={job.progress} label={job.label} onCancel={job.cancel} />
              </div>
            )}
            <div className="hidden items-center gap-2 border-b border-line px-3 py-1.5 text-[11.5px] font-medium tracking-wide text-fg-muted uppercase sm:flex">
              <span className="flex-1 pl-6">Name</span>
              <span className="w-20 text-right">Size</span>
              <span className="hidden w-16 text-right md:block">Saved</span>
              <span className="hidden w-36 text-right lg:block">Modified</span>
              <span className="w-[60px]" />
            </div>
            {tree.children.length === 0 ? (
              <EmptyState title="This archive is empty" />
            ) : (
              <ul className="max-h-[560px] overflow-y-auto py-1">{render(tree.children, 0)}</ul>
            )}
          </Panel>
        </>
      )}
      <Dialog
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview?.entry.name.split('/').pop() ?? ''}
        description={preview ? `${formatBytes(preview.entry.size)} · ${preview.entry.name}` : undefined}
        size="lg"
        footer={
          preview && (
            <Button icon={Download} onClick={() => void download(preview.entry)}>
              Download
            </Button>
          )
        }
      >
        {preview?.note && <p className="mb-2 text-[13px] text-fg-muted">{preview.note}</p>}
        {preview?.text !== undefined && (
          <pre className="max-h-[60vh] overflow-auto rounded-lg border border-line bg-surface-sunken p-3 font-mono text-[12.5px] whitespace-pre-wrap text-fg">
            {preview.text}
          </pre>
        )}
        {previewUrl && (
          <div className="lk-checker flex justify-center rounded-lg border border-line p-2">
            <img src={previewUrl} alt={preview?.entry.name ?? ''} className="max-h-[60vh] max-w-full object-contain" />
          </div>
        )}
      </Dialog>
    </>
  );
}

interface Item {
  id: number;
  path: string;
  file: File;
}
let itemSeq = 0;

export function CreateMode() {
  const [items, setItems] = useState<Item[]>([]);
  const [level, setLevel] = useState(6);
  const [name, setName] = useState('archive.zip');
  const [error, setError] = useState<string | null>(null);
  const job = useAsyncJob();
  const folderInput = useRef<HTMLInputElement>(null);

  const skipDrop = useRef(false);
  const [scanning, setScanning] = useState(false);

  const addPathed = (list: Array<{ file: File; path: string }>) =>
    setItems((l) => [...l, ...list.map(({ file, path }) => ({ id: ++itemSeq, file, path }))]);

  const add = (files: File[]) => {
    if (skipDrop.current) return;
    addPathed(
      files.map((f) => ({
        file: f,
        path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
      })),
    );
  };

  // Folders dropped onto the drop zone: read their entries during the event, then walk them.
  function onDropCapture(event: DragEvent<HTMLDivElement>) {
    const dropped = droppedDirectories(event.dataTransfer);
    if (!dropped) return;
    skipDrop.current = true;
    setTimeout(() => (skipDrop.current = false), 0);
    setScanning(true);
    collectEntries(dropped.entries)
      .then(addPathed)
      .catch((e: unknown) => setError(errorMessage(e, 'Could not read the dropped folder.')))
      .finally(() => setScanning(false));
  }

  const total = items.reduce((n, i) => n + i.file.size, 0);
  const paths = uniquePaths(items.map((i) => i.path));

  async function create() {
    setError(null);
    try {
      const blob = await job.run(({ signal, progress }) =>
        buildZip(
          items.map((i) => ({ path: i.path, file: i.file })),
          level,
          (f) => progress(f, 'Compressing…'),
          signal,
        ),
      );
      const out = name.trim() ? (name.toLowerCase().endsWith('.zip') ? name.trim() : `${name.trim()}.zip`) : 'archive.zip';
      downloadBlob(blob, out);
      toast(`Created ${out} (${formatBytes(blob.size)})`);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setError(errorMessage(e, 'Could not create the ZIP file.'));
    }
  }

  return (
    <>
      <div onDropCapture={onDropCapture}>
        <FileDrop multiple onFiles={add} icon={FilePlus} compact={items.length > 0} title="Drop files or folders to add to a new ZIP" />
      </div>
      {scanning && <Spinner label="Reading folder…" />}
      <div className="-mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" icon={FolderPlus} onClick={() => folderInput.current?.click()}>
          Add a folder…
        </Button>
        <input
          ref={folderInput}
          type="file"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          multiple
          {...({ webkitdirectory: '' } as Record<string, string>)}
          onChange={(e) => {
            if (e.target.files) add(Array.from(e.target.files));
            e.target.value = '';
          }}
        />
        <span className="text-[12.5px] text-fg-muted">Folder structure is kept when you add a folder.</span>
      </div>
      <ErrorMessage error={error} />
      {items.length > 0 && (
        <>
          <ToolBar>
            <RangeField
              label="Compression level"
              className="w-full sm:w-64"
              value={level}
              min={0}
              max={9}
              onChange={setLevel}
              format={(v) => (v === 0 ? '0 (store)' : v === 9 ? '9 (smallest)' : String(v))}
            />
            <div className="w-56">
              <Label htmlFor="zip-name">Archive name</Label>
              <Input id="zip-name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <Button variant="primary" icon={FileArchive} loading={job.running} onClick={create}>
              Create ZIP
            </Button>
          </ToolBar>
          {job.running && <ProgressBar value={job.progress} label={job.label || 'Compressing…'} onCancel={job.cancel} />}
          <Panel
            title={`${pluralize(items.length, 'file')} · ${formatBytes(total)}`}
            bodyClassName="p-0"
            actions={
              <Button size="sm" variant="ghost" onClick={() => setItems([])}>
                Clear
              </Button>
            }
          >
            <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
              {items.map((it, i) => (
                <li key={it.id} className="flex items-center gap-2 px-4 py-1.5 text-[13px]">
                  <FileIcon size={14} className="shrink-0 text-fg-muted" aria-hidden />
                  <span
                    className={cn('min-w-0 flex-1 truncate font-mono text-[12.5px]', paths[i] !== it.path ? 'text-warning' : 'text-fg')}
                    title={paths[i]}
                  >
                    {paths[i]}
                  </span>
                  <span className="font-mono text-[12px] text-fg-muted">{formatBytes(it.file.size)}</span>
                  <IconButton
                    icon={X}
                    size="sm"
                    label={`Remove ${it.path}`}
                    onClick={() => setItems((l) => l.filter((x) => x.id !== it.id))}
                  />
                </li>
              ))}
            </ul>
          </Panel>
        </>
      )}
    </>
  );
}
