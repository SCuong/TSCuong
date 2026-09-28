import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Code,
  Database,
  Download,
  FilePlus,
  FlaskConical,
  FolderOpen,
  Info,
  Lock,
  LockOpen,
  PanelLeft,
  Table2,
  TableProperties,
  X,
} from 'lucide-react';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { EmptyState, ProgressBar } from '@/components/ui/Feedback';
import { FileDrop } from '@/components/ui/FileDrop';
import { Switch } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { toast } from '@/components/ui/Toast';
import { useMediaQuery, useToolState } from '@/lib/hooks';
import { downloadBlob, errorMessage, formatBytes, formatNumber } from '@/lib/utils';
import type { DbInfo, OpenSource, SchemaObject, TableDetails } from './lib/protocol';
import { parseSqliteHeader } from './lib/sqliteHeader';
import { SAMPLE_QUERY } from './lib/sample';
import { SqliteClient } from './sqliteClient';
import { BrowsePanel } from './components/BrowsePanel';
import { Drawer } from './components/Drawer';
import { SchemaSidebar } from './components/SchemaSidebar';
import { SqlPanel } from './components/SqlPanel';
import { InfoPanel, StructurePanel } from './components/StructurePanel';
import type { SqlCall } from './components/types';

const TOOL_ID = 'sqlite-viewer';
const LARGE_FILE = 500 * 1024 * 1024;
const ACCEPT = '.sqlite,.sqlite3,.db,.db3,.s3db,.sl3,.gpkg,.mbtiles';

type Source = { kind: 'file'; file: File } | { kind: 'sample' } | { kind: 'empty' };
type Tab = 'browse' | 'sql' | 'structure' | 'info';

function sourceName(source: Source): string {
  if (source.kind === 'file') return source.file.name;
  return source.kind === 'sample' ? 'sample-store.sqlite' : 'untitled.sqlite';
}

async function readWithProgress(file: File, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<ArrayBuffer> {
  const buffer = new Uint8Array(file.size);
  const reader = file.stream().getReader();
  let offset = 0;
  let lastReport = 0;
  for (;;) {
    if (signal.aborted) {
      await reader.cancel();
      throw new DOMException('Aborted', 'AbortError');
    }
    const { done, value } = await reader.read();
    if (done) break;
    if (offset + value.length > buffer.length) throw new Error('The file changed while it was being read.');
    buffer.set(value, offset);
    offset += value.length;
    const now = performance.now();
    if (now - lastReport > 60) {
      lastReport = now;
      onProgress(offset / Math.max(1, file.size));
    }
  }
  return buffer.buffer;
}

export default function SqliteStudio() {
  const clientRef = useRef<SqliteClient | null>(null);
  const loadAbort = useRef<AbortController | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready'>('idle');
  const [progress, setProgress] = useState<{ value: number | null; label: string }>({ value: null, label: '' });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [originalSize, setOriginalSize] = useState<number | null>(null);
  const [schema, setSchema] = useState<SchemaObject[]>([]);
  const [info, setInfo] = useState<DbInfo | null>(null);
  const [readOnly, setReadOnly] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<Tab>('browse');
  const [selected, setSelected] = useState<SchemaObject | null>(null);
  const [details, setDetails] = useState<TableDetails | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pendingLarge, setPendingLarge] = useState<File | null>(null);
  const [confirmWrite, setConfirmWrite] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [sql, setSql] = useToolState(TOOL_ID, 'sql', SAMPLE_QUERY);
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  useEffect(
    () => () => {
      loadAbort.current?.abort();
      clientRef.current?.terminate('Closed.');
    },
    [],
  );

  const call: SqlCall = useCallback((type, payload, options) => {
    const client = clientRef.current;
    if (!client) return Promise.reject(new Error('No database is open.'));
    return client.call(type, payload, options);
  }, []);

  const refresh = useCallback(async () => {
    const [nextSchema, nextInfo] = await Promise.all([call('schema', null), call('info', null)]);
    setSchema(nextSchema);
    setInfo(nextInfo);
    return nextSchema;
  }, [call]);

  const open = useCallback(
    async (next: Source, options: { keepMode?: boolean } = {}) => {
      loadAbort.current?.abort();
      const ctrl = new AbortController();
      loadAbort.current = ctrl;
      clientRef.current?.terminate('A different database was opened.');
      const client = new SqliteClient();
      clientRef.current = client;
      setPhase('loading');
      setLoadError(null);
      setProgress({ value: null, label: 'Preparing…' });
      const ro = options.keepMode ? readOnly : next.kind !== 'empty';
      try {
        let openSource: OpenSource;
        const transfer: Transferable[] = [];
        if (next.kind === 'file') {
          const head = new Uint8Array(await next.file.slice(0, 100).arrayBuffer());
          const header = parseSqliteHeader(head, next.file.size);
          if (!header.ok) throw new Error(header.error);
          setProgress({ value: 0, label: `Reading ${next.file.name}…` });
          const bytes = await readWithProgress(next.file, (f) => setProgress({ value: f, label: `Reading ${next.file.name}…` }), ctrl.signal);
          openSource = { kind: 'bytes', bytes };
          transfer.push(bytes);
        } else {
          openSource = { kind: next.kind };
        }
        await client.call('open', { source: openSource, readOnly: ro }, {
          transfer,
          onProgress: (label) => !ctrl.signal.aborted && setProgress({ value: null, label }),
        });
        if (ctrl.signal.aborted) return;
        setSource(next);
        setOriginalSize(next.kind === 'file' ? next.file.size : null);
        setReadOnly(ro);
        setDirty(false);
        const objects = await refresh();
        if (!options.keepMode) {
          const firstTable = objects.find((o) => o.type === 'table' && !o.internal) ?? null;
          setSelected(firstTable);
          setTab(firstTable ? 'browse' : 'sql');
        }
        setRefreshKey((k) => k + 1);
        setPhase('ready');
        if (next.kind === 'empty' && !options.keepMode) toast('New empty database created. Write mode is on.', 'info');
      } catch (error) {
        if (ctrl.signal.aborted) return;
        client.terminate('Loading failed.');
        if (clientRef.current === client) clientRef.current = null;
        setLoadError(errorMessage(error, 'The database could not be opened.'));
        setPhase('idle');
        setSource(null);
      }
    },
    [readOnly, refresh],
  );

  // Load details (columns, FKs, indexes) for the selected table/view.
  useEffect(() => {
    if (phase !== 'ready' || !selected || (selected.type !== 'table' && selected.type !== 'view')) {
      setDetails(null);
      return;
    }
    let cancelled = false;
    call('tableDetails', { name: selected.name })
      .then((d) => !cancelled && setDetails(d))
      .catch(() => !cancelled && setDetails(null));
    return () => {
      cancelled = true;
    };
  }, [call, phase, selected, refreshKey]);

  function chooseFile(file: File) {
    if (file.size > LARGE_FILE) setPendingLarge(file);
    else void open({ kind: 'file', file });
  }

  function cancelLoad() {
    loadAbort.current?.abort();
    clientRef.current?.terminate('Loading cancelled.');
    clientRef.current = null;
    setPhase('idle');
    setSource(null);
  }

  function closeDb() {
    clientRef.current?.terminate('Closed.');
    clientRef.current = null;
    setPhase('idle');
    setSource(null);
    setSchema([]);
    setInfo(null);
    setSelected(null);
    setDirty(false);
    setConfirmClose(false);
  }

  async function setMode(nextReadOnly: boolean) {
    try {
      await call('setReadOnly', { readOnly: nextReadOnly });
      setReadOnly(nextReadOnly);
      toast(nextReadOnly ? 'Read-only mode: writes are blocked.' : 'Write mode on. Changes stay in memory until you export.', 'info');
    } catch (error) {
      toast(errorMessage(error), 'error');
    }
  }

  const onWrote = useCallback(() => {
    setDirty(true);
    void refresh()
      .then((objects) => {
        setSelected((s) => (s ? (objects.find((o) => o.name === s.name && o.type === s.type) ?? null) : s));
        setRefreshKey((k) => k + 1);
      })
      .catch(() => undefined);
  }, [refresh]);

  const onStop = useCallback(() => {
    if (!source) return;
    const lost = dirty;
    void open(source, { keepMode: true }).then(() => {
      toast(lost ? 'Query stopped. The database was reloaded and unsaved changes were discarded.' : 'Query stopped.', 'info', 4500);
    });
  }, [dirty, open, source]);

  async function exportDatabase() {
    if (!source) return;
    try {
      const bytes = await call('exportDb', null);
      const name = sourceName(source);
      downloadBlob(
        new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/vnd.sqlite3' }),
        dirty ? name.replace(/(\.[^.]*)?$/, (ext) => `-edited${ext}`) : name,
      );
      toast(`Exported ${formatBytes(bytes.length)}`);
    } catch (error) {
      toast(errorMessage(error, 'Export failed.'), 'error');
    }
  }

  async function exportTable(name: string, format: 'csv' | 'json' | 'sql') {
    try {
      const res = await call('exportTable', { name, format });
      const type = format === 'csv' ? 'text/csv' : format === 'json' ? 'application/json' : 'application/sql';
      downloadBlob(res.text, `${name}.${format}`, `${type};charset=utf-8`);
      toast(`Exported ${formatNumber(res.rows, 0)} rows from ${name}`);
    } catch (error) {
      toast(errorMessage(error, 'Export failed.'), 'error');
    }
  }

  function selectObject(o: SchemaObject) {
    setSelected(o);
    if (o.type === 'index' || o.type === 'trigger') setTab('structure');
    else if (tab !== 'browse' && tab !== 'structure') setTab('browse');
    setDrawer(false);
  }

  // ---------------------------------------------------------------------------
  // Start screen / loading
  // ---------------------------------------------------------------------------

  if (phase !== 'ready' || !source) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        {phase === 'loading' ? (
          <section className="rounded-xl border border-line bg-surface p-6 shadow-card">
            <ProgressBar value={progress.value} label={progress.label} onCancel={cancelLoad} />
          </section>
        ) : (
          <>
            <FileDrop
              onFiles={([file]) => chooseFile(file)}
              accept={ACCEPT}
              icon={Database}
              title="Drop a SQLite database"
              hint="SQLite 3 files (.sqlite, .db, .sqlite3 …). The file is opened in memory on this device and never uploaded or modified."
              onReject={() => setLoadError(null)}
            />
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button icon={FlaskConical} onClick={() => void open({ kind: 'sample' })}>
                Load sample database
              </Button>
              <Button icon={FilePlus} variant="ghost" onClick={() => void open({ kind: 'empty' })}>
                New empty database
              </Button>
            </div>
            <ErrorMessage error={loadError} title="Could not open the database" />
            <ul className="grid gap-2 text-[13px] text-fg-secondary sm:grid-cols-3">
              <li className="rounded-lg border border-line bg-surface p-3">
                <Lock size={15} className="mb-1.5 text-success" aria-hidden />
                Read-only by default. Writes need an explicit switch, and your file is never changed.
              </li>
              <li className="rounded-lg border border-line bg-surface p-3">
                <TableProperties size={15} className="mb-1.5 text-accent-text" aria-hidden />
                Browse tables with sorting and filters, inspect columns, keys, indexes and triggers.
              </li>
              <li className="rounded-lg border border-line bg-surface p-3">
                <Code size={15} className="mb-1.5 text-accent-text" aria-hidden />
                Run SQL in a background worker and export results, tables or the whole database.
              </li>
            </ul>
          </>
        )}
        <ConfirmDialog
          open={pendingLarge !== null}
          title="Open a very large database?"
          confirmLabel="Open anyway"
          danger={false}
          onCancel={() => setPendingLarge(null)}
          onConfirm={() => {
            const file = pendingLarge;
            setPendingLarge(null);
            if (file) void open({ kind: 'file', file });
          }}
        >
          {pendingLarge && (
            <>
              <p>
                {pendingLarge.name} is {formatBytes(pendingLarge.size)}. The whole database has to be loaded into this tab’s memory, which
                needs roughly twice its size in RAM.
              </p>
              <p className="mt-2">The browser tab may run out of memory and crash, especially on phones.</p>
            </>
          )}
        </ConfirmDialog>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Workspace
  // ---------------------------------------------------------------------------

  const name = sourceName(source);
  const browsable = selected && (selected.type === 'table' || selected.type === 'view');
  const sidebar = <SchemaSidebar objects={schema} selected={selected?.name ?? null} onSelect={selectObject} loadDetails={(n) => call('tableDetails', { name: n })} />;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-line bg-surface px-3 py-2.5 shadow-card sm:px-4">
        <Button size="sm" variant="secondary" icon={PanelLeft} className="lg:hidden" onClick={() => setDrawer(true)}>
          Schema
        </Button>
        <div className="order-first flex min-w-0 flex-1 basis-full items-center gap-2 sm:order-none sm:basis-48">
          <Database size={16} className="shrink-0 text-fg-muted" aria-hidden />
          <span className="truncate font-mono text-[13px] font-semibold text-fg" title={name}>
            {name}
          </span>
          {info && <span className="shrink-0 text-[12px] text-fg-muted">{formatBytes(info.fileSize)}</span>}
          {dirty && <Badge tone="warning">Unsaved changes</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-sunken py-1 pr-2.5 pl-2">
            {readOnly ? <Lock size={14} className="text-success" aria-hidden /> : <LockOpen size={14} className="text-warning" aria-hidden />}
            <Switch
              label="Write mode"
              checked={!readOnly}
              onChange={(on) => (on ? setConfirmWrite(true) : void setMode(true))}
              className="text-[13px]"
            />
          </div>
          <Button size="sm" variant={dirty ? 'primary' : 'secondary'} icon={Download} onClick={() => void exportDatabase()}>
            Export database
          </Button>
          <Button size="sm" variant="ghost" icon={dirty ? X : FolderOpen} onClick={() => (dirty ? setConfirmClose(true) : closeDb())}>
            {dirty ? 'Close' : 'Open another'}
          </Button>
        </div>
      </div>

      {!readOnly && (
        <Alert tone="warning" title="Write mode is on">
          Statements can change the in-memory copy. Destructive statements ask for confirmation. The original file is never modified; use
          “Export database” to save your changes.
        </Alert>
      )}

      <div className="grid min-w-0 gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
        {isDesktop ? (
          <aside className="sticky top-4 max-h-[calc(100dvh-120px)] self-start overflow-y-auto rounded-xl border border-line bg-surface shadow-card">
            {sidebar}
          </aside>
        ) : (
          <Drawer open={drawer} onClose={() => setDrawer(false)} title="Schema">
            {sidebar}
          </Drawer>
        )}

        <main className="flex min-w-0 flex-col gap-3 rounded-xl border border-line bg-surface p-3 shadow-card sm:p-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Segmented
              label="View"
              value={tab}
              onChange={setTab}
              className="max-w-full"
              options={[
                { value: 'browse', label: 'Data', icon: Table2 },
                { value: 'sql', label: 'SQL', icon: Code },
                { value: 'structure', label: 'Structure', icon: TableProperties },
                { value: 'info', label: 'Info', icon: Info },
              ]}
            />
            {selected && (tab === 'browse' || tab === 'structure') && (
              <span className="min-w-0 truncate text-[13px] text-fg-secondary">
                <span className="text-fg-muted">{selected.type} </span>
                <span className="font-mono font-semibold text-fg">{selected.name}</span>
                {selected.rows !== null && <span className="text-fg-muted"> · {formatNumber(selected.rows, 0)} rows</span>}
              </span>
            )}
          </div>

          {tab === 'browse' &&
            (browsable ? (
              <BrowsePanel
                key={`${selected.type}:${selected.name}`}
                call={call}
                object={selected}
                details={details?.name === selected.name ? details : null}
                refreshKey={refreshKey}
                onOpenInEditor={(text) => {
                  setSql(text);
                  setTab('sql');
                }}
                onExportTable={(n, f) => void exportTable(n, f)}
              />
            ) : (
              <EmptyState
                icon={Table2}
                title={schema.some((o) => o.type === 'table') ? 'Choose a table or view' : 'This database has no tables yet'}
                action={
                  !isDesktop ? (
                    <Button size="sm" icon={PanelLeft} onClick={() => setDrawer(true)}>
                      Open schema
                    </Button>
                  ) : (
                    <Button size="sm" icon={Code} onClick={() => setTab('sql')}>
                      Open SQL editor
                    </Button>
                  )
                }
              >
                {schema.some((o) => o.type === 'table')
                  ? 'Pick one from the schema to browse its rows.'
                  : 'Create one with CREATE TABLE in the SQL editor (write mode must be on).'}
              </EmptyState>
            ))}

          {tab === 'sql' && (
            <SqlPanel
              call={call}
              sql={sql}
              onSqlChange={setSql}
              readOnly={readOnly}
              onRequestWriteMode={() => setConfirmWrite(true)}
              onWrote={onWrote}
              onStop={onStop}
            />
          )}

          {tab === 'structure' &&
            (selected ? (
              <StructurePanel object={selected} details={details?.name === selected.name ? details : null} />
            ) : (
              <EmptyState icon={TableProperties} title="Choose a schema object" />
            ))}

          {tab === 'info' && info && <InfoPanel info={info} fileName={name} originalSize={originalSize} />}
        </main>
      </div>

      <ConfirmDialog
        open={confirmWrite}
        title="Turn on write mode?"
        confirmLabel="Enable write mode"
        danger={false}
        onCancel={() => setConfirmWrite(false)}
        onConfirm={() => {
          setConfirmWrite(false);
          void setMode(false);
        }}
      >
        <p>
          INSERT, UPDATE, DELETE, CREATE, DROP and other writes will run against the in-memory copy of <strong className="text-fg">{name}</strong>.
        </p>
        <p className="mt-2">Your original file is never modified. Use “Export database” to download the changed database.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirmClose}
        title="Discard unsaved changes?"
        confirmLabel="Discard and close"
        onCancel={() => setConfirmClose(false)}
        onConfirm={closeDb}
      >
        The database has changes that were not exported. Closing it discards them.
      </ConfirmDialog>
    </div>
  );
}
