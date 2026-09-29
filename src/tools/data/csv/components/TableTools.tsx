import { useMemo, useState } from 'react';
import { CaseSensitive, Search, X } from 'lucide-react';
import { IconButton } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Field';
import { useDebouncedValue } from '@/lib/hooks';
import { cn, pluralize } from '@/lib/utils';
import { writeCsv, type Table } from '../lib/csv';
import { stringify, tableToJsonValue } from '../lib/csvJson';
import { pickRows, viewIndices, type SortState } from '../lib/table';

export interface TableView {
  filter: string;
  setFilter: (v: string) => void;
  filterColumn: number;
  setFilterColumn: (v: number) => void;
  caseSensitive: boolean;
  setCaseSensitive: (v: boolean) => void;
  sort: SortState | null;
  setSort: (s: SortState | null) => void;
  /** Cycle a column: ascending → descending → unsorted. */
  toggleSort: (column: number) => void;
  /** Row indices (into table.rows) in display order. */
  indices: number[];
  active: boolean;
}

/** Filter + sort state for a table, computed with a debounced filter. */
export function useTableView(table: Table | null): TableView {
  const [filter, setFilter] = useState('');
  const [filterColumn, setFilterColumn] = useState(-1);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [sort, setSort] = useState<SortState | null>(null);
  const debounced = useDebouncedValue(filter, (table?.rows.length ?? 0) > 50_000 ? 250 : 80);
  const width = table?.headers.length ?? 0;
  const col = filterColumn < width ? filterColumn : -1;
  const effectiveSort = sort && sort.column < width ? sort : null;

  const indices = useMemo(
    () => (table ? viewIndices(table, { filter: debounced, filterColumn: col, caseSensitive, sort: effectiveSort }) : []),
    [table, debounced, col, caseSensitive, effectiveSort],
  );

  return {
    filter,
    setFilter,
    filterColumn: col,
    setFilterColumn,
    caseSensitive,
    setCaseSensitive,
    sort: effectiveSort,
    setSort,
    toggleSort: (column) =>
      setSort((prev) => (prev?.column !== column ? { column, dir: 'asc' } : prev.dir === 'asc' ? { column, dir: 'desc' } : null)),
    indices,
    active: Boolean(debounced) || Boolean(effectiveSort),
  };
}

export function FilterBar({ view, headers, className }: { view: TableView; headers: string[]; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-2', className)}>
      <div className="relative w-full sm:w-auto sm:max-w-72 sm:min-w-48 sm:flex-1">
        <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-muted" aria-hidden />
        <Input
          value={view.filter}
          onChange={(e) => view.setFilter(e.target.value)}
          placeholder="Filter rows…"
          aria-label="Filter rows"
          className="h-8 pr-8 pl-8 text-[13px]"
        />
        {view.filter && (
          <IconButton
            icon={X}
            label="Clear filter"
            size="sm"
            className="absolute top-1/2 right-0.5 -translate-y-1/2"
            onClick={() => view.setFilter('')}
          />
        )}
      </div>
      <Select
        aria-label="Filter column"
        value={view.filterColumn}
        onChange={(e) => view.setFilterColumn(Number(e.target.value))}
        className="h-8 w-auto max-w-44 min-w-32 shrink-0 py-1 text-[13px]"
      >
        <option value={-1}>All columns</option>
        {headers.map((h, i) => (
          <option key={i} value={i}>
            {h || `Column ${i + 1}`}
          </option>
        ))}
      </Select>
      <IconButton
        icon={CaseSensitive}
        label={view.caseSensitive ? 'Case-sensitive filter (on)' : 'Case-sensitive filter (off)'}
        variant="secondary"
        size="md"
        className={cn('size-8', view.caseSensitive && 'border-accent-line bg-accent-soft')}
        active={view.caseSensitive}
        aria-pressed={view.caseSensitive}
        onClick={() => view.setCaseSensitive(!view.caseSensitive)}
      />
    </div>
  );
}

export function viewSummary(view: TableView, total: number): string {
  if (view.indices.length === total) return pluralize(total, 'row');
  return `${view.indices.length.toLocaleString()} of ${pluralize(total, 'row')}`;
}

export type ExportFormat = 'csv' | 'tsv' | 'json';

/** Serialize a table (optionally only the given rows) for download. */
export function exportTable(table: Table, format: ExportFormat, header: boolean, indices?: number[]): string {
  const t = indices ? pickRows(table, indices) : table;
  if (format === 'json') {
    if (header) return stringify(tableToJsonValue(t, { shape: 'objects' }), '2');
    // Without a header row the generated column names are not data: export plain row arrays.
    const [, ...rows] = tableToJsonValue(t, { shape: 'arrays' }) as unknown[];
    return stringify(rows, '2');
  }
  return writeCsv(t, { delimiter: format === 'tsv' ? '\t' : ',', includeHeader: header });
}

export const EXPORT_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
};
