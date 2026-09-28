import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowLeftRight, ChevronsUpDown, Download, GitCompare } from 'lucide-react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { Change } from 'diff';
import { EditorPanel, SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Switch } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { ErrorMessage } from '@/components/ui/Alert';
import { EmptyState, Spinner } from '@/components/ui/Feedback';
import { Badge, Panel } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { toast } from '@/components/ui/Toast';
import { useDebouncedValue, useMediaQuery, useToolState } from '@/lib/hooks';
import { cn, downloadBlob, formatNumber } from '@/lib/utils';
import { collapseRows, inlineLineDiff, type DiffMode, type DiffResult, type DiffRow, type DisplayRow, type InlinePart } from './lib/diff';
import type { DiffWorkerRequest } from './lib/diff.worker';
import { Opt, TEXT_FILE_ACCEPT, TextFooter } from './components/shared';

const ID = 'text-diff';
const SAMPLE_A = `The quick brown fox
jumps over the lazy dog.
Lorem ipsum dolor sit amet,
consectetur adipiscing elit.
Line that will be removed.
Sed do eiusmod tempor
incididunt ut labore.`;
const SAMPLE_B = `The quick red fox
jumps over the lazy dog.
Lorem ipsum dolor sit amet,
consectetur adipiscing elit.
Sed do eiusmod tempor
incididunt ut labore et dolore.
A brand new line at the end.`;

type View = 'split' | 'unified';
type RequestWithoutId = DiffWorkerRequest extends infer R ? (R extends DiffWorkerRequest ? Omit<R, 'id'> : never) : never;

interface DiffState {
  result: DiffResult;
  rows: DiffRow[] | null;
  a: string;
  b: string;
  mode: DiffMode;
}

type WorkerResponse =
  | { id: number; type: 'diff'; result: DiffResult; rows: DiffRow[] | null }
  | { id: number; type: 'patch'; patch: string }
  | { id: number; type: 'error'; error: string };

function createWorker() {
  return new Worker(new URL('./lib/diff.worker.ts', import.meta.url), { type: 'module' });
}

/** Runs diffs in a Web Worker; a new request terminates any diff still running. */
function useDiffWorker() {
  const worker = useRef<Worker | null>(null);
  const pending = useRef<Map<number, (msg: WorkerResponse) => void>>(new Map());
  const seq = useRef(0);

  const ensure = useCallback(() => {
    if (!worker.current) {
      const w = createWorker();
      w.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const cb = pending.current.get(e.data.id);
        pending.current.delete(e.data.id);
        cb?.(e.data);
      };
      w.onerror = () => {
        for (const cb of pending.current.values()) cb({ id: -1, type: 'error', error: 'The comparison engine crashed (the input may be too large).' });
        pending.current.clear();
        worker.current?.terminate();
        worker.current = null;
      };
      worker.current = w;
    }
    return worker.current;
  }, []);

  useEffect(
    () => () => {
      worker.current?.terminate();
      worker.current = null;
    },
    [],
  );

  const request = useCallback(
    (msg: RequestWithoutId, cancelPrevious: boolean): Promise<WorkerResponse> => {
      if (cancelPrevious && pending.current.size > 0) {
        worker.current?.terminate();
        worker.current = null;
        pending.current.clear();
      }
      const id = ++seq.current;
      return new Promise((resolve) => {
        pending.current.set(id, resolve);
        ensure().postMessage({ ...msg, id } as DiffWorkerRequest);
      });
    },
    [ensure],
  );

  return request;
}

export default function TextDiff() {
  const [a, setA] = useToolState(ID, 'original', '');
  const [b, setB] = useToolState(ID, 'changed', '');
  const [mode, setMode] = useToolState<DiffMode>(ID, 'mode', 'line');
  const [view, setView] = useToolState<View>(ID, 'view', 'split');
  const [ignoreWhitespace, setIgnoreWhitespace] = useToolState(ID, 'ignoreWhitespace', false);
  const [ignoreCase, setIgnoreCase] = useToolState(ID, 'ignoreCase', false);
  const [collapse, setCollapse] = useToolState(ID, 'collapse', true);
  const [state, setState] = useState<DiffState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const request = useDiffWorker();
  const wide = useMediaQuery('(min-width: 768px)');

  const big = a.length + b.length > 200_000;
  const debouncedA = useDebouncedValue(a, big ? 500 : 150);
  const debouncedB = useDebouncedValue(b, big ? 500 : 150);

  useEffect(() => {
    if (!debouncedA && !debouncedB) {
      setState(null);
      setError(null);
      setBusy(false);
      return;
    }
    let cancelled = false;
    setBusy(true);
    const options = { mode, ignoreWhitespace, ignoreCase };
    void request({ type: 'diff', a: debouncedA, b: debouncedB, options }, true).then((msg) => {
      if (cancelled) return;
      setBusy(false);
      if (msg.type === 'diff') {
        setState({ result: msg.result, rows: msg.rows, a: debouncedA, b: debouncedB, mode });
        setError(msg.result.ok ? null : msg.result.error);
      } else if (msg.type === 'error') {
        setError(msg.error);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [debouncedA, debouncedB, mode, ignoreWhitespace, ignoreCase, request]);

  async function downloadPatch() {
    const msg = await request({ type: 'patch', a, b, oldName: 'original.txt', newName: 'changed.txt' }, false);
    if (msg.type === 'patch') downloadBlob(msg.patch, 'changes.patch', 'text/x-diff;charset=utf-8');
    else toast('Could not create the patch.', 'error');
  }

  function swap() {
    setA(b);
    setB(a);
  }

  const stats = state?.result.ok ? state.result.stats : null;
  const identical = stats && stats.added === 0 && stats.removed === 0;
  const effectiveView: View = wide ? view : 'unified';

  return (
    <ToolStack>
      <ToolBar>
        <Opt label="Compare by">
          <Segmented
            label="Compare by"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'line', label: 'Lines' },
              { value: 'word', label: 'Words' },
              { value: 'char', label: 'Characters' },
            ]}
          />
        </Opt>
        <Opt label="View" className="max-md:hidden">
          <Segmented
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: 'split', label: 'Side by side' },
              { value: 'unified', label: mode === 'line' ? 'Unified' : 'Inline' },
            ]}
          />
        </Opt>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pb-1.5">
          <Switch label="Ignore whitespace" checked={ignoreWhitespace} onChange={setIgnoreWhitespace} />
          <Switch label="Ignore case" checked={ignoreCase} onChange={setIgnoreCase} />
          {mode === 'line' && <Switch label="Hide unchanged lines" checked={collapse} onChange={setCollapse} />}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button icon={ArrowLeftRight} onClick={swap} disabled={!a && !b}>
            Swap
          </Button>
          <Button icon={Download} onClick={() => void downloadPatch()} disabled={!a && !b} title="Unified diff of the exact line changes">
            .patch
          </Button>
        </div>
      </ToolBar>

      <SplitPanes>
        <EditorPanel
          title="Original"
          value={a}
          onChange={setA}
          placeholder="Paste the original text…"
          sample={SAMPLE_A}
          fileAccept={TEXT_FILE_ACCEPT}
          height="260px"
          lineWrapping={false}
          footer={<TextFooter text={a} />}
        />
        <EditorPanel
          title="Changed"
          value={b}
          onChange={setB}
          placeholder="Paste the changed text…"
          sample={SAMPLE_B}
          fileAccept={TEXT_FILE_ACCEPT}
          height="260px"
          lineWrapping={false}
          footer={<TextFooter text={b} />}
        />
      </SplitPanes>

      <ErrorMessage error={error} title="Could not compare" />

      <Panel
        title="Differences"
        bodyClassName="p-0"
        actions={
          <div className="flex flex-wrap items-center gap-1.5">
            {busy && <Spinner size={14} label="Comparing…" />}
            {stats && !busy && (
              identical ? (
                <Badge tone="success">No differences</Badge>
              ) : (
                <>
                  <Badge tone="success">+{formatNumber(stats.added, 0)}</Badge>
                  <Badge tone="danger">−{formatNumber(stats.removed, 0)}</Badge>
                  <Badge>
                    {formatNumber(stats.unchanged, 0)} {stats.unit} unchanged
                  </Badge>
                </>
              )
            )}
          </div>
        }
      >
        {!state || !state.result.ok ? (
          <EmptyState icon={GitCompare} title={busy ? 'Comparing…' : 'Paste two texts to compare'}>
            {!busy && 'Differences are highlighted line by line, word by word or character by character.'}
          </EmptyState>
        ) : state.mode === 'line' && state.rows ? (
          <LineDiffView rows={state.rows} view={effectiveView} collapse={collapse} ignoreCase={ignoreCase} />
        ) : (
          <InlineDiffView changes={state.result.changes} view={effectiveView} />
        )}
      </Panel>
    </ToolStack>
  );
}

/* ------------------------------------------------------------------------ */
/* Line view (virtualized)                                                  */
/* ------------------------------------------------------------------------ */

type UnifiedLine =
  | { kind: 'ctx' | 'del' | 'add'; oldNo?: number; newNo?: number; text: string; parts?: InlinePart[] }
  | { kind: 'skip'; count: number; from: number };

const ROW_TONE = {
  del: 'bg-[var(--lk-diff-del)]',
  add: 'bg-[var(--lk-diff-add)]',
  ctx: '',
} as const;

function Parts({ parts, tone }: { parts: InlinePart[]; tone: 'del' | 'add' }) {
  return (
    <>
      {parts.map((p, i) =>
        p.changed ? (
          <span key={i} className={cn('rounded-[3px]', tone === 'del' ? 'bg-[var(--lk-diff-del-strong)]' : 'bg-[var(--lk-diff-add-strong)]')}>
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

function LineNo({ n }: { n?: number }) {
  return (
    <span className="w-9 shrink-0 pr-2 text-right text-fg-muted/80 tabular-nums select-none sm:w-12" aria-hidden>
      {n ?? ''}
    </span>
  );
}

function Marker({ kind }: { kind: 'ctx' | 'del' | 'add' }) {
  return (
    <span className={cn('w-4 shrink-0 select-none', kind === 'del' ? 'text-danger' : kind === 'add' ? 'text-success' : 'text-fg-muted')} aria-hidden>
      {kind === 'del' ? '−' : kind === 'add' ? '+' : ' '}
    </span>
  );
}

function LineDiffView({ rows, view, collapse, ignoreCase }: { rows: DiffRow[]; view: View; collapse: boolean; ignoreCase: boolean }) {
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  // Reset expanded blocks when the diff changes.
  const [prevRows, setPrevRows] = useState(rows);
  if (prevRows !== rows) {
    setPrevRows(rows);
    setExpanded(new Set());
  }

  const display: DisplayRow[] = useMemo(() => {
    if (!collapse) return rows;
    const collapsed = collapseRows(rows, 3);
    const out: DisplayRow[] = [];
    for (const r of collapsed) {
      if (r.kind === 'skip' && expanded.has(r.from)) out.push(...rows.slice(r.from, r.from + r.count));
      else out.push(r);
    }
    return out;
  }, [rows, collapse, expanded]);

  const unified: UnifiedLine[] | null = useMemo(() => {
    if (view !== 'unified') return null;
    const out: UnifiedLine[] = [];
    let i = 0;
    while (i < display.length) {
      const r = display[i];
      if (r.kind === 'skip') {
        out.push(r);
        i++;
      } else if (r.kind === 'equal') {
        out.push({ kind: 'ctx', oldNo: r.left?.no, newNo: r.right?.no, text: r.right?.text ?? '' });
        i++;
      } else {
        const block: DiffRow[] = [];
        while (i < display.length && display[i].kind !== 'equal' && display[i].kind !== 'skip') block.push(display[i++] as DiffRow);
        const dels: UnifiedLine[] = [];
        const adds: UnifiedLine[] = [];
        for (const row of block) {
          const inline = row.kind === 'changed' && row.left && row.right ? inlineLineDiff(row.left.text, row.right.text, ignoreCase) : null;
          if (row.left) dels.push({ kind: 'del', oldNo: row.left.no, text: row.left.text, parts: inline?.left });
          if (row.right) adds.push({ kind: 'add', newNo: row.right.no, text: row.right.text, parts: inline?.right });
        }
        out.push(...dels, ...adds);
      }
    }
    return out;
  }, [display, view, ignoreCase]);

  const count = unified ? unified.length : display.length;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 24,
    overscan: 30,
  });

  const expand = (from: number) => setExpanded((prev) => new Set(prev).add(from));

  function renderSkip(r: { count: number; from: number }) {
    return (
      <button
        type="button"
        onClick={() => expand(r.from)}
        className="flex w-full items-center gap-2 bg-surface-hover/60 px-3 py-1 text-left font-sans text-[12.5px] text-fg-muted hover:bg-surface-hover hover:text-fg"
      >
        <ChevronsUpDown size={13} aria-hidden />
        Show {formatNumber(r.count, 0)} unchanged {r.count === 1 ? 'line' : 'lines'}
      </button>
    );
  }

  function renderUnified(line: UnifiedLine): ReactNode {
    if (line.kind === 'skip') return renderSkip(line);
    return (
      <div className={cn('flex min-w-0 px-1 py-px', ROW_TONE[line.kind])}>
        <LineNo n={line.oldNo} />
        <LineNo n={line.newNo} />
        <Marker kind={line.kind} />
        <span className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
          {line.parts && line.kind !== 'ctx' ? <Parts parts={line.parts} tone={line.kind} /> : line.text || '\u200b'}
        </span>
      </div>
    );
  }

  function renderSplit(row: DisplayRow): ReactNode {
    if (row.kind === 'skip') return renderSkip(row);
    const inline = row.kind === 'changed' && row.left && row.right ? inlineLineDiff(row.left.text, row.right.text, ignoreCase) : null;
    const leftKind = row.kind === 'equal' ? 'ctx' : 'del';
    const rightKind = row.kind === 'equal' ? 'ctx' : 'add';
    return (
      <div className="grid grid-cols-2">
        <div className={cn('flex min-w-0 border-r border-line px-1 py-px', row.left ? ROW_TONE[leftKind] : 'bg-surface-sunken')}>
          <LineNo n={row.left?.no} />
          {row.left && <Marker kind={leftKind} />}
          <span className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {row.left ? inline ? <Parts parts={inline.left} tone="del" /> : row.left.text || '\u200b' : ''}
          </span>
        </div>
        <div className={cn('flex min-w-0 px-1 py-px', row.right ? ROW_TONE[rightKind] : 'bg-surface-sunken')}>
          <LineNo n={row.right?.no} />
          {row.right && <Marker kind={rightKind} />}
          <span className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">
            {row.right ? inline ? <Parts parts={inline.right} tone="add" /> : row.right.text || '\u200b' : ''}
          </span>
        </div>
      </div>
    );
  }

  if (count === 0) {
    return <EmptyState icon={GitCompare} title="Both texts are empty" />;
  }

  return (
    <div ref={scrollRef} className="max-h-[640px] overflow-auto rounded-b-xl font-mono text-[12.5px] leading-[1.6] text-fg" role="table" aria-label="Line differences">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            role="row"
            className="absolute inset-x-0 top-0"
            style={{ transform: `translateY(${item.start}px)` }}
          >
            {unified ? renderUnified(unified[item.index]) : renderSplit(display[item.index])}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Word / character view                                                    */
/* ------------------------------------------------------------------------ */

const MAX_INLINE_CHARS = 300_000;

function InlineDiffView({ changes, view }: { changes: Change[]; view: View }) {
  const { left, right, unified, truncated } = useMemo(() => {
    const leftNodes: ReactNode[] = [];
    const rightNodes: ReactNode[] = [];
    const unifiedNodes: ReactNode[] = [];
    let chars = 0;
    let truncated = false;
    changes.forEach((c, i) => {
      if (chars > MAX_INLINE_CHARS) {
        truncated = true;
        return;
      }
      chars += c.value.length;
      if (c.added) {
        const node = (
          <ins key={i} className="rounded-[3px] bg-[var(--lk-diff-add-strong)] text-fg no-underline">
            {c.value}
          </ins>
        );
        rightNodes.push(node);
        unifiedNodes.push(node);
      } else if (c.removed) {
        const node = (
          <del key={i} className="rounded-[3px] bg-[var(--lk-diff-del-strong)] text-fg decoration-danger/70">
            {c.value}
          </del>
        );
        leftNodes.push(node);
        unifiedNodes.push(node);
      } else {
        leftNodes.push(<span key={i}>{c.value}</span>);
        rightNodes.push(<span key={i}>{c.value}</span>);
        unifiedNodes.push(<span key={i}>{c.value}</span>);
      }
    });
    return { left: leftNodes, right: rightNodes, unified: unifiedNodes, truncated };
  }, [changes]);

  const box = 'max-h-[640px] overflow-auto px-4 py-3 font-mono text-[13px] leading-relaxed break-words whitespace-pre-wrap text-fg';
  return (
    <div>
      {view === 'split' ? (
        <div className="grid grid-cols-2 divide-x divide-line">
          <div className={box} aria-label="Original with removals highlighted">
            {left}
          </div>
          <div className={box} aria-label="Changed with additions highlighted">
            {right}
          </div>
        </div>
      ) : (
        <div className={box} aria-label="Differences inline">
          {unified}
        </div>
      )}
      {truncated && (
        <p className="border-t border-line px-4 py-2 text-[12.5px] text-fg-muted">
          The preview stops after {formatNumber(MAX_INLINE_CHARS, 0)} characters. The statistics cover the full text.
        </p>
      )}
    </div>
  );
}
