import { useEffect, useMemo, useRef, useState } from 'react';
import { Prec } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { Clock, CircleStop, Copy, Download, Eraser, FlaskConical, LockOpen, Play, ShieldAlert, Trash } from 'lucide-react';
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
import { classifyScript, type ClassifiedStatement } from '../lib/sqlClassifier';
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
}: {
  call: SqlCall;
  sql: string;
  onSqlChange: (sql: string) => void;
  readOnly: boolean;
  onRequestWriteMode: () => void;
  onWrote: () => void;
  onStop: () => void;
}) {
  const viewRef = useRef<EditorView | null>(null);
  const [running, setRunning] = useState(false);
  const [showStop, setShowStop] = useState(false);
  const [result, setResult] = useState<ExecResult | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<ClassifiedStatement[]>([]);
  const [confirm, setConfirm] = useState<{ text: string; statements: ClassifiedStatement[] } | null>(null);
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

  function textToRun(): string {
    const view = viewRef.current;
    if (view) {
      const { from, to } = view.state.selection.main;
      if (to > from) return view.state.sliceDoc(from, to);
    }
    return sql;
  }

  function saveHistory(entry: HistoryEntry) {
    setHistory((h) => {
      const next = addToHistory(h, entry);
      writeRaw(HISTORY_KEY, JSON.stringify(next));
      return next;
    });
  }

  async function execute(text: string) {
    setRunning(true);
    setRunError(null);
    setBlocked([]);
    try {
      const res = await call('exec', { sql: text, readOnly, maxRows: MAX_ROWS });
      setResult(res);
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
    const text = textToRun();
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
      setConfirm({ text, statements: destructive });
      return;
    }
    void execute(text);
  }
  runRef.current = run;

  const statementCount = result ? result.results.length + (result.error ? 1 : 0) : 0;

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
        <div className="flex min-w-0 flex-col gap-3" aria-live="polite">
          <p className="text-[12.5px] text-fg-muted">
            {pluralize(statementCount, 'statement')} · {formatDuration(result.totalMs)}
            {result.error ? ' · stopped at the first error' : ''}
          </p>
          {result.results.map((r) => (
            <StatementCard key={r.index} result={r} />
          ))}
          {result.error && (
            <Alert tone="danger" title={`Statement ${result.error.index + 1} failed`}>
              <p>{result.error.message}</p>
              {result.error.sql && (
                <pre className="mt-1.5 max-h-24 overflow-auto rounded bg-surface-sunken px-2 py-1 font-mono text-[12px] whitespace-pre-wrap text-fg-secondary">
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
          const text = confirm?.text ?? '';
          setConfirm(null);
          void execute(text);
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
              { label: 'Download CSV', onSelect: () => downloadBlob(toCsv(result.columns, result.rows), `${base}.csv`, 'text/csv') },
              {
                label: 'Download JSON',
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
