import { useMemo, useState } from 'react';
import { ChartColumn, Search } from 'lucide-react';
import { ToolStack } from '@/components/tool/EditorPanel';
import { Alert } from '@/components/ui/Alert';
import { CopyButton, DownloadButton } from '@/components/ui/Actions';
import { EmptyState } from '@/components/ui/Feedback';
import { Input } from '@/components/ui/Field';
import { Badge, Stat } from '@/components/ui/Panel';
import { useDebouncedValue } from '@/lib/hooks';
import { cn, formatNumber, withExtension } from '@/lib/utils';
import { writeCsv } from './lib/csv';
import { tableStats, TYPE_LABELS, type ColumnStats, type ColumnType } from './lib/stats';
import { CsvSourcePanel, dataNotes, useCsvSource } from './components/CsvSource';
import { SAMPLE_CSV } from './components/samples';

const TOOL = 'csv-statistics';

const TYPE_TONE: Record<ColumnType, 'neutral' | 'accent' | 'success' | 'warning'> = {
  empty: 'neutral',
  integer: 'accent',
  decimal: 'accent',
  boolean: 'success',
  date: 'warning',
  text: 'neutral',
};

function num(value: number | undefined, digits = 4): string {
  if (value === undefined || Number.isNaN(value)) return '—';
  return formatNumber(value, digits);
}

function pct(part: number, whole: number): string {
  if (!whole) return '0%';
  const p = (part / whole) * 100;
  return `${p < 10 && p > 0 ? p.toFixed(1) : Math.round(p)}%`;
}

/** One row per column, for copying/downloading the profile. */
function statsTable(stats: ColumnStats[]) {
  const headers = [
    'column',
    'type',
    'count',
    'filled',
    'empty',
    'unique',
    'min',
    'max',
    'mean',
    'median',
    'std_dev',
    'sum',
    'min_length',
    'max_length',
    'top_value',
    'top_count',
  ];
  const rows = stats.map((s) => {
    const min = s.numeric ? String(s.numeric.min) : (s.dates?.min ?? '');
    const max = s.numeric ? String(s.numeric.max) : (s.dates?.max ?? '');
    return [
      s.name,
      s.type,
      String(s.count),
      String(s.filled),
      String(s.empty),
      String(s.unique),
      min,
      max,
      s.numeric ? String(s.numeric.mean) : '',
      s.numeric ? String(s.numeric.median) : '',
      s.numeric ? String(s.numeric.stdDev) : '',
      s.numeric ? String(s.numeric.sum) : '',
      String(s.minLength),
      String(s.maxLength),
      s.top[0]?.value ?? '',
      s.top[0] ? String(s.top[0].count) : '',
    ];
  });
  return { headers, rows };
}

export default function CsvStatistics() {
  const source = useCsvSource(TOOL);
  const [query, setQuery] = useState('');
  const q = useDebouncedValue(query, 120).trim().toLowerCase();
  const data = source.data;

  const stats = useMemo(() => (data && data.table.headers.length ? tableStats(data.table) : null), [data]);
  const visible = useMemo(() => (stats && q ? stats.filter((s) => s.name.toLowerCase().includes(q)) : stats), [stats, q]);
  const summary = useMemo(() => {
    if (!stats || !data) return null;
    const cells = data.table.rows.length * data.table.headers.length;
    const empty = stats.reduce((n, s) => n + s.empty, 0);
    const numeric = stats.filter((s) => s.type === 'integer' || s.type === 'decimal').length;
    return { cells, empty, numeric };
  }, [stats, data]);
  const exportCsv = useMemo(() => (stats ? writeCsv(statsTable(stats)) : ''), [stats]);
  const notes = data ? dataNotes(data) : [];

  return (
    <ToolStack>
      <CsvSourcePanel source={source} sample={SAMPLE_CSV} height="220px" />
      {notes.length > 0 && (
        <Alert tone="warning" title="Input notes">
          <ul className="list-disc pl-4">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </Alert>
      )}

      {!stats || !data || !summary ? (
        <div className="rounded-xl border border-line bg-surface shadow-card">
          <EmptyState icon={ChartColumn} title={source.busy ? 'Parsing…' : 'No data yet'}>
            Paste CSV or open a file to profile every column: inferred type, empty and unique counts, min, max, mean and median.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Rows" value={formatNumber(data.table.rows.length, 0)} />
            <Stat label="Columns" value={formatNumber(data.table.headers.length, 0)} />
            <Stat label="Empty cells" value={`${formatNumber(summary.empty, 0)} (${pct(summary.empty, summary.cells)})`} />
            <Stat label="Numeric columns" value={formatNumber(summary.numeric, 0)} />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-48 flex-1 sm:max-w-xs">
              <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-muted" aria-hidden />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find a column…"
                aria-label="Find a column"
                className="h-8 pl-8 text-[13px]"
              />
            </div>
            <div className="ml-auto flex flex-wrap gap-2">
              <CopyButton value={exportCsv} label="Copy as CSV" />
              <DownloadButton
                data={exportCsv}
                filename={withExtension(data.fileName ?? 'data', 'stats.csv')}
                type="text/csv"
                label="Download CSV"
              />
              <DownloadButton
                data={() => JSON.stringify(stats, null, 2)}
                filename={withExtension(data.fileName ?? 'data', 'stats.json')}
                type="application/json"
                label="JSON"
              />
            </div>
          </div>

          {visible && visible.length === 0 ? (
            <p className="text-[13px] text-fg-muted">No column matches “{query}”.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visible?.map((s) => (
                <ColumnCard key={s.index} stats={s} />
              ))}
            </div>
          )}
        </>
      )}
    </ToolStack>
  );
}

function ColumnCard({ stats: s }: { stats: ColumnStats }) {
  const metrics: Array<[string, string]> = [
    ['Filled', `${formatNumber(s.filled, 0)} (${pct(s.filled, s.count)})`],
    ['Empty', `${formatNumber(s.empty, 0)} (${pct(s.empty, s.count)})`],
    ['Unique', formatNumber(s.unique, 0)],
    ['Length', s.filled ? (s.minLength === s.maxLength ? String(s.minLength) : `${s.minLength}–${s.maxLength}`) : '—'],
  ];
  if (s.numeric) {
    metrics.push(
      ['Min', num(s.numeric.min)],
      ['Max', num(s.numeric.max)],
      ['Mean', num(s.numeric.mean)],
      ['Median', num(s.numeric.median)],
      ['Std. dev.', num(s.numeric.stdDev)],
      ['Sum', num(s.numeric.sum)],
    );
  }
  if (s.dates) metrics.push(['Earliest', s.dates.min], ['Latest', s.dates.max]);
  if (s.booleans)
    metrics.push(['True / yes', formatNumber(s.booleans.trueCount, 0)], ['False / no', formatNumber(s.booleans.falseCount, 0)]);
  const maxTop = s.top[0]?.count ?? 1;

  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card">
      <header className="flex min-h-11 items-center justify-between gap-2 border-b border-line px-4 py-2">
        <h3 className="min-w-0 truncate text-[13px] font-semibold text-fg" title={s.name}>
          <span className="mr-1.5 font-mono text-[11.5px] font-normal text-fg-muted">#{s.index + 1}</span>
          {s.name || <span className="font-normal text-fg-muted italic">unnamed</span>}
        </h3>
        <div className="flex shrink-0 items-center gap-1.5">
          {s.type === 'text' && s.typeConfidence < 1 && s.numeric && <Badge tone="warning">mixed</Badge>}
          <Badge tone={TYPE_TONE[s.type]}>{TYPE_LABELS[s.type]}</Badge>
        </div>
      </header>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 px-4 py-3 text-[13px]">
        {metrics.map(([label, value]) => (
          <div key={label} className="flex min-w-0 items-baseline justify-between gap-2">
            <dt className="shrink-0 text-fg-muted">{label}</dt>
            <dd className="truncate font-mono text-[12.5px] text-fg tabular-nums" title={value}>
              {value}
            </dd>
          </div>
        ))}
      </dl>
      {s.top.length > 0 && (
        <div className="mt-auto border-t border-line px-4 py-3">
          <p className="mb-1.5 text-[12px] font-medium text-fg-secondary">Most common</p>
          <ul className="space-y-1">
            {s.top.map((t) => (
              <li
                key={t.value}
                className="relative flex items-center justify-between gap-3 overflow-hidden rounded px-2 py-0.5 text-[12.5px]"
              >
                <span
                  aria-hidden
                  className={cn('absolute inset-y-0 left-0 rounded bg-accent-soft')}
                  style={{ width: `${Math.max(4, (t.count / maxTop) * 100)}%` }}
                />
                <span className="relative min-w-0 truncate font-mono text-fg" title={t.value}>
                  {t.value}
                </span>
                <span className="relative shrink-0 font-mono text-fg-muted tabular-nums">{formatNumber(t.count, 0)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
