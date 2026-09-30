import { useEffect, useMemo, useRef, useState } from 'react';
import { Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { Clock, CircleStop, Copy, Crosshair, Download, Eraser, FlaskConical, LockOpen, Play, ShieldAlert, Trash } from 'lucide-react';
import { CodeEditor } from '@/components/editor/CodeEditor';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Button, IconButton } from '@/components/ui/Button';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { EmptyState, Spinner } from '@/components/ui/Feedback';
import { Badge, Kbd } from '@/components/ui/Panel';
import { toast } from '@/components/ui/Toast';
import { readRaw, writeRaw } from '@/lib/storage/local';
import { cn, copyText, downloadBlob, errorMessage, formatDuration, formatNumber, modKey, pluralize } from '@/lib/utils';
import type { ExecResult, StatementResult } from '../lib/protocol';
import { addToHistory, parseHistory, type HistoryEntry } from '../lib/history';
import { classifyScript, lineColumn, type ClassifiedStatement } from '../lib/sqlClassifier';
import { toCsv, toJson, toTsv } from '../lib/sqlFormat';
import { SAMPLE_QUERY } from '../lib/sample';
import { DataGrid } from './DataGrid';
import { Menu } from './Menu';
import type { SqlCall } from './types';

const HISTORY_KEY = 'sqlite-studio:history';
const MAX_ROWS = 10_000;

function loadHistory(): HistoryEntry[] {
  return parseHistory(readRaw(HISTORY_KEY));
}

export function SqlPanel({
  call,
  sql,
  onSqlChange,
  readOnly,
  onRequestWriteMode,
  onWrote,
  onStop,
  onRunningChange,
  onTransactionChange,
}: {
  call: SqlCall;
  sql: string;
  onSqlChange: (sql: string) => void;
  readOnly: boolean;
  onRequestWriteMode: () => void;
  onWrote: () => void;
  onStop: () => void;
  /** Reports whether a query is running (so the workspace can offer Stop on other tabs). */
  onRunningChange?: (running: boolean) => void;
  /** Reports whether an explicit transaction is open after a run. */
  onTransactionChange?: (open: boolean) => void;
}) {
  const viewRef = useRef<EditorView | null>(null);
  const [running, setRunning] = useState(false);
  const [showStop, setShowStop] = useState(false);
  const [result, setResult] = useState<ExecResult | null>(null);
  /** The editor text at run time and the executed part's offset in it (a selection's start), to map error positions back. */
  const [ran, setRan] = useState<{ offset: number; doc: string }>({ offset: 0, doc: '' });
  const [runError, setRunError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<ClassifiedStatement[]>([]);
  const [confirm, setConfirm] = useState<{ text: string; offset: number; statements: ClassifiedStatement[] } | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);

  const runRef = useRef<() => void>(() => {});

  const extensions = useMemo(
    () => [
      Prec.highest(
        keymap.of([
          {
            key: 'Mod-Enter',
            run: () => {
              runRef.current();
              return true;
            },
          },
        ]),
      ),
      EditorView.updateListener.of((update) => {
        if (update.selectionSet) setHasSelection(!update.state.selection.main.empty);
      }),
    ],
    [],
  );

  useEffect(() => {
    if (!running) {
      setShowStop(false);
      return;
    }
    const t = setTimeout(() => setShowStop(true), 400);
    return () => clearTimeout(t);
  }, [running]);

  const runningRef = useRef(onRunningChange);
  runningRef.current = onRunningChange;
  useEffect(() => {
    runningRef.current?.(running);
  }, [running]);
  useEffect(() => () => runningRef.current?.(false), []);

  function textToRun(): { text: string; offset: number } {
    const view = viewRef.current;
    if (view) {
      const { from, to } = view.state.selection.main;
      if (to > from) return { text: view.state.sliceDoc(from, to), offset: from };
    }
    return { text: sql, offset: 0 };
  }

  /** Select a range of the editor (e.g. the failing statement) and bring it into view. */
  function revealInEditor(from: number, to: number) {
    const view = viewRef.current;
    if (!view) return;
    const max = view.state.doc.length;
    const a = Math.min(Math.max(0, from), max);
    const b = Math.min(Math.max(a, to), max);
    view.dispatch({ selection: { anchor: a, head: b }, effects: EditorView.scrollIntoView(a, { y: 'center' }) });
    view.focus();
  }

  function saveHistory(entry: HistoryEntry) {
    setHistory((h) => {
      const next = addToHistory(h, entry);
      writeRaw(HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function execute(text: string, offset: number) {
    setRunning(true);
    setRunError(null);
    setBlocked([]);
    try {
      const doc = viewRef.current?.state.doc.toString() ?? sql;
      const res = await call('exec', { sql: text, readOnly, maxRows: MAX_ROWS });
      setResult(res);
      setRan({ offset, doc });
      onTransactionChange?.(res.inTransaction);
      saveHistory({ sql: text, at: Date.now(), ok: !res.error, ms: res.totalMs });
      if (res.wrote) onWrote();
    } catch (error) {
      setResult(null);
      setRunError(errorMessage(error));
    } finally {
      setRunning(false);
    }
  }

  function run() {
    if (running) return;
    const { text, offset } = textToRun();
    const statements = classifyScript(text);
    if (statements.length === 0) {
      setResult(null);
      setRunError(text.trim() ? 'There is no SQL statement to run (only comments).' : 'Type a SQL statement to run.');
      return;
    }
    if (readOnly) {
      const writes = statements.filter((s) => s.kind === 'write');
      if (writes.length) {
        setBlocked(writes);
        setResult(null);
        setRunError(null);
        return;
      }
    }
    const destructive = statements.filter((s) => s.destructive);
    if (!readOnly && destructive.length) {
      setConfirm({ text, offset, statements: destructive });
      return;
    }
    void execute(text, offset);
  }
  runRef.current = run;

  const statementCount = result ? result.results.length + (result.error ? 1 : 0) : 0;
  // Where the error is in the editor: the located token if SQLite's message allows it, else the statement start.
  const errorAt = (() => {
    const e = result?.error;
    if (!e) return null;
    const exact = e.errorOffset !== undefined;
    const from = ran.offset + (exact ? e.errorOffset! : e.offset);
    const to = exact ? from + (e.errorLength ?? 0) : ran.offset + e.offset + e.sql.length;
    const { line, column } = lineColumn(ran.doc, from);
    // Selecting only makes sense while the editor still holds the text that ran.
    return { from, to, label: exact ? `Line ${line}, column ${column}` : `Line ${line}`, current: ran.doc === sql };
  })();

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <section className="flex min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card">
        <header className="flex flex-wrap items-center gap-2 border-b border-line py-1.5 pr-2 pl-3">
          <Button variant="primary" size="sm" icon={Play} onClick={run} loading={running}>
            {hasSelection ? 'Run selection' : 'Run'}
          </Button>
          <span className="hidden items-center gap-1 text-[12px] text-fg-muted sm:inline-flex">
            <Kbd>{modKey}</Kbd>
            <Kbd>Enter</Kbd>
          </span>
          {showStop && (
            <Button size="sm" variant="danger" icon={CircleStop} onClick={onStop}>
              Stop
            </Button>
          )}
          <div className="ml-auto flex items-center gap-1">
            {readOnly ? (
              <Badge tone="success">Read-only</Badge>
            ) : (
              <Badge tone="warning">
                <ShieldAlert size={11} aria-hidden /> Write mode
              </Badge>
            )}
            <IconButton icon={Clock} label={`Query history (${history.length})`} size="sm" onClick={() => setHistoryOpen(true)} />
            <IconButton icon={FlaskConical} label="Insert sample query" size="sm" onClick={() => onSqlChange(SAMPLE_QUERY)} />
            <IconButton icon={Eraser} label="Clear editor" size="sm" disabled={!sql} onClick={() => onSqlChange('')} />
          </div>
        </header>
        <div className="h-[220px] p-2 sm:h-[260px]">
          <CodeEditor
            value={sql}
            onChange={onSqlChange}
            language="sql"
            ariaLabel="SQL query"
            placeholder="SELECT * FROM sqlite_master;"
            className="h-full"
            extensions={extensions}
            onReady={(view) => {
              viewRef.current = view;
            }}
          />
        </div>
        <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-3 py-1.5 text-[12px] text-fg-muted">
          <span>Runs the selection if there is one, otherwise the whole script. Separate statements with semicolons.</span>
        </footer>
      </section>

      {blocked.length > 0 && (
        <Alert
          tone="warning"
          title="Blocked: the database is read-only"
          action={
            <Button size="sm" icon={LockOpen} onClick={onRequestWriteMode}>
              Enable write mode
            </Button>
          }
        >
          {blocked.length === 1 ? 'This statement changes' : `${blocked.length} statements change`} the database:{' '}
          {blocked
            .slice(0, 4)
            .map((s) => s.verb)
            .join(', ')}
          {blocked.length > 4 ? '…' : ''}. Nothing was run.
        </Alert>
      )}
      <ErrorMessage error={runError} title="Query failed" />

      {running && !result && (
        <div className="flex justify-center py-6">
          <Spinner label="Running query…" />
        </div>
      )}

      {result && (
        <div className="flex min-w-0 flex-col gap-3">
          {/* Only the summary is live: announcing whole result grids would drown screen reader users. */}
          <p className="text-[12.5px] text-fg-muted" aria-live="polite">
            {pluralize(statementCount, 'statement')} · {formatDuration(result.totalMs)}
            {result.error ? ' · stopped at the first error' : ''}
          </p>
          {result.inTransaction && (
            <Alert tone="warning" title="A transaction is open">
              Changes made since BEGIN are not committed yet. Run COMMIT to keep them or ROLLBACK to undo them. Export database is
              blocked until then, and stopping a query or closing the database discards them.
            </Alert>
          )}
          {result.results.map((r) => (
            <StatementCard key={r.index} result={r} />
          ))}
          {result.error && (
            <Alert
              tone="danger"
              title={`Statement ${result.error.index + 1} failed${errorAt ? ` (${errorAt.label})` : ''}`}
              action={
                errorAt?.current ? (
                  <Button size="sm" variant="secondary" icon={Crosshair} onClick={() => revealInEditor(errorAt.from, errorAt.to)}>
                    Show in editor
                  </Button>
                ) : undefined
              }
            >
              <p>{result.error.message}</p>
              {result.error.sql && (
                <pre
                  tabIndex={0}
                  role="region"
                  aria-label="Failing statement"
                  className="mt-1.5 max-h-24 overflow-auto rounded bg-surface-sunken px-2 py-1 font-mono text-[12px] whitespace-pre-wrap text-fg-secondary"
                >
                  {result.error.sql}
                </pre>
              )}
            </Alert>
          )}
        </div>
      )}

      {!result && !running && !runError && blocked.length === 0 && (
        <EmptyState icon={Play} title="Run a query to see results">
          Results for each statement appear here. {readOnly ? 'The database is read-only, so only queries that read data will run.' : ''}
        </EmptyState>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title="Run destructive statements?"
        confirmLabel="Run anyway"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const pending = confirm;
          setConfirm(null);
          if (pending) void execute(pending.text, pending.offset);
        }}
      >
        <p>These statements permanently change data in the in-memory copy:</p>
        <ul className="mt-2 flex flex-col gap-1.5">
          {confirm?.statements.map((s, i) => (
            <li key={i} className="rounded-md bg-danger-soft px-2 py-1.5">
              <span className="font-mono text-[12px] text-fg">{s.text.length > 120 ? `${s.text.slice(0, 120)}…` : s.text}</span>
              <span className="mt-0.5 block text-[12px] text-danger">{s.destructiveReason}</span>
            </li>
          ))}
        </ul>
        <p className="mt-2">Your original file is not modified. Use “Export database” to save the result.</p>
      </ConfirmDialog>

      <Dialog
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title="Query history"
        description="The last 50 queries, stored only in this browser."
        size="lg"
        footer={
          <Button
            variant="ghost"
            icon={Trash}
            disabled={!history.length}
            onClick={() => {
              setHistory([]);
              writeRaw(HISTORY_KEY, null);
            }}
          >
            Clear history
          </Button>
        }
      >
        {history.length === 0 ? (
          <EmptyState icon={Clock} title="No queries yet" />
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {history.map((h) => (
              <li key={`${h.at}-${h.sql.slice(0, 20)}`} className="flex items-start gap-2 py-2">
                <button
                  type="button"
                  className="min-w-0 flex-1 rounded-md px-2 py-1 text-left hover:bg-surface-hover"
                  onClick={() => {
                    onSqlChange(h.sql);
                    setHistoryOpen(false);
                  }}
                >
                  <pre className="line-clamp-3 font-mono text-[12px] whitespace-pre-wrap text-fg">{h.sql}</pre>
                  <span className="mt-0.5 block text-[11.5px] text-fg-muted">
                    {new Date(h.at).toLocaleString()} · {formatDuration(h.ms)} ·{' '}
                    <span className={h.ok ? 'text-success' : 'text-danger'}>{h.ok ? 'OK' : 'Error'}</span>
                  </span>
                </button>
                <IconButton
                  icon={Copy}
                  label="Copy query"
                  size="sm"
                  onClick={() => void copyText(h.sql).then((ok) => toast(ok ? 'Query copied' : 'Copy failed', ok ? 'success' : 'error'))}
                />
              </li>
            ))}
          </ul>
        )}
      </Dialog>
    </div>
  );
}

function StatementCard({ result }: { result: StatementResult }) {
  const isRead = result.kind === 'read' || result.columns.length > 0;
  const base = `query-${result.index + 1}`;
  return (
    <section className="min-w-0 rounded-xl border border-line bg-surface p-3 shadow-card">
      <header className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone={result.kind === 'write' ? 'warning' : 'neutral'}>{result.verb || 'SQL'}</Badge>
        <span className="text-[12.5px] text-fg-secondary">
          #{result.index + 1} ·{' '}
          {result.columns.length > 0
            ? `${pluralize(result.rows.length, 'row')}${result.truncated ? ` (first ${formatNumber(MAX_ROWS, 0)} shown)` : ''}`
            : result.rowsModified !== null
              ? `${pluralize(result.rowsModified, 'row')} affected`
              : 'Done'}{' '}
          · {formatDuration(result.timeMs)}
        </span>
        {result.columns.length > 0 && (
          <Menu
            className="ml-auto"
            label="Export"
            icon={Download}
            items={[
              {
                label: 'Download CSV',
                hint: 'BLOBs as 0x hex',
                onSelect: () => downloadBlob(toCsv(result.columns, result.rows), `${base}.csv`, 'text/csv'),
              },
              {
                label: 'Download JSON',
                hint: 'BLOBs as Base64',
                onSelect: () => downloadBlob(toJson(result.columns, result.rows), `${base}.json`, 'application/json'),
              },
              {
                label: 'Copy as TSV',
                onSelect: () =>
                  void copyText(toTsv(result.columns, result.rows)).then((ok) =>
                    toast(ok ? 'Copied rows as TSV' : 'Copy failed', ok ? 'success' : 'error'),
                  ),
              },
            ]}
          />
        )}
      </header>
      <pre className={cn('mb-2 line-clamp-2 font-mono text-[12px] whitespace-pre-wrap text-fg-muted')}>{result.sql}</pre>
      {result.columns.length > 0 ? (
        <DataGrid label={`Results of statement ${result.index + 1}`} columns={result.columns} rows={result.rows} maxHeight={380} fileBase={base} />
      ) : (
        isRead && <p className="text-[13px] text-fg-muted">The statement returned no columns.</p>
      )}
    </section>
  );
}
