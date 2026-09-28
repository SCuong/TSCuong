import { useDeferredValue, useMemo, useState, type DragEvent } from 'react';
import { ChevronsDownUp, ChevronsUpDown, Columns2, FileDiff, GitCommitHorizontal, Rows2 } from 'lucide-react';
import { EditorPanel, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Feedback';
import { Label, Switch } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Panel';
import { Segmented } from '@/components/ui/Segmented';
import { toast } from '@/components/ui/Toast';
import { useToolState } from '@/lib/hooks';
import { cn, errorMessage, formatBytes, pluralize } from '@/lib/utils';
import { diffTotals, displayPath, parseDiff, type DiffFile, type ParsedDiff, type PatchCommit } from './lib/diffParse';
import SAMPLE from './lib/fixtures/sample.patch?raw';
import { DiffFileCard, STATUS_META, fileLineCount, type DiffView } from './diff/DiffFileCard';
import { ApplyPatchDialog } from './diff/ApplyPatchDialog';

const TOOL = 'git-diff-viewer';
const MAX_FILE = 50 * 1024 * 1024;
/** Files with more lines than this start collapsed so huge patches stay responsive. */
const AUTO_COLLAPSE_LINES = 600;
const AUTO_COLLAPSE_TOTAL = 4000;

function defaultCollapsed(parsed: ParsedDiff | null): Set<number> {
  const set = new Set<number>();
  if (!parsed) return set;
  let total = 0;
  parsed.files.forEach((f, i) => {
    const n = fileLineCount(f);
    total += n;
    if (n > AUTO_COLLAPSE_LINES || total > AUTO_COLLAPSE_TOTAL) set.add(i);
  });
  return set;
}

function splitPath(path: string): { dir: string; name: string } {
  const i = path.lastIndexOf('/');
  return i < 0 ? { dir: '', name: path } : { dir: path.slice(0, i + 1), name: path.slice(i + 1) };
}

function formatDate(date: string | null): string | null {
  if (!date) return null;
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function GitDiffViewer() {
  const [input, setInput] = useToolState(TOOL, 'input', '');
  const [view, setView] = useToolState<DiffView>(TOOL, 'view', 'unified');
  const [collapseUnchanged, setCollapseUnchanged] = useToolState(TOOL, 'collapseUnchanged', true);
  const [wrap, setWrap] = useToolState(TOOL, 'wrap', false);
  const [dragging, setDragging] = useState(false);
  const [applyTarget, setApplyTarget] = useState<DiffFile | null>(null);

  const deferred = useDeferredValue(input);
  const parsed = useMemo(() => (deferred.trim() ? parseDiff(deferred) : null), [deferred]);
  const totals = useMemo(() => (parsed ? diffTotals(parsed.files) : null), [parsed]);

  // Collapsed files reset whenever a new patch is parsed.
  const [fileState, setFileState] = useState(() => ({ parsed, collapsed: defaultCollapsed(parsed) }));
  if (fileState.parsed !== parsed) setFileState({ parsed, collapsed: defaultCollapsed(parsed) });
  const collapsed = fileState.parsed === parsed ? fileState.collapsed : defaultCollapsed(parsed);

  const toggle = (i: number) =>
    setFileState((s) => {
      const next = new Set(s.collapsed);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return { ...s, collapsed: next };
    });
  const setAll = (collapse: boolean) =>
    setFileState((s) => ({ ...s, collapsed: collapse && s.parsed ? new Set(s.parsed.files.map((_, i) => i)) : new Set() }));

  async function openFile(file: File) {
    if (file.size > MAX_FILE) {
      toast(`That file is too large (limit ${formatBytes(MAX_FILE)}).`, 'error');
      return;
    }
    try {
      setInput(await file.text());
    } catch (error) {
      toast(errorMessage(error, 'Could not read the file.'), 'error');
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) void openFile(file);
  }

  const jump = (i: number) => {
    if (collapsed.has(i)) toggle(i);
    requestAnimationFrame(() => document.getElementById(`diff-file-${i}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const files = parsed?.files ?? [];
  const hasFiles = files.length > 0;

  return (
    <ToolStack>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn('rounded-xl transition-shadow', dragging && 'ring-2 ring-accent')}
      >
        <EditorPanel
          title="Patch or diff"
          value={input}
          onChange={setInput}
          placeholder={'Paste or drop a .diff / .patch file: git diff, diff -u, or git format-patch output (several commits are fine).'}
          sample={SAMPLE}
          fileAccept=".diff,.patch,.txt,.eml,.mbox,text/plain,text/x-diff,text/x-patch"
          height={hasFiles ? '160px' : '260px'}
          lineWrapping={false}
          footer={
            totals && hasFiles ? (
              <>
                <span>{pluralize(totals.files, 'file')}</span>
                <span className="font-mono text-success">+{totals.additions}</span>
                <span className="font-mono text-danger">−{totals.deletions}</span>
                {parsed && parsed.commits.length > 0 && <span>{pluralize(parsed.commits.length, 'commit')}</span>}
              </>
            ) : undefined
          }
        />
      </div>

      {parsed && parsed.warnings.length > 0 && (
        <Alert tone={hasFiles ? 'warning' : 'danger'} title={hasFiles ? 'Parsed with warnings' : 'Nothing to show'}>
          <ul className="list-disc pl-4">
            {parsed.warnings.slice(0, 8).map((w) => (
              <li key={w}>{w}</li>
            ))}
            {parsed.warnings.length > 8 && <li>…and {parsed.warnings.length - 8} more.</li>}
          </ul>
        </Alert>
      )}

      {!parsed && (
        <EmptyState icon={FileDiff} title="No patch loaded" className="rounded-xl border border-line bg-surface">
          Paste a diff above, open or drop a .patch file, or load the sample. Nothing leaves your device.
        </EmptyState>
      )}

      {hasFiles && parsed && (
        <>
          <ToolBar className="items-center">
            <div>
              <Label>View</Label>
              <Segmented
                label="Diff view"
                value={view}
                onChange={setView}
                options={[
                  { value: 'unified', label: 'Unified', icon: Rows2 },
                  { value: 'split', label: 'Split', icon: Columns2 },
                ]}
              />
            </div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 self-end pb-1">
              <Switch label="Collapse unchanged" checked={collapseUnchanged} onChange={setCollapseUnchanged} />
              {view === 'unified' && <Switch label="Wrap lines" checked={wrap} onChange={setWrap} />}
            </div>
            <div className="flex gap-1.5 self-end sm:ml-auto">
              <Button size="sm" variant="ghost" icon={ChevronsUpDown} onClick={() => setAll(false)}>
                Expand all
              </Button>
              <Button size="sm" variant="ghost" icon={ChevronsDownUp} onClick={() => setAll(true)}>
                Collapse all
              </Button>
            </div>
          </ToolBar>

          <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
            <FileNav parsed={parsed} onJump={jump} />
            <div className="flex min-w-0 flex-col gap-4">
              {groupByCommit(parsed).map((group) => (
                <div key={group.commitIndex ?? 'none'} className="flex min-w-0 flex-col gap-3">
                  {group.commit && <CommitCard commit={group.commit} index={group.commitIndex!} total={parsed.commits.length} />}
                  {group.files.map(({ file, index }) => (
                    <DiffFileCard
                      key={index}
                      file={file}
                      anchorId={`diff-file-${index}`}
                      view={view}
                      collapseUnchanged={collapseUnchanged}
                      wrap={wrap}
                      collapsed={collapsed.has(index)}
                      onToggle={() => toggle(index)}
                      onApply={file.hunks.length > 0 && !file.binary ? () => setApplyTarget(file) : undefined}
                    />
                  ))}
                  {group.commit && group.files.length === 0 && (
                    <p className="px-1 text-[13px] text-fg-muted">This commit has no file changes.</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      <ApplyPatchDialog file={applyTarget} onClose={() => setApplyTarget(null)} />
    </ToolStack>
  );
}

interface CommitGroup {
  commit: PatchCommit | null;
  commitIndex: number | null;
  files: Array<{ file: DiffFile; index: number }>;
}

function groupByCommit(parsed: ParsedDiff): CommitGroup[] {
  const groups: CommitGroup[] = [];
  const loose: CommitGroup = { commit: null, commitIndex: null, files: [] };
  const byCommit = parsed.commits.map((commit, i): CommitGroup => ({ commit, commitIndex: i, files: [] }));
  parsed.files.forEach((file, index) => {
    if (file.commit !== null && byCommit[file.commit]) byCommit[file.commit].files.push({ file, index });
    else loose.files.push({ file, index });
  });
  if (loose.files.length) groups.push(loose);
  groups.push(...byCommit);
  return groups;
}

function CommitCard({ commit, index, total }: { commit: PatchCommit; index: number; total: number }) {
  const date = formatDate(commit.date);
  return (
    <article className="rounded-xl border border-accent-line bg-accent-soft px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-fg-secondary">
        <GitCommitHorizontal size={16} aria-hidden className="text-accent-text" />
        {total > 1 && (
          <span className="font-medium">
            Commit {index + 1} of {total}
          </span>
        )}
        {commit.hash && (
          <code className="rounded bg-surface px-1.5 py-px font-mono text-[12px] text-fg" title={commit.hash}>
            {commit.hash.slice(0, 10)}
          </code>
        )}
      </div>
      <h3 className="mt-1.5 text-[15px] font-semibold tracking-tight break-words text-fg">{commit.subject || '(no subject)'}</h3>
      <p className="mt-0.5 text-[12.5px] break-words text-fg-secondary">
        {commit.author ?? 'Unknown author'}
        {date && <span className="text-fg-muted"> · {date}</span>}
      </p>
      {commit.body && <p className="mt-2 text-[13px] leading-relaxed break-words whitespace-pre-wrap text-fg">{commit.body}</p>}
    </article>
  );
}

function FileNav({ parsed, onJump }: { parsed: ParsedDiff; onJump: (i: number) => void }) {
  const groups = groupByCommit(parsed);
  const list = (
    <nav aria-label="Files in this patch" className="flex flex-col gap-3">
      {groups.map((g) => (
        <div key={g.commitIndex ?? 'none'} className="min-w-0">
          {g.commit && parsed.commits.length > 1 && (
            <p className="mb-1 truncate px-2 text-[11.5px] font-semibold tracking-wide text-fg-muted uppercase" title={g.commit.subject}>
              {g.commitIndex! + 1}. {g.commit.subject}
            </p>
          )}
          <ul className="flex flex-col">
            {g.files.map(({ file, index }) => {
              const { dir, name } = splitPath(displayPath(file));
              const meta = STATUS_META[file.status];
              return (
                <li key={index}>
                  <button
                    type="button"
                    onClick={() => onJump(index)}
                    className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-surface-hover"
                    title={displayPath(file)}
                  >
                    <Badge tone={meta.tone} className="mt-px w-5 justify-center px-0">
                      <span aria-label={meta.label}>{meta.letter}</span>
                    </Badge>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[12.5px] text-fg">{name}</span>
                      {dir && <span className="block truncate font-mono text-[11px] text-fg-muted">{dir}</span>}
                    </span>
                    <span className="shrink-0 font-mono text-[11.5px] tabular-nums">
                      {file.binary ? (
                        <span className="text-fg-muted">bin</span>
                      ) : file.hunks.length === 0 ? (
                        <span className="text-fg-muted">{file.status === 'mode' ? 'mode' : '—'}</span>
                      ) : (
                        <>
                          <span className="text-success">+{file.additions}</span> <span className="text-danger">−{file.deletions}</span>
                        </>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
  return (
    <>
      <details className="rounded-xl border border-line bg-surface shadow-card lg:hidden" open={parsed.files.length <= 6}>
        <summary className="cursor-pointer px-4 py-2.5 text-[13px] font-semibold text-fg">Files ({parsed.files.length})</summary>
        <div className="border-t border-line p-2">{list}</div>
      </details>
      <aside className="hidden lg:block">
        <div className="sticky top-4 max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-line bg-surface p-2 shadow-card">
          <p className="px-2 pt-1 pb-2 text-[13px] font-semibold text-fg">Files ({parsed.files.length})</p>
          {list}
        </div>
      </aside>
    </>
  );
}
