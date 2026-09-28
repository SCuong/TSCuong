import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Code, Download, Funnel, FunnelX, Plus, X } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { ErrorMessage } from '@/components/ui/Alert';
import { Input, Label, Select } from '@/components/ui/Field';
import { Segmented } from '@/components/ui/Segmented';
import { EmptyState, Spinner } from '@/components/ui/Feedback';
import { useDebouncedValue } from '@/lib/hooks';
import { errorMessage, formatDuration, formatNumber } from '@/lib/utils';
import type { BrowseResult, SchemaObject, TableDetails } from '../lib/protocol';
import { FILTER_OPS, buildBrowseQuery, pageCount, sqlLiteral, type ColumnFilter, type FilterOp } from '../lib/sqlBuild';
import { validateWhereClause } from '../lib/sqlClassifier';
import { DataGrid, type GridSort } from './DataGrid';
import { Menu } from './Menu';
import type { SqlCall } from './types';

const PAGE_SIZES = ['50', '100', '500'] as const;
type PageSize = (typeof PAGE_SIZES)[number];

/** Replace ? placeholders with literals so the query can be pasted into the editor. */
function inlineParams(sql: string, params: Array<string | number | null | Uint8Array>): string {
  let i = 0;
  return sql.replace(/\?/g, () => sqlLiteral(params[i++] ?? null));
}

export function BrowsePanel({
  call,
  object,
  details,
  refreshKey,
  onOpenInEditor,
  onExportTable,
}: {
  call: SqlCall;
  object: SchemaObject;
  details: TableDetails | null;
  refreshKey: number;
  onOpenInEditor: (sql: string) => void;
  onExportTable: (name: string, format: 'csv' | 'json' | 'sql') => void;
}) {
  const [pageSize, setPageSize] = useState<PageSize>('50');
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<GridSort | null>(null);
  const [filters, setFilters] = useState<ColumnFilter[]>([]);
  const [where, setWhere] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [result, setResult] = useState<BrowseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pageInput, setPageInput] = useState('1');

  const debouncedFilters = useDebouncedValue(filters, 300);
  const debouncedWhere = useDebouncedValue(where, 400);
  const whereError = validateWhereClause(debouncedWhere);
  const columns = details?.columns.filter((c) => c.hidden === 0 || c.hidden === 2 || c.hidden === 3).map((c) => c.name) ?? result?.columns ?? [];
  const columnTypes = useMemo(
    () => Object.fromEntries((details?.columns ?? []).map((c) => [c.name, c.type])),
    [details],
  );

  const query = useMemo(
    () => ({
      table: object.name,
      sort,
      filters: debouncedFilters,
      where: whereError ? '' : debouncedWhere,
      page,
      pageSize: Number(pageSize),
    }),
    [object.name, sort, debouncedFilters, debouncedWhere, whereError, page, pageSize],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    call('browse', query)
      .then((res) => {
        if (cancelled) return;
        setResult(res);
        setError(null);
        const pages = pageCount(res.total, query.pageSize);
        if (query.page >= pages && res.total > 0) setPage(pages - 1);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [call, query, refreshKey]);

  useEffect(() => setPageInput(String(page + 1)), [page]);

  const total = result?.total ?? 0;
  const pages = pageCount(total, Number(pageSize));
  const first = total === 0 ? 0 : page * Number(pageSize) + 1;
  const last = Math.min(total, (page + 1) * Number(pageSize));
  const activeFilters = filters.filter((f) => f.op === 'isNull' || f.op === 'notNull' || f.value !== '').length + (where.trim() ? 1 : 0);

  /** Prefer the first text-like column for a new "contains" filter. */
  function defaultFilterColumn(): string {
    const text = details?.columns.find((c) => /CHAR|CLOB|TEXT/i.test(c.type) && c.pk === 0);
    return text?.name ?? columns[0];
  }

  function toggleSort(column: string) {
    setPage(0);
    setSort((s) => (s?.column !== column ? { column, dir: 'asc' } : s.dir === 'asc' ? { column, dir: 'desc' } : null));
  }

  function updateFilter(i: number, patch: Partial<ColumnFilter>) {
    setPage(0);
    setFilters((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  }

  function openInEditor() {
    const built = buildBrowseQuery(query);
    onOpenInEditor(`${inlineParams(built.sql, built.params)};`);
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
        <div>
          <Label>Rows per page</Label>
          <Segmented
            label="Rows per page"
            size="sm"
            value={pageSize}
            onChange={(v) => {
              setPageSize(v);
              setPage(0);
            }}
            options={PAGE_SIZES.map((v) => ({ value: v, label: v }))}
          />
        </div>
        <Button
          size="sm"
          variant={showFilters ? 'subtle' : 'secondary'}
          icon={Funnel}
          aria-expanded={showFilters}
          onClick={() => {
            if (!showFilters && filters.length === 0 && columns[0]) setFilters([{ column: defaultFilterColumn(), op: 'contains', value: '' }]);
            setShowFilters((s) => !s);
          }}
        >
          Filter{activeFilters ? ` (${activeFilters})` : ''}
        </Button>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <Button size="sm" variant="ghost" icon={Code} onClick={openInEditor}>
            Open as SQL
          </Button>
          <Menu
            label="Export"
            icon={Download}
            items={[
              { label: 'CSV', hint: '.csv', onSelect: () => onExportTable(object.name, 'csv') },
              { label: 'JSON', hint: '.json', onSelect: () => onExportTable(object.name, 'json') },
              ...(object.type === 'table' ? [{ label: 'SQL dump', hint: '.sql', onSelect: () => onExportTable(object.name, 'sql') }] : []),
            ]}
          />
        </div>
      </div>

      {showFilters && (
        <div className="flex flex-col gap-2 rounded-lg border border-line bg-surface-sunken p-3">
          {filters.map((f, i) => {
            const op = FILTER_OPS.find((o) => o.value === f.op);
            return (
              <div key={i} className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[minmax(0,180px)_150px_minmax(0,1fr)_auto]">
                <Select
                  aria-label="Filter column"
                  value={f.column}
                  onChange={(e) => updateFilter(i, { column: e.target.value })}
                  className="h-8 py-1 text-[13px]"
                >
                  {columns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="Filter operator"
                  value={f.op}
                  onChange={(e) => updateFilter(i, { op: e.target.value as FilterOp })}
                  className="h-8 py-1 text-[13px] max-sm:order-3"
                >
                  {FILTER_OPS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
                <Input
                  aria-label="Filter value"
                  value={f.value}
                  disabled={!op?.needsValue}
                  placeholder={op?.needsValue ? 'Value' : 'No value needed'}
                  onChange={(e) => updateFilter(i, { value: e.target.value })}
                  className="h-8 py-1 text-[13px] max-sm:order-4 max-sm:col-span-2"
                />
                <IconButton
                  icon={X}
                  label="Remove filter"
                  size="sm"
                  className="max-sm:order-2 max-sm:row-start-1 max-sm:col-start-2 self-center"
                  onClick={() => {
                    setPage(0);
                    setFilters((fs) => fs.filter((_, j) => j !== i));
                  }}
                />
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              icon={Plus}
              disabled={!columns.length}
              onClick={() => setFilters((fs) => [...fs, { column: defaultFilterColumn(), op: 'contains', value: '' }])}
            >
              Add filter
            </Button>
            {activeFilters > 0 && (
              <Button
                size="sm"
                variant="ghost"
                icon={FunnelX}
                onClick={() => {
                  setFilters([]);
                  setWhere('');
                  setPage(0);
                }}
              >
                Clear all
              </Button>
            )}
          </div>
          <div>
            <Label htmlFor="browse-where">Custom WHERE expression (optional)</Label>
            <Input
              id="browse-where"
              mono
              value={where}
              onChange={(e) => {
                setWhere(e.target.value);
                setPage(0);
              }}
              placeholder={`e.g. ${columns[0] ? `"${columns[0]}"` : 'id'} > 10 AND status = 'paid'`}
              aria-invalid={Boolean(whereError) || undefined}
              className="h-8 py-1"
            />
            <p className="mt-1 text-[12px] text-fg-muted">
              Column filters are sent as bound parameters. The custom expression must be a single read-only expression.
            </p>
          </div>
          <ErrorMessage error={whereError} />
        </div>
      )}

      <ErrorMessage error={error} title="Could not load rows" />

      {result && columns.length > 0 ? (
        <div className="relative">
          <DataGrid
            label={`Rows of ${object.name}`}
            columns={result.columns.length ? result.columns : columns}
            rows={result.rows}
            rowOffset={page * Number(pageSize)}
            sort={sort}
            onSort={toggleSort}
            columnTypes={columnTypes}
            maxHeight={560}
            fileBase={object.name}
          />
          {loading && (
            <div className="absolute top-2 right-2 rounded-md border border-line bg-surface-raised px-2 py-1 shadow-card">
              <Spinner size={13} label="Loading" />
            </div>
          )}
          {result.rows.length === 0 && (
            <p className="mt-2 text-center text-[13px] text-fg-muted">
              {activeFilters ? 'No rows match the filters.' : 'This table is empty.'}
            </p>
          )}
        </div>
      ) : loading ? (
        <div className="flex justify-center py-12">
          <Spinner label="Loading rows…" />
        </div>
      ) : (
        !error && <EmptyState title="No columns" />
      )}

      {result && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px] text-fg-muted">
          <span className="tabular-nums">
            {total === 0 ? '0 rows' : `Rows ${formatNumber(first, 0)}–${formatNumber(last, 0)} of ${formatNumber(total, 0)}`} ·{' '}
            {formatDuration(result.timeMs)}
          </span>
          <div className="flex items-center gap-1.5">
            <IconButton icon={ChevronLeft} label="Previous page" size="sm" variant="secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)} />
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                const n = Math.floor(Number(pageInput));
                if (Number.isFinite(n)) setPage(Math.min(pages, Math.max(1, n)) - 1);
              }}
            >
              <span>Page</span>
              <Input
                aria-label="Page number"
                inputMode="numeric"
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value)}
                onBlur={() => setPageInput(String(page + 1))}
                className="h-7 w-14 px-1.5 py-0 text-center text-[12.5px] tabular-nums"
              />
              <span className="tabular-nums">of {formatNumber(pages, 0)}</span>
            </form>
            <IconButton
              icon={ChevronRight}
              label="Next page"
              size="sm"
              variant="secondary"
              disabled={page >= pages - 1}
              onClick={() => setPage((p) => p + 1)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
