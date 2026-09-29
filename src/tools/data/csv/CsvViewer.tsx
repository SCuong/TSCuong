import { useEffect, useState } from 'react';
import {
  BetweenHorizontalStart,
  BetweenVerticalStart,
  FileSpreadsheet,
  FlaskConical,
  PencilLine,
  Redo2,
  TableColumnsSplit,
  TableRowsSplit,
  Undo2,
  X,
} from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { CopyButton, DownloadButton } from '@/components/ui/Actions';
import { Button, IconButton } from '@/components/ui/Button';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { ProgressBar } from '@/components/ui/Feedback';
import { Input, Label, Select, Switch, Textarea } from '@/components/ui/Field';
import { FileDrop } from '@/components/ui/FileDrop';
import { Badge } from '@/components/ui/Panel';
import { useAsyncJob, useToolState } from '@/lib/hooks';
import { baseName, errorMessage, formatBytes, pluralize } from '@/lib/utils';
import { buildTable, delimiterName, parseCsv, type ParseIssue, type Table } from './lib/csv';
import { deleteColumn, deleteRows, demoteHeader, insertColumn, insertRow, promoteHeader, renameColumn, setCell } from './lib/table';
import { CsvGrid, type GridCell } from './components/CsvGrid';
import { CSV_ACCEPT, DelimiterSelect, ENCODINGS } from './components/CsvSource';
import { MAX_ROWS, parseCsvFile } from './components/parseFile';
import { SAMPLE_CSV } from './components/samples';
import { EXPORT_TYPES, exportTable, FilterBar, useTableView, viewSummary, type ExportFormat } from './components/TableTools';

const TOOL = 'csv-viewer';
/** Editing copies row arrays, so it is limited to tables that stay snappy. */
const EDIT_MAX_ROWS = 250_000;
const EDIT_MAX_CELLS = 5_000_000;
const HISTORY = 40;

type Origin = { kind: 'file'; file: File } | { kind: 'text'; text: string; name: string };

interface Doc {
  table: Table;
  header: boolean;
  delimiter: string;
  linebreak: string;
  issues: ParseIssue[];
  raggedRows: number;
  truncated: boolean;
}

export default function CsvViewer() {
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [delimiter, setDelimiter] = useToolState(TOOL, 'delimiter', '');
  const [encoding, setEncoding] = useToolState(TOOL, 'encoding', 'utf-8');
  const [headerPref, setHeaderPref] = useToolState(TOOL, 'header', true);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [undo, setUndo] = useState<Table[]>([]);
  const [redo, setRedo] = useState<Table[]>([]);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<GridCell | null>(null);
  const [paste, setPaste] = useState('');
  const [confirm, setConfirm] = useState<null | { title: string; action: () => void; label: string }>(null);
  const [renaming, setRenaming] = useState<{ col: number; value: string } | null>(null);
  const [exportVisible, setExportVisible] = useState(false);
  const job = useAsyncJob();
  const { run } = job;

  const table = doc?.table ?? null;
  const view = useTableView(table);

  // (Re)parse whenever the source or the parse options change.
  useEffect(() => {
    if (!origin) return;
    let active = true;
    if (origin.kind === 'text') {
      const parsed = parseCsv(origin.text, { delimiter, header: false });
      const { table: t, raggedRows } = buildTable(parsed.table.rows, headerPref);
      queueMicrotask(() => {
        if (!active) return;
        setDoc({
          table: t,
          header: headerPref,
          delimiter: parsed.delimiter,
          linebreak: parsed.linebreak,
          issues: parsed.issues,
          raggedRows,
          truncated: false,
        });
        setError(null);
      });
    } else {
      run(async ({ signal, progress }) => {
        progress(0, 'Reading file…');
        const parsed = await parseCsvFile(origin.file, { delimiter, encoding, signal, onProgress: progress });
        if (!active) return;
        const { table: t, raggedRows } = buildTable(parsed.records, headerPref);
        setDoc({
          table: t,
          header: headerPref,
          delimiter: parsed.delimiter,
          linebreak: parsed.linebreak,
          issues: parsed.issues,
          raggedRows,
          truncated: parsed.truncated,
        });
        setError(null);
      }).catch((e: unknown) => {
        if (!active || (e instanceof DOMException && e.name === 'AbortError')) return;
        setError(errorMessage(e, 'Could not read the file.'));
      });
    }
    return () => {
      active = false;
    };
    // headerPref is applied at load time only; afterwards the header toggle edits the live table.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin, delimiter, encoding, run]);

  function reset() {
    setDoc(null);
    setUndo([]);
    setRedo([]);
    setDirty(false);
    setSelected(null);
    setError(null);
    view.setFilter('');
    view.setSort(null);
  }

  /** Run an action that would throw away edits, asking first when there are any. */
  function guard(title: string, label: string, action: () => void) {
    if (dirty) setConfirm({ title, label, action });
    else action();
  }

  function openFile(file: File) {
    reset();
    setOrigin({ kind: 'file', file });
  }

  function openText(text: string, name: string) {
    if (!text.trim()) return;
    reset();
    setOrigin({ kind: 'text', text, name });
  }

  function close() {
    job.cancel();
    reset();
    setOrigin(null);
  }

  function changeParse(apply: () => void) {
    guard('Re-read the data?', 'Discard edits', () => {
      setUndo([]);
      setRedo([]);
      setDirty(false);
      setSelected(null);
      apply();
    });
  }

  const cells = table ? table.rows.length * table.headers.length : 0;
  const editable = Boolean(table && table.rows.length <= EDIT_MAX_ROWS && cells <= EDIT_MAX_CELLS);

  function commit(next: Table) {
    if (!doc || next === doc.table) return;
    setUndo((u) => [...u.slice(-(HISTORY - 1)), doc.table]);
    setRedo([]);
    setDoc({ ...doc, table: next });
    setDirty(true);
  }

  function stepHistory(direction: 'undo' | 'redo') {
    if (!doc) return;
    const from = direction === 'undo' ? undo : redo;
    const prev = from.at(-1);
    if (!prev) return;
    if (direction === 'undo') {
      setUndo(from.slice(0, -1));
      setRedo((r) => [...r, doc.table]);
    } else {
      setRedo(from.slice(0, -1));
      setUndo((u) => [...u, doc.table]);
    }
    setDoc({ ...doc, table: prev });
    setDirty(true);
    setSelected(null);
  }

  useEffect(() => {
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) return;
      const key = e.key.toLowerCase();
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault();
        stepHistory('undo');
      } else if (key === 'y' || (key === 'z' && e.shiftKey)) {
        e.preventDefault();
        stepHistory('redo');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ------------------------------------------------------------------ empty state
  if (!origin) {
    return (
      <ToolStack>
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
          <FileDrop
            className="[&>div]:h-full"
            accept={CSV_ACCEPT}
            onFiles={(files) => files[0] && openFile(files[0])}
            icon={FileSpreadsheet}
            title="Drop a CSV or TSV file"
            hint="Parsed in a background thread on this device. Millions of rows are fine."
          />
          <section className="flex min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card">
            <header className="flex min-h-11 items-center justify-between gap-2 border-b border-line py-1.5 pr-2 pl-4">
              <h2 className="text-[13px] font-semibold tracking-tight text-fg">Or paste CSV</h2>
              <IconButton icon={FlaskConical} label="Load sample" size="sm" onClick={() => openText(SAMPLE_CSV, 'sample.csv')} />
            </header>
            <div className="p-2">
              <Textarea
                value={paste}
                onChange={(e) => setPaste(e.target.value)}
                placeholder={'name,email\nAda,ada@example.com'}
                aria-label="CSV text"
                className="h-44 resize-none whitespace-pre"
                wrap="off"
              />
            </div>
            <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2">
              <span className="text-[12.5px] text-fg-muted">
                {paste ? formatBytes(new Blob([paste]).size) : 'Commas, semicolons, tabs or pipes'}
              </span>
              <Button variant="primary" size="sm" disabled={!paste.trim()} onClick={() => openText(paste, 'pasted.csv')}>
                Open table
              </Button>
            </footer>
          </section>
        </div>
        <ParseOptions
          delimiter={delimiter}
          setDelimiter={setDelimiter}
          encoding={encoding}
          setEncoding={setEncoding}
          header={headerPref}
          setHeader={setHeaderPref}
        />
      </ToolStack>
    );
  }

  // ------------------------------------------------------------------ loaded
  const name = origin.kind === 'file' ? origin.file.name : origin.name;
  const selRow = selected ? view.indices[selected.row] : undefined;
  const selCol = selected?.col;
  const exportIndices = exportVisible && view.active ? view.indices : undefined;
  const exportName = (format: ExportFormat) => `${baseName(name)}${dirty ? '-edited' : ''}.${format}`;

  return (
    <ToolStack>
      <section className="flex min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card">
        <header className="flex min-h-12 flex-wrap items-center gap-3 border-b border-line px-4 py-2">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-raised text-fg-secondary">
            <FileSpreadsheet size={16} aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="flex min-w-0 items-center gap-2 text-[13.5px] font-medium text-fg">
              <span className="truncate" title={name}>
                {name}
              </span>
              {dirty && <Badge tone="accent">Edited</Badge>}
            </p>
            <p className="text-[12px] text-fg-muted">
              {origin.kind === 'file' ? formatBytes(origin.file.size) : 'Pasted text'}
              {doc && ` · ${delimiterName(doc.delimiter)} · ${doc.linebreak === '\r\n' ? 'CRLF' : doc.linebreak === '\r' ? 'CR' : 'LF'}`}
            </p>
          </div>
          <div className="order-last w-full lg:order-none lg:w-auto">
            <ParseOptions
              compact
              delimiter={delimiter}
              setDelimiter={(d) => changeParse(() => setDelimiter(d))}
              encoding={origin.kind === 'file' ? encoding : undefined}
              setEncoding={(e) => changeParse(() => setEncoding(e))}
              detected={doc?.delimiter}
              header={doc?.header ?? headerPref}
              setHeader={(h) => {
                setHeaderPref(h);
                if (!doc || h === doc.header) return;
                const next = h ? promoteHeader(doc.table) : demoteHeader(doc.table);
                setUndo([]);
                setRedo([]);
                setSelected(null);
                view.setSort(null);
                setDoc({ ...doc, table: next, header: h });
              }}
            />
          </div>
          <IconButton icon={X} label="Close table" size="sm" onClick={() => guard('Close this table?', 'Discard edits', close)} />
        </header>

        {job.running && (
          <div className="p-4">
            <ProgressBar value={job.progress} label={job.label || 'Parsing…'} onCancel={close} />
          </div>
        )}
        {error && (
          <div className="p-4">
            <ErrorMessage error={error} title="Could not open this file" />
          </div>
        )}

        {doc && table && (
          <div className="flex min-w-0 flex-col gap-3 p-3">
            <Notes doc={doc} editable={editable} />
            <div className="flex flex-wrap items-center gap-2">
              <FilterBar view={view} headers={table.headers} className="w-full min-w-0 md:w-auto md:flex-1" />
              {editable && (
                <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Edit table">
                  <IconButton
                    icon={Undo2}
                    label="Undo (Ctrl+Z)"
                    size="md"
                    className="size-8"
                    disabled={!undo.length}
                    onClick={() => stepHistory('undo')}
                  />
                  <IconButton
                    icon={Redo2}
                    label="Redo (Ctrl+Y)"
                    size="md"
                    className="size-8"
                    disabled={!redo.length}
                    onClick={() => stepHistory('redo')}
                  />
                  <span className="mx-1 h-5 w-px bg-line" aria-hidden />
                  <IconButton
                    icon={BetweenHorizontalStart}
                    label={selRow !== undefined ? 'Insert row below selection' : 'Add row at the end'}
                    size="md"
                    className="size-8"
                    onClick={() => {
                      const at = selRow !== undefined ? selRow + 1 : table.rows.length;
                      commit(insertRow(table, at));
                      if (!view.active) setSelected({ row: at, col: selCol ?? 0 });
                    }}
                  />
                  <IconButton
                    icon={TableRowsSplit}
                    label="Delete selected row"
                    size="md"
                    className="size-8"
                    disabled={selRow === undefined}
                    onClick={() => {
                      if (selRow === undefined) return;
                      commit(deleteRows(table, [selRow]));
                      setSelected(null);
                    }}
                  />
                  <IconButton
                    icon={BetweenVerticalStart}
                    label={selCol !== undefined ? 'Insert column right of selection' : 'Add column at the end'}
                    size="md"
                    className="size-8"
                    onClick={() => {
                      const at = selCol !== undefined ? selCol + 1 : table.headers.length;
                      commit(insertColumn(table, at));
                      view.setSort(null);
                      setSelected(null);
                    }}
                  />
                  <IconButton
                    icon={TableColumnsSplit}
                    label="Delete selected column"
                    size="md"
                    className="size-8"
                    disabled={selCol === undefined || table.headers.length <= 1}
                    onClick={() => {
                      if (selCol === undefined) return;
                      commit(deleteColumn(table, selCol));
                      view.setSort(null);
                      setSelected(null);
                    }}
                  />
                  <IconButton
                    icon={PencilLine}
                    label="Rename selected column"
                    size="md"
                    className="size-8"
                    disabled={selCol === undefined || !doc.header}
                    onClick={() => selCol !== undefined && setRenaming({ col: selCol, value: table.headers[selCol] ?? '' })}
                  />
                </div>
              )}
            </div>

            {table.headers.length > 0 ? (
              <CsvGrid
                table={table}
                view={view.indices}
                label={`Table ${name}`}
                selected={selected}
                onSelect={setSelected}
                sort={view.sort}
                onSort={view.toggleSort}
                onEdit={editable ? (row, col, value) => commit(setCell(table, row, col, value)) : undefined}
                height={600}
              />
            ) : (
              <p className="py-8 text-center text-[13px] text-fg-muted">This file has no rows.</p>
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-fg-muted">
              <span>
                {viewSummary(view, table.rows.length)} × {pluralize(table.headers.length, 'column')}
              </span>
              {selected && selRow !== undefined && selCol !== undefined && (
                <span className="font-mono">
                  R{selRow + 1} · {table.headers[selCol] || `Column ${selCol + 1}`}
                </span>
              )}
              {editable && <span className="hidden lg:inline">Double-click or Enter to edit · Delete clears a cell</span>}
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                {view.active && (
                  <Switch label="Export filtered rows only" checked={exportVisible} onChange={setExportVisible} className="mr-2" />
                )}
                {(['csv', 'tsv', 'json'] as const).map((format) => (
                  <DownloadButton
                    key={format}
                    data={() => exportTable(table, format, doc.header, exportIndices)}
                    filename={() => exportName(format)}
                    type={EXPORT_TYPES[format]}
                    label={format.toUpperCase()}
                  />
                ))}
                <CopyButton value={() => exportTable(table, 'csv', doc.header, exportIndices)} label="Copy CSV" />
              </div>
            </div>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.title ?? ''}
        confirmLabel={confirm?.label}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const action = confirm?.action;
          setConfirm(null);
          action?.();
        }}
      >
        Your edits to this table have not been exported and will be lost.
      </ConfirmDialog>

      <Dialog
        open={Boolean(renaming)}
        onClose={() => setRenaming(null)}
        title="Rename column"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenaming(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                if (renaming && table) commit(renameColumn(table, renaming.col, renaming.value));
                setRenaming(null);
              }}
            >
              Rename
            </Button>
          </>
        }
      >
        {renaming && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (table) commit(renameColumn(table, renaming.col, renaming.value));
              setRenaming(null);
            }}
          >
            <Label htmlFor="csv-rename">Column name</Label>
            <Input id="csv-rename" autoFocus value={renaming.value} onChange={(e) => setRenaming({ ...renaming, value: e.target.value })} />
          </form>
        )}
      </Dialog>
    </ToolStack>
  );
}

function Notes({ doc, editable }: { doc: Doc; editable: boolean }) {
  const notes: string[] = [];
  if (doc.truncated) notes.push(`Only the first ${MAX_ROWS.toLocaleString()} rows were loaded.`);
  if (doc.raggedRows)
    notes.push(`${pluralize(doc.raggedRows, 'row')} had a different number of fields and ${doc.raggedRows === 1 ? 'was' : 'were'} padded.`);
  for (const issue of doc.issues.slice(0, 3)) notes.push(issue.row ? `Row ${issue.row}: ${issue.message}` : issue.message);
  if (doc.issues.length > 3) notes.push(`…and ${doc.issues.length - 3} more parse warnings.`);
  return (
    <>
      {notes.length > 0 && (
        <Alert tone="warning" title="Parse notes">
          <ul className="list-disc pl-4">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Alert>
      )}
      {!editable && <Alert tone="info">This table is large, so it opened read-only. Sorting, filtering and export still work.</Alert>}
    </>
  );
}

function ParseOptions({
  delimiter,
  setDelimiter,
  encoding,
  setEncoding,
  header,
  setHeader,
  detected,
  compact,
}: {
  delimiter: string;
  setDelimiter: (d: string) => void;
  encoding?: string;
  setEncoding: (e: string) => void;
  header: boolean;
  setHeader: (h: boolean) => void;
  detected?: string;
  compact?: boolean;
}) {
  const labelClass = compact ? 'mb-0 shrink-0 text-[12.5px] text-fg-muted' : undefined;
  const body = (
    <div className={compact ? 'flex flex-wrap items-center gap-x-4 gap-y-2' : 'flex flex-wrap items-end gap-x-4 gap-y-3'}>
      <div className={compact ? 'flex items-center gap-2' : 'w-40'}>
        <Label htmlFor="csvv-delim" className={labelClass}>
          Delimiter
        </Label>
        <DelimiterSelect
          id="csvv-delim"
          value={delimiter}
          onChange={setDelimiter}
          detected={detected}
          className={compact ? 'w-40' : undefined}
        />
      </div>
      {encoding !== undefined && (
        <div className={compact ? 'flex items-center gap-2' : 'w-52'}>
          <Label htmlFor="csvv-enc" className={labelClass}>
            {compact ? 'Encoding' : 'File encoding'}
          </Label>
          <Select
            id="csvv-enc"
            value={encoding}
            onChange={(e) => setEncoding(e.target.value)}
            className={compact ? 'h-8 w-44 py-1 text-[13px]' : 'h-8 py-1 text-[13px]'}
          >
            {ENCODINGS.map((e) => (
              <option key={e.value} value={e.value}>
                {e.label}
              </option>
            ))}
          </Select>
        </div>
      )}
      <Switch label="First row is header" checked={header} onChange={setHeader} className="h-8" />
    </div>
  );
  if (compact) return body;
  return <div className="rounded-xl border border-line bg-surface px-4 py-3 shadow-card">{body}</div>;
}
