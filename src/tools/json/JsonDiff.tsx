import { useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowLeftRight, GitCompare } from 'lucide-react';
import { SplitPanes, ToolBar, ToolStack } from '@/components/tool/EditorPanel';
import { Segmented } from '@/components/ui/Segmented';
import { Label, Switch } from '@/components/ui/Field';
import { Button } from '@/components/ui/Button';
import { Alert, ErrorMessage } from '@/components/ui/Alert';
import { Badge, Panel } from '@/components/ui/Panel';
import { EmptyState } from '@/components/ui/Feedback';
import { useDebouncedValue, useToolState } from '@/lib/hooks';
import { cn, formatNumber } from '@/lib/utils';
import { CodePanel } from './shared/CodePanel';
import { formatJsonError, parseJson } from './lib/json';
import { diffJson, normalizeForText, sideBySide, summarize, type AlignedRow, type DiffEntry, type DiffKind } from './lib/jsonDiff';

const SAMPLE_A = JSON.stringify(
  { id: 7, name: 'Widget', price: 9.99, tags: ['tools', 'sale'], stock: { warehouse: 12, store: 3 }, legacy: true },
  null,
  2,
);
const SAMPLE_B = JSON.stringify(
  { id: 7, name: 'Widget Pro', price: 12.5, tags: ['sale', 'tools', 'new'], stock: { warehouse: 12, store: 0 }, color: 'red' },
  null,
  2,
);

const MAX_TABLE_ROWS = 2000;
const ROW_H = 22;

function preview(value: unknown): string {
  if (value === undefined) return '';
  const s = JSON.stringify(value);
  return s.length > 140 ? `${s.slice(0, 140)}…` : s;
}

const KIND_TONE: Record<DiffKind, 'success' | 'danger' | 'warning'> = { added: 'success', removed: 'danger', changed: 'warning' };

function DiffTable({ entries, filter }: { entries: DiffEntry[]; filter: 'all' | DiffKind }) {
  const list = filter === 'all' ? entries : entries.filter((e) => e.kind === filter);
  const shown = list.slice(0, MAX_TABLE_ROWS);
  if (list.length === 0) return <EmptyState title="No differences of this kind" />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-left text-[12.5px]">
        <thead>
          <tr className="border-b border-line text-[12px] text-fg-muted">
            <th className="px-3 py-2 font-medium">Path</th>
            <th className="px-3 py-2 font-medium">Change</th>
            <th className="px-3 py-2 font-medium">Before</th>
            <th className="px-3 py-2 font-medium">After</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line font-mono">
          {shown.map((e, i) => (
            <tr key={i} className="align-top hover:bg-surface-hover/60">
              <td className="max-w-[280px] px-3 py-1.5 break-all text-fg">{e.path}</td>
              <td className="px-3 py-1.5 font-sans">
                <Badge tone={KIND_TONE[e.kind]}>{e.kind}</Badge>
              </td>
              <td className="max-w-[320px] px-3 py-1.5 break-all text-danger">{preview(e.before)}</td>
              <td className="max-w-[320px] px-3 py-1.5 break-all text-success">{preview(e.after)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {list.length > MAX_TABLE_ROWS && (
        <p className="border-t border-line px-3 py-2 text-[12.5px] text-fg-muted">
          Showing the first {formatNumber(MAX_TABLE_ROWS)} of {formatNumber(list.length)} differences.
        </p>
      )}
    </div>
  );
}

const ROW_BG: Record<AlignedRow['kind'], [string, string]> = {
  same: ['', ''],
  removed: ['bg-[var(--lk-diff-del)]', 'bg-surface-sunken'],
  added: ['bg-surface-sunken', 'bg-[var(--lk-diff-add)]'],
  modified: ['bg-[var(--lk-diff-del)]', 'bg-[var(--lk-diff-add)]'],
};

function SideBySide({ rows }: { rows: AlignedRow[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({ count: rows.length, getScrollElement: () => ref.current, estimateSize: () => ROW_H, overscan: 20 });
  return (
    <div ref={ref} className="h-[520px] overflow-auto font-mono text-[12px] leading-[22px]">
      <div className="relative min-w-[720px]" style={{ height: v.getTotalSize() }}>
        {v.getVirtualItems().map((item) => {
          const row = rows[item.index];
          const [lbg, rbg] = ROW_BG[row.kind];
          return (
            <div key={item.index} className="absolute inset-x-0 grid grid-cols-2" style={{ top: item.start, height: ROW_H }}>
              {[row.left, row.right].map((side, s) => (
                <div key={s} className={cn('flex min-w-0 border-line', s === 0 && 'border-r', s === 0 ? lbg : rbg)}>
                  <span className="w-11 shrink-0 pr-2 text-right text-fg-muted select-none">{side?.n ?? ''}</span>
                  <span className="w-4 shrink-0 text-fg-muted select-none">
                    {side && row.kind !== 'same' ? (s === 0 ? '−' : '+') : ''}
                  </span>
                  <span className="min-w-0 flex-1 overflow-hidden pr-2 whitespace-pre text-ellipsis text-fg">{side?.text ?? ''}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function JsonDiff() {
  const [left, setLeft] = useToolState('json-diff', 'left', '');
  const [right, setRight] = useToolState('json-diff', 'right', '');
  const [view, setView] = useToolState<'table' | 'text'>('json-diff', 'view', 'table');
  const [ignoreOrder, setIgnoreOrder] = useToolState('json-diff', 'ignoreOrder', false);
  const [filter, setFilter] = useToolState<'all' | DiffKind>('json-diff', 'filter', 'all');
  const a = useDebouncedValue(left, 150);
  const b = useDebouncedValue(right, 150);

  const pa = useMemo(() => (a.trim() ? parseJson(a) : null), [a]);
  const pb = useMemo(() => (b.trim() ? parseJson(b) : null), [b]);
  const ready = pa?.ok && pb?.ok;

  const entries = useMemo(
    () => (pa?.ok && pb?.ok ? diffJson(pa.value, pb.value, { ignoreArrayOrder: ignoreOrder }) : null),
    [pa, pb, ignoreOrder],
  );
  const aligned = useMemo(() => {
    if (!(pa?.ok && pb?.ok) || view !== 'text') return undefined;
    const ta = JSON.stringify(normalizeForText(pa.value, ignoreOrder), null, 2);
    const tb = JSON.stringify(normalizeForText(pb.value, ignoreOrder), null, 2);
    return sideBySide(ta, tb);
  }, [pa, pb, view, ignoreOrder]);
  const stats = entries ? summarize(entries) : null;

  return (
    <ToolStack>
      <SplitPanes>
        <CodePanel
          title="Original"
          value={left}
          onChange={setLeft}
          language="json"
          placeholder="Paste the original JSON…"
          sample={SAMPLE_A}
          fileAccept=".json,application/json,text/plain"
          invalid={Boolean(pa && !pa.ok)}
          height="300px"
        />
        <CodePanel
          title="Modified"
          value={right}
          onChange={setRight}
          language="json"
          placeholder="Paste the modified JSON…"
          sample={SAMPLE_B}
          fileAccept=".json,application/json,text/plain"
          invalid={Boolean(pb && !pb.ok)}
          height="300px"
        />
      </SplitPanes>
      {pa && !pa.ok && <ErrorMessage title="Original is not valid JSON" error={formatJsonError(pa.error)} />}
      {pb && !pb.ok && <ErrorMessage title="Modified is not valid JSON" error={formatJsonError(pb.error)} />}
      <ToolBar>
        <div>
          <Label>View</Label>
          <Segmented
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: 'table', label: 'Changes table' },
              { value: 'text', label: 'Side by side' },
            ]}
          />
        </div>
        <Switch label="Ignore array order" checked={ignoreOrder} onChange={setIgnoreOrder} className="h-8" />
        <Button
          size="sm"
          variant="ghost"
          icon={ArrowLeftRight}
          className="h-8"
          disabled={!left && !right}
          onClick={() => {
            setLeft(right);
            setRight(left);
          }}
        >
          Swap sides
        </Button>
        {stats && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5 self-center">
            <Badge tone="success">+{formatNumber(stats.added)} added</Badge>
            <Badge tone="danger">−{formatNumber(stats.removed)} removed</Badge>
            <Badge tone="warning">~{formatNumber(stats.changed)} changed</Badge>
          </div>
        )}
      </ToolBar>

      {!ready ? (
        <Panel>
          <EmptyState icon={GitCompare} title="Compare two JSON documents">
            Paste or open both documents. Keys are compared structurally, so formatting and key order never count as changes.
          </EmptyState>
        </Panel>
      ) : stats?.total === 0 ? (
        <Alert tone="success" title="No differences">
          Both documents are semantically equal{ignoreOrder ? ' (ignoring array order)' : ''}.
        </Alert>
      ) : view === 'table' ? (
        <Panel
          title="Changes"
          bodyClassName="p-0"
          actions={
            <Segmented
              label="Filter changes"
              size="sm"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'added', label: 'Added' },
                { value: 'removed', label: 'Removed' },
                { value: 'changed', label: 'Changed' },
              ]}
            />
          }
        >
          <DiffTable entries={entries!} filter={filter} />
        </Panel>
      ) : (
        <Panel title="Side-by-side (keys sorted)" bodyClassName="p-0">
          {aligned === null ? (
            <p className="p-4 text-[13px] text-fg-muted">
              These documents are too different to lay out line by line in reasonable time. Use the changes table instead.
            </p>
          ) : (
            <SideBySide rows={aligned ?? []} />
          )}
        </Panel>
      )}
    </ToolStack>
  );
}
