import { useRef, useState, type DragEvent } from 'react';
import { ChevronDown, ChevronRight, FolderOpen, FolderSearch, RefreshCw, ShieldCheck, Trash } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button, IconButton } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { Label, NumberInput, Switch, Textarea } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Feedback';
import { Badge } from '@/components/ui/Panel';
import { cn, formatBytes, formatNumber, pluralize } from '@/lib/utils';
import { DEFAULT_IGNORES, parseIgnoreList } from '../lib/ignore';
import type { BrowserSupport } from '../lib/folders';
import type { StoredIndex } from '../lib/persist';
import { timeAgo } from '../lib/snippets';

export interface OptionsState {
  ignore: string;
  maxTextMb: number;
  skipHidden: boolean;
}

export function StartScreen({
  support,
  options,
  onOptions,
  onPick,
  onInputFiles,
  onDrop,
  recents,
  recentsLoading,
  storageProblem,
  onOpenRecent,
  onRescanRecent,
  onRemoveRecent,
  error,
}: {
  support: BrowserSupport;
  options: OptionsState;
  onOptions: (next: OptionsState) => void;
  onPick: () => void;
  onInputFiles: (files: FileList) => void;
  onDrop: (event: DragEvent) => void;
  recents: StoredIndex[];
  recentsLoading: boolean;
  storageProblem: string | null;
  onOpenRecent: (r: StoredIndex) => void;
  onRescanRecent: (r: StoredIndex) => void;
  onRemoveRecent: (r: StoredIndex) => void;
  error: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [removing, setRemoving] = useState<StoredIndex | null>(null);

  const choose = () => (support === 'full' ? onPick() : inputRef.current?.click());

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          onDrop(e);
        }}
        className={cn(
          'flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center transition-colors sm:py-12',
          over ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface-sunken',
        )}
      >
        <div className="flex size-12 items-center justify-center rounded-xl border border-line bg-surface-raised text-fg-secondary shadow-card">
          <FolderSearch size={21} aria-hidden />
        </div>
        <div>
          <p className="text-[15px] font-medium text-fg">Choose a folder to index, or drop one here</p>
          <p className="mt-1 text-[12.5px] text-fg-muted">
            Files are read by your browser on this device. Nothing is uploaded, and the index stays in this browser.
          </p>
        </div>
        <Button variant="primary" icon={FolderOpen} onClick={choose} disabled={support === 'none'}>
          Choose folder
        </Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-label="Choose a folder"
          data-testid="folder-input"
          {...{ webkitdirectory: '', directory: '' }}
          onChange={(e) => {
            if (e.target.files?.length) onInputFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {error && (
        <Alert tone="danger" title="Could not index the folder">
          {error}
        </Alert>
      )}

      <section className="rounded-xl border border-line bg-surface shadow-card">
        <button
          type="button"
          onClick={() => setShowOptions((s) => !s)}
          aria-expanded={showOptions}
          className="flex w-full items-center gap-2 px-4 py-3 text-left text-[13px] font-semibold text-fg"
        >
          {showOptions ? <ChevronDown size={15} aria-hidden /> : <ChevronRight size={15} aria-hidden />}
          Indexing options
          <span className="ml-auto text-[12px] font-normal text-fg-muted">
            Text up to {options.maxTextMb} MB per file · {pluralize(parseIgnoreList(options.ignore).length, 'ignore rule')}
          </span>
        </button>
        {showOptions && (
          <div className="grid gap-4 border-t border-line p-4 md:grid-cols-[1fr_260px]">
            <div>
              <Label htmlFor="fs-ignore">Ignore these folders and files</Label>
              <Textarea
                id="fs-ignore"
                rows={7}
                value={options.ignore}
                onChange={(e) => onOptions({ ...options, ignore: e.target.value })}
                className="text-[12.5px]"
              />
              <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[12px] text-fg-muted">
                <span>One name or pattern per line. * and ? are wildcards, ** spans folders; patterns with “/” match paths from the folder root.</span>
                <Button size="sm" variant="ghost" onClick={() => onOptions({ ...options, ignore: DEFAULT_IGNORES.join('\n') })}>
                  Reset
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-4">
              <div>
                <Label htmlFor="fs-maxmb">Max text size per file (MB)</Label>
                <NumberInput
                  id="fs-maxmb"
                  min={0.1}
                  max={50}
                  step={0.5}
                  value={options.maxTextMb}
                  onChange={(v) => onOptions({ ...options, maxTextMb: v === '' ? 2 : Math.min(50, Math.max(0.1, v)) })}
                />
                <p className="mt-1.5 text-[12px] text-fg-muted">Larger files are found by name only.</p>
              </div>
              <Switch label="Skip hidden files and folders" checked={options.skipHidden} onChange={(v) => onOptions({ ...options, skipHidden: v })} />
            </div>
          </div>
        )}
      </section>

      <section className="rounded-xl border border-line bg-surface shadow-card">
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h2 className="text-[13px] font-semibold text-fg">Recent locations</h2>
          <span className="text-[12px] text-fg-muted">Saved in this browser only</span>
        </header>
        {storageProblem && (
          <p className="border-b border-line px-4 py-2 text-[12.5px] text-warning">
            Indexes cannot be saved ({storageProblem}). They last until you close this tab.
          </p>
        )}
        {recentsLoading ? (
          <div className="px-4 py-6">
            <Spinner label="Loading…" />
          </div>
        ) : recents.length === 0 ? (
          <p className="px-4 py-6 text-center text-[13px] text-fg-muted">Folders you index appear here so you can search them again later.</p>
        ) : (
          <ul className="divide-y divide-line">
            {recents.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3">
                <FolderOpen size={16} className="shrink-0 text-fg-muted" aria-hidden />
                <div className="min-w-0 flex-1 basis-48">
                  <p className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-[13.5px] font-medium text-fg">{r.name}</span>
                    {r.mode === 'handle' ? <Badge tone="success">Re-scannable</Badge> : <Badge>Snapshot</Badge>}
                  </p>
                  <p className="text-[12px] text-fg-muted">
                    {formatNumber(r.summary.fileCount, 0)} files · {formatBytes(r.summary.totalBytes)} · indexed {timeAgo(r.updatedAt)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" onClick={() => onOpenRecent(r)}>
                    Open
                  </Button>
                  {r.mode === 'handle' && (
                    <IconButton icon={RefreshCw} label={`Re-scan ${r.name}`} size="sm" onClick={() => onRescanRecent(r)} />
                  )}
                  <IconButton icon={Trash} label={`Remove index of ${r.name}`} size="sm" onClick={() => setRemoving(r)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="grid gap-3 text-[13px] text-fg-secondary md:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="mb-1.5 flex items-center gap-2 font-semibold text-fg">
            <ShieldCheck size={15} className="text-success" aria-hidden />
            Your browser: {support === 'full' ? 'full folder access' : support === 'fallback' ? 'folder upload fallback' : 'not supported'}
          </p>
          {support === 'full' && (
            <p>
              This browser supports the File System Access API. Indexed folders can be re-scanned later (after you allow access again) and
              files can be opened from disk without choosing the folder again.
            </p>
          )}
          {support === 'fallback' && (
            <p>
              This browser can read a folder you select, but cannot keep access to it. Saved indexes are snapshots: to re-scan, select the
              folder again. Files can be opened only during this visit.
            </p>
          )}
          {support === 'none' && <p>This browser cannot read folders. Try a current version of Chrome, Edge, Firefox or Safari.</p>}
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="mb-1.5 font-semibold text-fg">Browser support</p>
          <ul className="flex list-disc flex-col gap-1 pl-4">
            <li>Chrome, Edge, Opera (desktop): full access, re-scan and open files later.</li>
            <li>Firefox, Safari: select or drop a folder each time; snapshots are saved.</li>
            <li>Mobile browsers: folder selection is limited or unavailable.</li>
          </ul>
        </div>
      </section>

      <ConfirmDialog
        open={removing !== null}
        title="Remove this index?"
        confirmLabel="Remove"
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) onRemoveRecent(removing);
          setRemoving(null);
        }}
      >
        The saved index of <strong className="text-fg">{removing?.name}</strong> is deleted from this browser. Your files are not touched.
      </ConfirmDialog>
    </div>
  );
}
