import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EditorView } from '@codemirror/view';
import {
  Check,
  Columns2,
  Code,
  Eye,
  FileCode,
  ImageDown,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  Trash,
  TriangleAlert,
  Workflow,
} from 'lucide-react';
import { CodeEditor } from '@/components/editor/CodeEditor';
import { Button, IconButton } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/Actions';
import { Alert } from '@/components/ui/Alert';
import { ConfirmDialog } from '@/components/ui/Dialog';
import { EmptyState, Spinner } from '@/components/ui/Feedback';
import { Label, Select } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { toast } from '@/components/ui/Toast';
import { useDebouncedValue, useMediaQuery, useToolState } from '@/lib/hooks';
import { collection, kvGet, kvSet, newId, useCollection } from '@/lib/storage/db';
import { useTheme } from '@/lib/theme';
import { cn, downloadBlob, errorMessage } from '@/lib/utils';
import { describeMermaidError, diagramFileName, sizedSvg, standaloneSvg, uniqueName, type DiagramError, type DiagramRecord } from './lib/diagrams';
import { renderMermaid, THEME_BACKGROUND, type MermaidTheme } from './lib/mermaid';
import { svgToPng } from './lib/raster';
import { AutosaveSession, patchRecord, removeRecord } from './lib/store';
import { DEFAULT_TEMPLATE, detectDiagramKind, getTemplate, type DiagramTemplate } from './lib/templates';
import { ZoomCanvas, type ZoomCanvasHandle } from './components/ZoomCanvas';
import { RenameDialog, TemplateDialog } from './components/DiagramDialogs';

const TOOL = 'mermaid-studio';
const store = collection<DiagramRecord>('diagrams');
const SEEDED_KEY = 'diagrams:seeded';

type ThemeChoice = 'auto' | MermaidTheme;
type ViewMode = 'split' | 'code' | 'preview';

const THEME_OPTIONS: Array<{ value: ThemeChoice; label: string }> = [
  { value: 'auto', label: 'Match app theme' },
  { value: 'default', label: 'Default' },
  { value: 'dark', label: 'Dark' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'forest', label: 'Forest' },
];

function makeRecord(template: DiagramTemplate, existing: string[]): DiagramRecord {
  const now = Date.now();
  return {
    id: newId(),
    name: uniqueName(template.name, existing),
    code: template.code,
    templateId: template.id,
    createdAt: now,
    updatedAt: now,
  };
}

export default function DiagramStudio() {
  const { items, loading, error: storeError } = useCollection(store);
  const [activeId, setActiveId] = useToolState(TOOL, 'active', '');
  const [themeChoice, setThemeChoice] = useToolState<ThemeChoice>(TOOL, 'theme', 'auto');
  const [mode, setMode] = useToolState<ViewMode>(TOOL, 'mode', 'split');
  const [dialog, setDialog] = useState<'new' | 'rename' | 'delete' | null>(null);
  const appTheme = useTheme().resolved;
  const theme: MermaidTheme = themeChoice === 'auto' ? (appTheme === 'dark' ? 'dark' : 'default') : themeChoice;

  const sorted = useMemo(() => [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })), [items]);
  const active = items.find((d) => d.id === activeId) ?? [...items].sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // First visit: create one example diagram (only once, so deleting everything stays deleted).
  const seeding = useRef(false);
  useEffect(() => {
    if (loading || items.length > 0 || seeding.current) return;
    seeding.current = true;
    void (async () => {
      if (await kvGet<boolean>(SEEDED_KEY)) return;
      await kvSet(SEEDED_KEY, true);
      const record = makeRecord(DEFAULT_TEMPLATE, []);
      await store.put(record);
      setActiveId(record.id);
    })().catch(() => undefined);
  }, [loading, items.length, setActiveId]);

  /** Another tab saved this diagram while this tab was editing it: keep that version as a separate diagram. */
  const keepConflict = useCallback(async (theirs: DiagramRecord) => {
    const now = Date.now();
    const copy: DiagramRecord = {
      ...theirs,
      id: newId(),
      name: uniqueName(`${theirs.name} (conflicted copy)`, itemsRef.current.map((d) => d.name)),
      createdAt: now,
      updatedAt: now,
    };
    await store.put(copy);
    toast(`This diagram was also changed in another tab. That version was kept as “${copy.name}”.`, 'info', 8000);
  }, []);

  async function create(template: DiagramTemplate) {
    const record = makeRecord(
      template,
      items.map((d) => d.name),
    );
    try {
      await store.put(record);
      setActiveId(record.id);
      setDialog(null);
    } catch (err) {
      toast(errorMessage(err, 'Could not create the diagram.'), 'error');
    }
  }

  async function rename(name: string) {
    if (!active) return;
    setDialog(null);
    try {
      await patchRecord(store, active.id, { name });
    } catch (err) {
      toast(errorMessage(err, 'Could not rename the diagram.'), 'error');
    }
  }

  async function remove() {
    if (!active) return;
    const id = active.id;
    setDialog(null);
    try {
      await removeRecord(store, id);
      const next = [...items].filter((d) => d.id !== id).sort((a, b) => b.updatedAt - a.updatedAt)[0];
      setActiveId(next?.id ?? '');
      toast(`Deleted "${active.name}".`);
    } catch (err) {
      toast(errorMessage(err, 'Could not delete the diagram.'), 'error');
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center rounded-xl border border-line bg-surface py-20">
        <Spinner label="Loading diagrams…" />
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {storeError && <Alert tone="warning" title="Diagrams could not be read from browser storage">{storeError}</Alert>}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
        {sorted.length > 0 && active && (
          <div className="min-w-0 flex-1 basis-56 sm:max-w-xs">
            <Label htmlFor="lk-diagram-select">Diagram</Label>
            <Select id="lk-diagram-select" value={active.id} onChange={(e) => setActiveId(e.target.value)} className="h-8 py-1 text-[13px]">
              {sorted.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="primary" icon={Plus} onClick={() => setDialog('new')}>
            New
          </Button>
          {active && (
            <>
              <Button size="sm" icon={Pencil} onClick={() => setDialog('rename')}>
                Rename
              </Button>
              <Button size="sm" variant="ghost" icon={Trash} onClick={() => setDialog('delete')}>
                Delete
              </Button>
            </>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3 sm:ml-auto">
          <div>
            <Label htmlFor="lk-diagram-theme">Diagram theme</Label>
            <Select
              id="lk-diagram-theme"
              value={themeChoice}
              onChange={(e) => setThemeChoice(e.target.value as ThemeChoice)}
              className="h-8 w-44 py-1 text-[13px]"
            >
              {THEME_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          <Segmented
            label="Layout"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'split', label: 'Split', icon: Columns2 },
              { value: 'code', label: 'Code', icon: Code },
              { value: 'preview', label: 'Preview', icon: Eye },
            ]}
          />
        </div>
      </div>

      {active ? (
        <DiagramWorkspace key={active.id} record={active} theme={theme} mode={mode} onConflict={keepConflict} />
      ) : (
        <div className="rounded-xl border border-line bg-surface shadow-card">
          <EmptyState
            icon={Workflow}
            title="No diagrams yet"
            action={
              <Button variant="primary" icon={Plus} onClick={() => setDialog('new')}>
                New diagram
              </Button>
            }
          >
            Write flowcharts, sequence diagrams, Gantt charts and more as text, and export them as SVG or PNG. Diagrams are saved in
            this browser only.
          </EmptyState>
        </div>
      )}

      <TemplateDialog open={dialog === 'new'} onClose={() => setDialog(null)} onPick={(t) => void create(t)} />
      <RenameDialog open={dialog === 'rename'} initial={active?.name ?? ''} onClose={() => setDialog(null)} onSave={(n) => void rename(n)} />
      <ConfirmDialog open={dialog === 'delete'} onCancel={() => setDialog(null)} onConfirm={() => void remove()} title="Delete diagram?">
        “{active?.name}” will be permanently removed from this browser.
      </ConfirmDialog>
    </div>
  );
}

type SaveState = 'saved' | 'pending' | 'saving' | 'error';

function DiagramWorkspace({
  record,
  theme,
  mode,
  onConflict,
}: {
  /** The latest stored version (refreshes when this or another tab saves). */
  record: DiagramRecord;
  theme: MermaidTheme;
  mode: ViewMode;
  /** Keeps another tab's version that this editor is about to overwrite. */
  onConflict: (theirs: DiagramRecord) => Promise<void>;
}) {
  const [code, setCode] = useState(record.code);
  const codeRef = useRef(code);
  const onConflictRef = useRef(onConflict);
  onConflictRef.current = onConflict;
  const [session] = useState(
    () =>
      new AutosaveSession<DiagramRecord, 'code'>({
        coll: store,
        initial: record,
        read: () => ({ code: codeRef.current }),
        conflictField: 'code',
        onConflict: (theirs) => onConflictRef.current(theirs),
      }),
  );
  const [save, setSave] = useState<SaveState>('saved');
  const [confirmReset, setConfirmReset] = useState(false);
  const [exporting, setExporting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const editorView = useRef<EditorView | null>(null);
  const canvas = useRef<ZoomCanvasHandle>(null);
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (!session.pending) return;
    setSave('saving');
    try {
      const saved = await session.save();
      setSave(saved === null ? 'error' : session.pending ? 'pending' : 'saved');
    } catch {
      setSave('error');
    }
  }, [session]);

  /** Starts the write in this task: after pagehide an awaited read would never finish, losing the last edits. */
  const saveNow = useCallback(() => {
    clearTimeout(timer.current);
    const write = session.saveNow();
    if (!write) return;
    setSave('saving');
    write.then(
      () => setSave(session.pending ? 'pending' : 'saved'),
      () => setSave('error'),
    );
  }, [session]);

  function onChange(value: string) {
    setCode(value);
    codeRef.current = value;
    session.markDirty(['code']);
    setSave('pending');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 600);
  }

  // A newer version saved in another tab: show it unless this tab has unsaved changes (those win, theirs is kept as a copy).
  useEffect(() => {
    const adopt = session.observe(record);
    if (adopt?.code === undefined) return;
    codeRef.current = adopt.code;
    setCode(adopt.code);
  }, [record, session]);

  // Save outstanding edits when switching diagrams, leaving the page or hiding the tab.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') saveNow();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', saveNow);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', saveNow);
      void flush();
    };
  }, [flush, saveNow]);

  // --- Rendering -----------------------------------------------------------
  const debounced = useDebouncedValue(code, 250);
  const [svg, setSvg] = useState<string | null>(null);
  const [renderError, setRenderError] = useState<DiagramError | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);
  const renderedFor = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!debounced.trim()) {
      setSvg(null);
      setRenderError(null);
      setRendering(false);
      renderedFor.current = debounced;
      return;
    }
    setRendering(true);
    renderMermaid(debounced, theme)
      .then((out) => {
        if (cancelled) return;
        setSvg(out);
        setRenderError(null);
        setLoadError(null);
        renderedFor.current = debounced;
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof Error && /dynamically imported module|Importing a module script failed|Loading chunk/i.test(err.message)) {
          setLoadError('The diagram renderer could not be loaded. Check your connection and reload the page.');
          return;
        }
        setRenderError(describeMermaidError(err, debounced));
      })
      .finally(() => {
        if (!cancelled) setRendering(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, theme]);

  const displaySvg = useMemo(() => (svg ? sizedSvg(svg) : null), [svg]);
  const stale = Boolean(renderError && svg);
  const background = THEME_BACKGROUND[theme];
  const kind = detectDiagramKind(code);
  const template = getTemplate(record.templateId);
  const fileBase = diagramFileName(record.name);

  function goToLine(line: number, column: number | null) {
    const view = editorView.current;
    if (!view) return;
    const target = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines));
    const selection =
      column === null
        ? { anchor: target.from, head: target.to }
        : { anchor: Math.min(target.from + column - 1, target.to) };
    view.dispatch({ selection, scrollIntoView: true });
    view.focus();
  }

  function exportSvg() {
    if (!svg) return;
    downloadBlob(standaloneSvg(svg, background), `${fileBase}.svg`, 'image/svg+xml');
  }

  async function exportPng() {
    if (!svg) return;
    setExporting(true);
    try {
      downloadBlob(await svgToPng(svg, background, 2), `${fileBase}.png`, 'image/png');
    } catch (err) {
      toast(errorMessage(err, 'PNG export failed. Try exporting as SVG instead.'), 'error');
    } finally {
      setExporting(false);
    }
  }

  const showCode = mode !== 'preview';
  const showPreview = mode !== 'code';
  const paneHeight = 'h-[420px] lg:h-[max(440px,calc(100dvh-420px))]';

  return (
    <div className={cn('grid min-w-0 grid-cols-1 gap-4', showCode && showPreview && 'lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]')}>
      {showCode && (
        <section className="flex min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card">
          <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-line py-1.5 pr-2 pl-4">
            <div className="flex min-w-0 items-center gap-2">
              <h2 className="text-[13px] font-semibold tracking-tight text-fg">Mermaid source</h2>
              {kind && <Badge>{getTemplate(kind)?.name ?? kind}</Badge>}
            </div>
            <div className="flex items-center gap-1">
              <SaveIndicator state={save} />
              {template && (
                <IconButton
                  icon={RotateCcw}
                  label="Reset to example"
                  size="sm"
                  disabled={code === template.code}
                  onClick={() => setConfirmReset(true)}
                />
              )}
              <CopyButton value={code} label="Copy source" iconOnly />
            </div>
          </header>
          <div className={cn('min-h-0 p-2', paneHeight)}>
            <CodeEditor
              value={code}
              onChange={onChange}
              language="mermaid"
              ariaLabel="Mermaid source"
              placeholder="Write Mermaid code, e.g. flowchart LR"
              lineWrapping={false}
              className="h-full"
              onReady={(v) => (editorView.current = v)}
            />
          </div>
          <footer className="border-t border-line px-3 py-2 text-[12.5px]" aria-live="polite">
            {renderError ? (
              <div role="alert" className="flex items-start gap-2 text-danger">
                <TriangleAlert size={15} className="mt-px shrink-0" aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {renderError.line !== null
                      ? `Line ${renderError.line}${renderError.column !== null ? `, column ${renderError.column}` : ''}: `
                      : ''}
                    {renderError.message}
                  </p>
                  {renderError.sourceLine !== null && renderError.sourceLine.trim() && (
                    <pre className="mt-1 overflow-x-auto rounded bg-danger-soft px-2 py-1 font-mono text-[12px] text-fg">
                      {renderError.sourceLine}
                    </pre>
                  )}
                </div>
                {renderError.line !== null && (
                  <Button size="sm" variant="ghost" className="h-7 text-danger" onClick={() => goToLine(renderError.line!, renderError.column)}>
                    Go to line
                  </Button>
                )}
              </div>
            ) : (
              <span className="text-fg-muted">
                {code.trim() ? (rendering ? 'Rendering…' : 'Diagram is valid.') : 'Write Mermaid code, or reset to the example.'}
              </span>
            )}
          </footer>
        </section>
      )}

      {showPreview && (
        <section className="flex min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card">
          <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-line py-1.5 pr-2 pl-4">
            <div className="flex items-center gap-2">
              <h2 className="text-[13px] font-semibold tracking-tight text-fg">Preview</h2>
              {stale && <Badge tone="warning">Stale: last valid render</Badge>}
              {rendering && !stale && <LoaderCircle size={14} className="animate-spin text-fg-muted" aria-label="Rendering" />}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Button size="sm" icon={FileCode} disabled={!svg} onClick={exportSvg}>
                SVG
              </Button>
              <Button size="sm" icon={ImageDown} disabled={!svg} loading={exporting} onClick={() => void exportPng()}>
                PNG
              </Button>
            </div>
          </header>
          <div className={cn('min-h-0 p-2', paneHeight)}>
            {loadError ? (
              <Alert tone="danger" title="Renderer unavailable">
                {loadError}
              </Alert>
            ) : displaySvg ? (
              <ZoomCanvas
                svg={displaySvg}
                background={background}
                stale={stale}
                fitKey={`${record.id}:${isDesktop ? 'd' : 'm'}:${mode}`}
                handleRef={canvas}
                className="h-full"
              />
            ) : rendering ? (
              <div className="flex h-full items-center justify-center rounded-lg border border-line bg-surface-sunken">
                <Spinner label="Rendering diagram…" />
              </div>
            ) : (
              <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-line-strong bg-surface-sunken">
                <EmptyState icon={Workflow} title={renderError ? 'Nothing to show yet' : 'Empty diagram'}>
                  {renderError ? 'Fix the error in the source to see the diagram.' : 'The preview appears here as you type.'}
                </EmptyState>
              </div>
            )}
          </div>
          <footer className="border-t border-line px-4 py-2 text-[12px] text-fg-muted">
            Drag to pan. Zoom with Ctrl + wheel, a pinch or the buttons. Double-click to fit.
          </footer>
        </section>
      )}

      <ConfirmDialog
        open={confirmReset}
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => {
          setConfirmReset(false);
          if (template) onChange(template.code);
        }}
        title="Reset to the example?"
        confirmLabel="Reset"
      >
        Your changes to “{record.name}” will be replaced with the original {template?.name.toLowerCase()} example.
      </ConfirmDialog>
    </div>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  if (state === 'error') {
    return <span className="px-1.5 text-[12px] font-medium text-danger">Not saved</span>;
  }
  const saved = state === 'saved';
  return (
    <span className="inline-flex items-center gap-1 px-1.5 text-[12px] text-fg-muted" aria-live="polite">
      {saved ? <Check size={13} className="text-success" aria-hidden /> : <LoaderCircle size={13} className="animate-spin" aria-hidden />}
      {saved ? 'Saved' : 'Saving…'}
    </span>
  );
}
