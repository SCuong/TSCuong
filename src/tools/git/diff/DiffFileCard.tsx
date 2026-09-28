import { Fragment, memo, useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, ChevronsUpDown, FileCog } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Panel';
import { cn } from '@/lib/utils';
import { collapseContext, displayPath, toSplitRows, type DiffFile, type DiffHunk, type DiffLine, type FileStatus, type SplitRow } from '../lib/diffParse';
import { intraline, pairLines, type Segment } from '../lib/intraline';

export type DiffView = 'unified' | 'split';

export const STATUS_META: Record<FileStatus, { letter: string; label: string; tone: 'success' | 'danger' | 'accent' | 'warning' | 'neutral' }> = {
  added: { letter: 'A', label: 'Added', tone: 'success' },
  deleted: { letter: 'D', label: 'Deleted', tone: 'danger' },
  modified: { letter: 'M', label: 'Modified', tone: 'warning' },
  renamed: { letter: 'R', label: 'Renamed', tone: 'accent' },
  copied: { letter: 'C', label: 'Copied', tone: 'accent' },
  mode: { letter: 'M', label: 'Mode changed', tone: 'neutral' },
};

export function fileLineCount(file: DiffFile): number {
  return file.hunks.reduce((n, h) => n + h.lines.length, 0);
}

interface Props {
  file: DiffFile;
  anchorId: string;
  view: DiffView;
  collapseUnchanged: boolean;
  wrap: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onApply?: () => void;
}

export const DiffFileCard = memo(function DiffFileCard({ file, anchorId, view, collapseUnchanged, wrap, collapsed, onToggle, onApply }: Props) {
  const meta = STATUS_META[file.status];
  const lineCount = fileLineCount(file);
  const modeChanged = file.oldMode && file.newMode && file.oldMode !== file.newMode;

  return (
    <section id={anchorId} className="min-w-0 scroll-mt-4 rounded-xl border border-line bg-surface shadow-card" aria-label={displayPath(file)}>
      <header
        className={cn(
          'flex flex-wrap items-center gap-x-2 gap-y-1.5 bg-surface-raised py-2 pr-2 pl-2 rounded-t-xl',
          collapsed ? 'rounded-b-xl' : 'border-b border-line',
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={!collapsed}
          aria-controls={`${anchorId}-body`}
          className="flex min-w-0 grow basis-full items-center gap-2 rounded-md py-0.5 pr-1 text-left sm:basis-0"
        >
          {collapsed ? (
            <ChevronRight size={16} aria-hidden className="shrink-0 text-fg-muted" />
          ) : (
            <ChevronDown size={16} aria-hidden className="shrink-0 text-fg-muted" />
          )}
          <Badge tone={meta.tone} className="shrink-0">
            {meta.label}
          </Badge>
          <span className="min-w-0 font-mono text-[13px] font-medium break-all text-fg">{displayPath(file)}</span>
        </button>
        <div className="flex flex-wrap items-center gap-1.5 pl-6 sm:pl-0">
          {file.similarity !== null && file.status !== 'modified' && <Badge>{file.similarity}% similar</Badge>}
          {modeChanged && (
            <Badge>
              {file.oldMode} → {file.newMode}
            </Badge>
          )}
          {file.binary && <Badge tone="neutral">Binary</Badge>}
          {(file.additions > 0 || file.deletions > 0) && (
            <span className="font-mono text-[12.5px] tabular-nums">
              <span className="text-success">+{file.additions}</span> <span className="text-danger">−{file.deletions}</span>
            </span>
          )}
          {onApply && (
            <Button size="sm" variant="ghost" icon={FileCog} onClick={onApply}>
              Apply to file
            </Button>
          )}
        </div>
      </header>
      {!collapsed && (
        <div id={`${anchorId}-body`}>
          {file.binary ? (
            <Note>
              Binary file{file.binaryPatch ? ' (the patch includes the binary data, which is not displayed)' : ' changed'}.
            </Note>
          ) : file.hunks.length === 0 ? (
            <Note>
              {modeChanged
                ? `Only the file mode changed (${file.oldMode} → ${file.newMode}).`
                : file.status === 'renamed' || file.status === 'copied'
                  ? `${meta.label} without content changes.`
                  : file.status === 'added'
                    ? 'New empty file.'
                    : file.status === 'deleted'
                      ? 'Deleted empty file.'
                      : 'No content changes.'}
            </Note>
          ) : (
            <div className="overflow-x-auto rounded-b-xl">
              {view === 'split' ? (
                <SplitTable file={file} collapseUnchanged={collapseUnchanged} />
              ) : (
                <UnifiedTable file={file} collapseUnchanged={collapseUnchanged} wrap={wrap} />
              )}
            </div>
          )}
          {lineCount > 0 && file.hunks.length > 1 && (
            <div className="sr-only">
              {file.hunks.length} hunks, {lineCount} lines
            </div>
          )}
        </div>
      )}
    </section>
  );
});

function Note({ children }: { children: ReactNode }) {
  return <p className="px-4 py-3 text-[13px] text-fg-muted">{children}</p>;
}

const NUM = 'w-[1%] min-w-10 border-r border-line px-2 text-right align-top text-[11.5px] leading-5 text-fg-muted tabular-nums select-none';
const ROW_BG = { add: 'bg-[var(--lk-diff-add)]', del: 'bg-[var(--lk-diff-del)]', context: '' } as const;
const STRONG = { add: 'bg-[var(--lk-diff-add-strong)]', del: 'bg-[var(--lk-diff-del-strong)]', context: '' } as const;

function Content({ line, segments }: { line: DiffLine; segments: Segment[] | null }) {
  if (line.content === '' && !segments && !line.noNewline) return null;
  return (
    <>
      {segments
        ? segments.map((s, i) =>
            s.changed ? (
              <span key={i} className={cn('rounded-[2px]', STRONG[line.type])}>
                {s.text}
              </span>
            ) : (
              <Fragment key={i}>{s.text}</Fragment>
            ),
          )
        : line.content}
      {line.noNewline && (
        <span className="ml-2 rounded border border-line px-1 font-sans text-[11px] text-fg-muted select-none" title="No newline at end of file">
          no newline at end
        </span>
      )}
    </>
  );
}

function useSegments(hunk: DiffHunk) {
  return useMemo(() => {
    const pairs = pairLines(hunk.lines);
    const map = new Map<DiffLine, Segment[]>();
    for (const [line, partner] of pairs) {
      if (line.type !== 'del' || map.has(line)) continue;
      const r = intraline(line.content, partner.content);
      if (r) {
        map.set(line, r.old);
        map.set(partner, r.new);
      }
    }
    return map;
  }, [hunk]);
}

function HunkHeader({ hunk, colSpan }: { hunk: DiffHunk; colSpan: number }) {
  return (
    <tr className="bg-accent-soft">
      <td colSpan={colSpan} className="px-3 py-1 font-mono text-[12px] whitespace-pre-wrap text-fg-secondary">
        <span className="text-accent-text">
          @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
        </span>
        {hunk.section && <span className="ml-2 text-fg-muted">{hunk.section}</span>}
      </td>
    </tr>
  );
}

function ExpandRow({ count, colSpan, onClick }: { count: number; colSpan: number; onClick: () => void }) {
  return (
    <tr className="bg-surface-sunken">
      <td colSpan={colSpan} className="p-0">
        <button
          type="button"
          onClick={onClick}
          className="flex w-full items-center gap-2 px-3 py-1 text-left font-sans text-[12px] text-accent-text hover:bg-surface-hover"
        >
          <ChevronsUpDown size={13} aria-hidden />
          Show {count} unchanged {count === 1 ? 'line' : 'lines'}
        </button>
      </td>
    </tr>
  );
}

function UnifiedTable({ file, collapseUnchanged, wrap }: { file: DiffFile; collapseUnchanged: boolean; wrap: boolean }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  return (
    <table className="min-w-full border-collapse font-mono text-[12.5px] leading-5">
      <tbody>
        {file.hunks.map((hunk, hi) => (
          <UnifiedHunk
            key={hi}
            hunk={hunk}
            prefix={`${hi}:`}
            collapseUnchanged={collapseUnchanged}
            wrap={wrap}
            expanded={expanded}
            onExpand={(id) => setExpanded((prev) => new Set(prev).add(id))}
          />
        ))}
      </tbody>
    </table>
  );
}

function UnifiedHunk({
  hunk,
  prefix,
  collapseUnchanged,
  wrap,
  expanded,
  onExpand,
}: {
  hunk: DiffHunk;
  prefix: string;
  collapseUnchanged: boolean;
  wrap: boolean;
  expanded: Set<string>;
  onExpand: (id: string) => void;
}) {
  const segments = useSegments(hunk);
  const parts = useMemo(
    () =>
      collapseUnchanged
        ? collapseContext(hunk.lines, (l) => l.type === 'context', 3, 8, prefix)
        : [{ kind: 'lines' as const, items: hunk.lines }],
    [hunk, collapseUnchanged, prefix],
  );
  const renderLine = (line: DiffLine, key: number) => (
    <tr key={key} className={ROW_BG[line.type]}>
      <td className={NUM}>{line.oldNo ?? ''}</td>
      <td className={NUM}>{line.newNo ?? ''}</td>
      <td className={cn('w-4 pl-2 align-top select-none', line.type === 'add' ? 'text-success' : line.type === 'del' ? 'text-danger' : 'text-fg-muted')}>
        {line.type === 'add' ? '+' : line.type === 'del' ? '−' : ' '}
      </td>
      <td className={cn('pr-4 pl-1 align-top text-fg', wrap ? 'whitespace-pre-wrap [overflow-wrap:anywhere]' : 'whitespace-pre')}>
        <Content line={line} segments={segments.get(line) ?? null} />
      </td>
    </tr>
  );
  let n = 0;
  return (
    <>
      <HunkHeader hunk={hunk} colSpan={4} />
      {parts.map((part) =>
        part.kind === 'collapsed' && !expanded.has(part.id) ? (
          <ExpandRow key={part.id} count={part.items.length} colSpan={4} onClick={() => onExpand(part.id)} />
        ) : (
          part.items.map((line) => renderLine(line, n++))
        ),
      )}
    </>
  );
}

function SplitTable({ file, collapseUnchanged }: { file: DiffFile; collapseUnchanged: boolean }) {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  return (
    <table className="w-full min-w-[680px] table-fixed border-collapse font-mono text-[12.5px] leading-5">
      <colgroup>
        <col className="w-12" />
        <col />
        <col className="w-12" />
        <col />
      </colgroup>
      <tbody>
        {file.hunks.map((hunk, hi) => (
          <SplitHunk
            key={hi}
            hunk={hunk}
            prefix={`${hi}:`}
            collapseUnchanged={collapseUnchanged}
            expanded={expanded}
            onExpand={(id) => setExpanded((prev) => new Set(prev).add(id))}
          />
        ))}
      </tbody>
    </table>
  );
}

function SplitHunk({
  hunk,
  prefix,
  collapseUnchanged,
  expanded,
  onExpand,
}: {
  hunk: DiffHunk;
  prefix: string;
  collapseUnchanged: boolean;
  expanded: Set<string>;
  onExpand: (id: string) => void;
}) {
  const segments = useSegments(hunk);
  const rows = useMemo(() => toSplitRows(hunk.lines), [hunk]);
  const parts = useMemo(
    () =>
      collapseUnchanged
        ? collapseContext(rows, (r) => r.left?.type === 'context', 3, 8, prefix)
        : [{ kind: 'lines' as const, items: rows }],
    [rows, collapseUnchanged, prefix],
  );
  const side = (line: DiffLine | null, which: 'left' | 'right') => {
    const no = line ? (which === 'left' ? line.oldNo : line.newNo) : null;
    return (
      <>
        <td className={cn(NUM, 'w-auto', line ? ROW_BG[line.type] : 'bg-surface-sunken', which === 'right' && 'border-l')}>{no ?? ''}</td>
        <td
          className={cn(
            'px-2 align-top whitespace-pre-wrap text-fg [overflow-wrap:anywhere]',
            line ? ROW_BG[line.type] : 'bg-surface-sunken',
          )}
        >
          {line && <Content line={line} segments={segments.get(line) ?? null} />}
        </td>
      </>
    );
  };
  let n = 0;
  const renderRow = (row: SplitRow) => (
    <tr key={n++}>
      {side(row.left, 'left')}
      {side(row.right, 'right')}
    </tr>
  );
  return (
    <>
      <HunkHeader hunk={hunk} colSpan={4} />
      {parts.map((part) =>
        part.kind === 'collapsed' && !expanded.has(part.id) ? (
          <ExpandRow key={part.id} count={part.items.length} colSpan={4} onClick={() => onExpand(part.id)} />
        ) : (
          part.items.map(renderRow)
        ),
      )}
    </>
  );
}
