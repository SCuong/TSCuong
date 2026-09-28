import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { CaseSensitive, FolderOpen, Funnel, RefreshCw, Search, ShieldCheck, X } from 'lucide-react';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Dialog } from '@/components/ui/Dialog';
import { EmptyState, ProgressBar, Spinner } from '@/components/ui/Feedback';
import { Input, Select } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { toast } from '@/components/ui/Toast';
import { useDebouncedValue, useMediaQuery, useToolState } from '@/lib/hooks';
import { getStorageProblem, useCollection } from '@/lib/storage/db';
import { cn, errorMessage, formatBytes, formatDuration, formatNumber, pluralize } from '@/lib/utils';
import { CancelledError, IndexClient, WatchdogError } from './indexClient';
import { DEFAULT_IGNORES, parseIgnoreList } from './lib/ignore';
import {
  ensureReadPermission,
  filesFromDirectoryInput,
  filesFromDroppedEntry,
  folderSupport,
  pickDirectory,
  resolveFileHandle,
} from './lib/folders';
import { fileIndexes, saveIndex, type StoredIndex } from './lib/persist';
import type { IndexOptions, IndexProgress, IndexSource, IndexSummary, ResultItem, SearchMode, SearchResponse, Snapshot } from './lib/protocol';
import { EMPTY_FILTERS, hasActiveFilters, type FileMeta, type SearchFilters, type SortKey } from './lib/query';
import { timeAgo } from './lib/snippets';
import { FiltersPanel } from './components/FiltersPanel';
import { PreviewPane, type FileAccess } from './components/PreviewPane';
import { ResultList } from './components/ResultList';
import { StartScreen, type OptionsState } from './components/StartScreen';

const TOOL_ID = 'file-search';
const PAGE = 100;
const REGEX_WATCHDOG_MS = 6000;

type Origin =
  | { kind: 'handle'; handle: FileSystemDirectoryHandle }
  | { kind: 'session'; byPath: Map<string, File> }
  | { kind: 'snapshot' };

interface Loaded {
  summary: IndexSummary;
  origin: Origin;
  snapshot: Snapshot;
  options: IndexOptions;
}

function toIndexOptions(o: OptionsState): IndexOptions {
  return { ignore: o.ignore, maxTextBytes: Math.round(o.maxTextMb * 1024 * 1024), skipHidden: o.skipHidden };
}

export default function FileSearch() {
  const support = useMemo(folderSupport, []);
  const clientRef = useRef<IndexClient | null>(null);
  const [phase, setPhase] = useState<'start' | 'indexing' | 'ready'>('start');
  const [progress, setProgress] = useState<IndexProgress | null>(null);
  const [progressLabel, setProgressLabel] = useState('');
  const [startError, setStartError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [options, setOptions] = useToolState<OptionsState>(TOOL_ID, 'options', {
    ignore: DEFAULT_IGNORES.join('\n'),
    maxTextMb: 2,
    skipHidden: false,
  });
  const [storageProblem, setStorageProblem] = useState<string | null>(null);
  const recents = useCollection(fileIndexes);
  const sortedRecents = useMemo(() => [...recents.items].sort((a, b) => b.updatedAt - a.updatedAt), [recents.items]);

  // Search state
  const [query, setQuery] = useState('');
  const [mode, setMode] = useToolState<SearchMode>(TOOL_ID, 'mode', 'fulltext');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [sort, setSort] = useState<SortKey>('relevance');
  const [filters, setFilters] = useState<SearchFilters>(EMPTY_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  const [limit, setLimit] = useState(PAGE);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [engineVersion, setEngineVersion] = useState(0);
  const [selected, setSelected] = useState<FileMeta | null>(null);
  const [previewContent, setPreviewContent] = useState<{ id: number; content: string | null } | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  const loadedRef = useRef<Loaded | null>(null);
  loadedRef.current = loaded;

  useEffect(() => {
    void getStorageProblem().then(setStorageProblem);
  }, []);

  const getClient = useCallback((): IndexClient => {
    if (!clientRef.current || clientRef.current.terminated) {
      clientRef.current = new IndexClient();
    }
    return clientRef.current;
  }, []);

  useEffect(() => () => clientRef.current?.terminate(), []);

  const onProgress = useCallback((p: IndexProgress) => {
    setProgress(p);
  }, []);

  // ---------------------------------------------------------------------------
  // Indexing
  // ---------------------------------------------------------------------------

  const reload = useCallback(
    async (target: Loaded, label = `Loading ${target.summary.rootName}`) => {
      setPhase('indexing');
      setProgress(null);
      setProgressLabel(label);
      try {
        await getClient().call('load', { snapshot: target.snapshot, summary: target.summary }, { onProgress });
        setLoaded(target);
        setPhase('ready');
        setEngineVersion((v) => v + 1);
      } catch (error) {
        setStartError(errorMessage(error, 'The saved index could not be loaded.'));
        setLoaded(null);
        setPhase('start');
      }
    },
    [getClient, onProgress],
  );

  const runIndex = useCallback(
    async (source: IndexSource, rootName: string, origin: Origin) => {
      const opts = toIndexOptions(options);
      setPhase('indexing');
      setStartError(null);
      setProgress(null);
      setProgressLabel(`Indexing ${rootName}`);
      setResponse(null);
      setSelected(null);
      try {
        const { summary, snapshot } = await getClient().call('index', { source, options: opts, rootName }, { onProgress });
        const next: Loaded = { summary, origin, snapshot, options: opts };
        setLoaded(next);
        setPhase('ready');
        setQuery('');
        setFilters(EMPTY_FILTERS);
        setLimit(PAGE);
        try {
          await saveIndex({ handle: origin.kind === 'handle' ? origin.handle : null, summary, options: opts, snapshot });
        } catch (error) {
          toast(`The index works now but could not be saved: ${errorMessage(error)}`, 'error', 5000);
        }
      } catch (error) {
        if (error instanceof CancelledError) {
          setPhase(loadedRef.current ? 'ready' : 'start');
          toast('Indexing cancelled.', 'info');
          // A cancelled job cleared the worker's index; reload the previous one if there was one.
          const prev = loadedRef.current;
          if (prev) void reload(prev);
          return;
        }
        setStartError(errorMessage(error, 'The folder could not be indexed.'));
        setPhase('start');
        setLoaded(null);
      }
    },
    [getClient, onProgress, options, reload],
  );

  async function pickFolder() {
    try {
      const handle = await pickDirectory();
      if (!handle) return;
      await runIndex({ kind: 'handle', handle }, handle.name, { kind: 'handle', handle });
    } catch (error) {
      setStartError(errorMessage(error));
    }
  }

  function indexFileList(list: FileList | File[]) {
    const { rootName, files, paths } = filesFromDirectoryInput(list);
    if (!files.length) {
      setStartError('The selected folder is empty.');
      return;
    }
    const byPath = new Map(paths.map((p, i) => [p, files[i]]));
    void runIndex({ kind: 'files', files, paths }, rootName, { kind: 'session', byPath });
  }

  function onDrop(event: DragEvent) {
    const items = Array.from(event.dataTransfer.items ?? []).filter((i) => i.kind === 'file');
    if (!items.length) return;
    const item = items[0];
    // Both APIs must be called synchronously inside the drop event.
    const withHandle = item as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> };
    const handlePromise = support === 'full' && withHandle.getAsFileSystemHandle ? withHandle.getAsFileSystemHandle() : null;
    const entry = item.webkitGetAsEntry?.() ?? null;
    void (async () => {
      try {
        const handle = handlePromise ? await handlePromise : null;
        if (handle && handle.kind === 'directory') {
          const dir = handle as FileSystemDirectoryHandle;
          await runIndex({ kind: 'handle', handle: dir }, dir.name, { kind: 'handle', handle: dir });
          return;
        }
        if (!entry || !entry.isDirectory) {
          setStartError('Drop a folder, not individual files.');
          return;
        }
        setPhase('indexing');
        setProgress(null);
        setProgressLabel(`Reading ${entry.name}`);
        const ctrl = new AbortController();
        const { files, paths, errors } = await filesFromDroppedEntry(
          entry,
          parseIgnoreList(options.ignore),
          options.skipHidden,
          (count) =>
            setProgress({ phase: 'scanning', files: count, folders: 0, bytes: 0, textFiles: 0, textBytes: 0, ignored: 0, errors: 0, current: '', fraction: null }),
          ctrl.signal,
        );
        if (!files.length) {
          setPhase('start');
          setStartError(errors ? 'The dropped folder could not be read.' : 'The dropped folder is empty (or everything in it is ignored).');
          return;
        }
        const byPath = new Map(paths.map((p, i) => [p, files[i]]));
        await runIndex({ kind: 'files', files, paths }, entry.name, { kind: 'session', byPath });
      } catch (error) {
        setPhase('start');
        setStartError(errorMessage(error, 'The dropped folder could not be read.'));
      }
    })();
  }

  async function rescanHandle(handle: FileSystemDirectoryHandle) {
    try {
      if (!(await ensureReadPermission(handle))) {
        setStartError('Permission to read the folder was denied. Allow access to re-scan it.');
        return;
      }
      await runIndex({ kind: 'handle', handle }, handle.name, { kind: 'handle', handle });
    } catch (error) {
      const message =
        error instanceof DOMException && error.name === 'NotFoundError'
          ? 'The folder no longer exists or was moved. Remove this index and choose the folder again.'
          : errorMessage(error);
      setStartError(message);
      setPhase(loadedRef.current ? 'ready' : 'start');
    }
  }

  function openRecent(record: StoredIndex) {
    setStartError(null);
    setResponse(null);
    setSelected(null);
    setQuery('');
    setFilters(EMPTY_FILTERS);
    void reload({
      summary: record.summary,
      origin: record.mode === 'handle' && record.handle ? { kind: 'handle', handle: record.handle } : { kind: 'snapshot' },
      snapshot: { meta: record.meta, content: record.content },
      options: record.options,
    });
  }

  async function removeRecent(record: StoredIndex) {
    try {
      await fileIndexes.remove(record.id);
      toast(`Removed the index of ${record.name}`);
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  function close() {
    setLoaded(null);
    setResponse(null);
    setSelected(null);
    setPhase('start');
    clientRef.current?.terminate();
    clientRef.current = null;
  }

  // ---------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------

  const debouncedQuery = useDebouncedValue(query, mode === 'regex' ? 400 : 200);
  const debouncedFilters = useDebouncedValue(filters, 250);
  const searchSeq = useRef(0);

  useEffect(() => {
    if (phase !== 'ready' || !loaded) return;
    const seq = ++searchSeq.current;
    setSearching(true);
    const client = getClient();
    client
      .call(
        'search',
        { query: debouncedQuery, mode, caseSensitive, filters: debouncedFilters, sort, limit },
        mode === 'regex'
          ? {
              watchdogMs: REGEX_WATCHDOG_MS,
              watchdogMessage:
                'The regular expression took too long and was stopped. It may cause catastrophic backtracking; try a more specific pattern.',
            }
          : {},
      )
      .then((res) => {
        if (seq !== searchSeq.current) return;
        setResponse(res);
        setSearchError(res.error);
      })
      .catch((error: unknown) => {
        if (seq !== searchSeq.current) return;
        setResponse(null);
        setSearchError(errorMessage(error));
        if (error instanceof WatchdogError) {
          // The worker was terminated; bring the index back from the in-memory snapshot.
          const current = loadedRef.current;
          if (current) {
            void getClient()
              .call('load', { snapshot: current.snapshot, summary: current.summary })
              .catch((e: unknown) => setSearchError(errorMessage(e)));
          }
        }
      })
      .finally(() => {
        if (seq === searchSeq.current) setSearching(false);
      });
  }, [phase, loaded, debouncedQuery, mode, caseSensitive, debouncedFilters, sort, limit, getClient, engineVersion]);

  // Reset paging when the query changes.
  useEffect(() => setLimit(PAGE), [debouncedQuery, mode, debouncedFilters, sort, caseSensitive]);

  const highlight = useMemo(() => {
    if (!response?.highlight) return null;
    try {
      return new RegExp(response.highlight.source, response.highlight.flags);
    } catch {
      return null;
    }
  }, [response]);

  function select(item: ResultItem) {
    setSelected(item.meta);
    setPreviewContent(null);
    if (!isDesktop) setPreviewOpen(true);
    const id = item.meta.id;
    getClient()
      .call('preview', { id })
      .then((res) => setPreviewContent({ id, content: res.content }))
      .catch(() => setPreviewContent({ id, content: null }));
  }

  const access: FileAccess = useMemo(() => {
    const origin = loaded?.origin;
    if (!origin || origin.kind === 'snapshot') {
      return {
        available: false,
        autoRead: false,
        reason:
          'This index is a saved snapshot from a browser without folder access. Choose the folder again to open files; the indexed text is shown below.',
        read: () => Promise.reject(new Error('The file is not available.')),
      };
    }
    if (origin.kind === 'session') {
      return {
        available: true,
        autoRead: true,
        read: async (meta) => {
          const file = origin.byPath.get(meta.path);
          if (!file) throw new Error('The file is not available any more.');
          return file;
        },
      };
    }
    return {
      available: true,
      autoRead: false,
      read: async (meta) => {
        if (!(await ensureReadPermission(origin.handle))) throw new Error('Permission to read the folder was denied.');
        try {
          const handle = await resolveFileHandle(origin.handle, meta.path);
          return await handle.getFile();
        } catch (error) {
          if (error instanceof DOMException && error.name === 'NotFoundError') {
            throw new Error('The file was moved or deleted since the folder was indexed. Re-scan the folder.', { cause: error });
          }
          throw error;
        }
      },
    };
  }, [loaded]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (phase === 'indexing') {
    const p = progress;
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <section className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 shadow-card">
          <ProgressBar
            value={p?.fraction ?? null}
            label={
              p?.phase === 'indexing'
                ? 'Building the search index…'
                : p?.phase === 'loading'
                  ? 'Loading the saved index…'
                  : `${progressLabel}…`
            }
            onCancel={() => getClient().cancel()}
          />
          {p && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Counter label="Files" value={formatNumber(p.files, 0)} />
              <Counter label="Folders" value={formatNumber(p.folders, 0)} />
              <Counter label="Text files" value={formatNumber(p.textFiles, 0)} />
              <Counter label="Size read" value={formatBytes(p.bytes)} />
            </div>
          )}
          {p?.current && <p className="truncate font-mono text-[12px] text-fg-muted">{p.current}</p>}
          {p && (p.ignored > 0 || p.errors > 0) && (
            <p className="text-[12.5px] text-fg-muted">
              {p.ignored > 0 && `${pluralize(p.ignored, 'item')} ignored`}
              {p.ignored > 0 && p.errors > 0 && ' · '}
              {p.errors > 0 && <span className="text-warning">{pluralize(p.errors, 'file')} could not be read</span>}
            </p>
          )}
          <p className="flex items-center gap-1.5 text-[12.5px] text-fg-muted">
            <ShieldCheck size={14} className="text-success" aria-hidden /> Everything is processed on this device. Nothing is uploaded.
          </p>
        </section>
      </div>
    );
  }

  if (phase === 'start' || !loaded) {
    return (
      <StartScreen
        support={support}
        options={options}
        onOptions={setOptions}
        onPick={() => void pickFolder()}
        onInputFiles={indexFileList}
        onDrop={onDrop}
        recents={sortedRecents}
        recentsLoading={recents.loading}
        storageProblem={storageProblem}
        onOpenRecent={openRecent}
        onRescanRecent={(r) => r.handle && void rescanHandle(r.handle)}
        onRemoveRecent={(r) => void removeRecent(r)}
        error={startError}
      />
    );
  }

  const s = loaded.summary;
  const origin = loaded.origin;
  const selectedContent = selected && previewContent?.id === selected.id ? previewContent.content : null;
  const preview = selected && (
    <PreviewPane
      key={selected.id}
      meta={selected}
      content={selectedContent}
      loading={previewContent?.id !== selected.id}
      highlight={highlight}
      access={access}
    />
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <FolderOpen size={17} className="shrink-0 text-fg-muted" aria-hidden />
          <h2 className="min-w-0 truncate text-[14px] font-semibold text-fg">{s.rootName}</h2>
          {origin.kind === 'handle' ? (
            <Badge tone="success">Re-scannable</Badge>
          ) : origin.kind === 'session' ? (
            <Badge>This visit only</Badge>
          ) : (
            <Badge>Snapshot</Badge>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {origin.kind === 'handle' ? (
              <Button size="sm" icon={RefreshCw} onClick={() => void rescanHandle(origin.handle)}>
                Re-scan
              </Button>
            ) : (
              <span className="text-[12px] text-fg-muted">To refresh, choose the folder again.</span>
            )}
            <Button size="sm" variant="ghost" icon={X} onClick={close}>
              Close
            </Button>
          </div>
        </div>
        <p className="text-[12.5px] text-fg-secondary">
          {formatNumber(s.fileCount, 0)} files in {formatNumber(s.folderCount, 0)} folders · {formatBytes(s.totalBytes)} ·{' '}
          {formatNumber(s.textFiles, 0)} text files searchable ({formatBytes(s.textChars)} of text) · indexed {timeAgo(s.indexedAt)} in{' '}
          {formatDuration(s.tookMs)}
        </p>
        <IndexNotes summary={s} />
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-line bg-surface p-3 shadow-card sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-72">
            <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={mode === 'regex' ? 'Regular expression, e.g. TODO\\((\\w+)\\)' : mode === 'name' ? 'File name or path…' : 'Search names and contents…'}
              aria-label="Search query"
              autoFocus
              mono={mode === 'regex'}
              className="h-10 pl-9"
            />
          </div>
          <Segmented
            label="Search mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'fulltext', label: 'Full text' },
              { value: 'name', label: 'Name' },
              { value: 'regex', label: 'Regex' },
            ]}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={showFilters ? 'subtle' : 'secondary'}
            icon={Funnel}
            aria-expanded={showFilters}
            onClick={() => setShowFilters((v) => !v)}
          >
            Filters{hasActiveFilters(filters) ? ' (on)' : ''}
          </Button>
          {mode === 'regex' && (
            <Button
              size="sm"
              variant={caseSensitive ? 'subtle' : 'ghost'}
              icon={CaseSensitive}
              aria-pressed={caseSensitive}
              onClick={() => setCaseSensitive((v) => !v)}
            >
              Match case
            </Button>
          )}
          <label className="ml-auto flex items-center gap-2 text-[13px] text-fg-secondary">
            Sort
            <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="h-8 w-auto py-1 text-[13px]">
              <option value="relevance">{query.trim() ? 'Relevance' : 'Path'}</option>
              <option value="name">Name</option>
              <option value="path">Path</option>
              <option value="size">Size (largest)</option>
              <option value="modified">Modified (newest)</option>
            </Select>
          </label>
        </div>
        {showFilters && <FiltersPanel filters={filters} onChange={setFilters} extensions={s.extensions} />}
      </section>

      <ErrorMessage error={searchError} title="Search failed" />
      {response?.relaxed && (
        <Alert tone="info">No file contains all of the words, so files containing any of them are shown.</Alert>
      )}
      {response?.partial && <Alert tone="warning">The search stopped after 30 seconds, so these results are incomplete.</Alert>}

      <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section className="flex min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card">
          <header className="flex min-h-10 items-center justify-between gap-2 border-b border-line px-3 py-2 text-[12.5px] text-fg-muted">
            <span aria-live="polite">
              {response
                ? `${pluralize(response.total, query.trim() ? 'match' : 'file', query.trim() ? 'matches' : 'files')}${
                    response.total > response.items.length ? ` · showing ${formatNumber(response.items.length, 0)}` : ''
                  } · ${formatDuration(response.tookMs)}`
                : 'Searching…'}
            </span>
            {searching && <Spinner size={13} />}
          </header>
          {response && response.items.length === 0 && !searching ? (
            <EmptyState icon={Search} title={query.trim() ? 'No matches' : 'No files match the filters'}>
              {query.trim() && mode === 'fulltext'
                ? 'Try fewer words, the Name mode for partial file names, or Regex for exact patterns.'
                : 'Adjust the filters or the query.'}
            </EmptyState>
          ) : (
            <div className={cn('min-h-0', isDesktop && 'max-h-[calc(100dvh-200px)] overflow-y-auto')}>
              {response && <ResultList items={response.items} selectedId={selected?.id ?? null} onSelect={select} />}
              {response && response.total > response.items.length && (
                <div className="border-t border-line p-2 text-center">
                  <Button size="sm" variant="ghost" onClick={() => setLimit((l) => Math.min(2000, l + PAGE))} disabled={limit >= 2000}>
                    {limit >= 2000 ? 'Refine the search to see more' : `Show ${Math.min(PAGE, response.total - response.items.length)} more`}
                  </Button>
                </div>
              )}
            </div>
          )}
        </section>

        {isDesktop && (
          <section className="min-w-0 self-start rounded-xl border border-line bg-surface p-4 shadow-card lg:sticky lg:top-4">
            {preview || <EmptyState icon={Search} title="Select a result to preview it" />}
          </section>
        )}
      </div>

      {!isDesktop && (
        <Dialog open={previewOpen && Boolean(selected)} onClose={() => setPreviewOpen(false)} title="Preview" size="lg">
          {preview}
        </Dialog>
      )}
    </div>
  );
}

function Counter({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface-sunken px-3 py-2">
      <div className="text-[12px] text-fg-muted">{label}</div>
      <div className="font-mono text-[15px] font-semibold text-fg tabular-nums">{value}</div>
    </div>
  );
}

function IndexNotes({ summary: s }: { summary: IndexSummary }) {
  const [showErrors, setShowErrors] = useState(false);
  const notes: string[] = [];
  if (s.ignored) notes.push(`${pluralize(s.ignored, 'item')} skipped by ignore rules`);
  if (s.tooLarge) notes.push(`${pluralize(s.tooLarge, 'text file')} over ${formatBytes(s.maxTextBytes)} indexed by name only`);
  if (s.binary) notes.push(`${pluralize(s.binary, 'binary file')} not content-searchable`);
  return (
    <div className="flex flex-col gap-2">
      {notes.length > 0 && <p className="text-[12px] text-fg-muted">{notes.join(' · ')}</p>}
      {s.overBudget > 0 && (
        <Alert tone="warning" title="Content index limit reached">
          The index holds at most {formatBytes(64 * 1024 * 1024)} of text to keep the browser responsive. The contents of{' '}
          {pluralize(s.overBudget, 'file')} were not stored; their names and paths are still searchable. Add large folders to the ignore list
          or lower the per-file size limit to include more files.
        </Alert>
      )}
      {s.errorCount > 0 && (
        <div className="text-[12.5px]">
          <button type="button" className="text-warning underline-offset-2 hover:underline" onClick={() => setShowErrors((v) => !v)} aria-expanded={showErrors}>
            {pluralize(s.errorCount, 'file')} could not be read
          </button>
          {showErrors && (
            <ul className="mt-1.5 max-h-40 overflow-y-auto rounded-md border border-line bg-surface-sunken p-2 font-mono text-[11.5px]">
              {s.errors.map((e, i) => (
                <li key={i} className="flex gap-2">
                  <span className="min-w-0 truncate text-fg">{e.path}</span>
                  <span className="shrink-0 text-fg-muted">{e.message}</span>
                </li>
              ))}
              {s.errorCount > s.errors.length && <li className="text-fg-muted">… and {s.errorCount - s.errors.length} more</li>}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

