import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { cn, formatNumber } from '@/lib/utils';
import type { Table } from '../lib/csv';
import type { SortState } from '../lib/table';
import { t } from '@/lib/i18n';

const ROW_HEIGHT = 32;
const NUM_MIN = 48;

export interface GridCell {
  /** Position in the current view (after filter/sort). */
  row: number;
  col: number;
}

function measureColumns(table: Table): number[] {
  const sample = Math.min(table.rows.length, 200);
  return table.headers.map((name, c) => {
    let chars = Math.max(4, [...name].length + 3);
    for (let r = 0; r < sample; r++) {
      const v = table.rows[r][c] ?? '';
      const len = Math.min(v.length, 48);
      if (len > chars) chars = len;
    }
    return Math.round(Math.min(320, Math.max(84, chars * 7.6 + 24)));
  });
}

const NUMERIC_CELL = /^\s*[+-]?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?([eE][+-]?\d+)?\s*$/;

/**
 * Virtualised (rows and columns) spreadsheet-style grid over a string table.
 * `view` maps view positions to row indices in `table.rows`.
 */
export function CsvGrid({
  table,
  view,
  label,
  selected,
  onSelect,
  sort,
  onSort,
  onEdit,
  height = 520,
}: {
  table: Table;
  view: number[];
  label: string;
  selected: GridCell | null;
  onSelect: (cell: GridCell | null) => void;
  sort?: SortState | null;
  onSort?: (column: number) => void;
  /** When set, cells are editable. Receives the row index in `table.rows`. */
  onEdit?: (row: number, col: number, value: string) => void;
  height?: number;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<{ cell: GridCell; value: string } | null>(null);
  const editRef = useRef<HTMLInputElement>(null);

  // Column widths are measured once per column layout, so typing does not make columns jump.
  const shapeKey = `${table.headers.length}:${table.headers.join('\u0000')}`;
  const [widths, setWidths] = useState(() => measureColumns(table));
  const [lastShape, setLastShape] = useState(shapeKey);
  if (lastShape !== shapeKey) {
    setLastShape(shapeKey);
    setWidths(measureColumns(table));
  }
  const numWidth = Math.max(NUM_MIN, String(view.length).length * 8 + 22);

  const rowVirtualizer = useVirtualizer({
    count: view.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });
  const colVirtualizer = useVirtualizer({
    horizontal: true,
    count: table.headers.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => widths[i] ?? 120,
    overscan: 3,
  });
  useEffect(() => {
    colVirtualizer.measure();
  }, [widths, colVirtualizer]);

  const totalWidth = numWidth + colVirtualizer.getTotalSize();
  const gridHeight = Math.min(height, ROW_HEIGHT * (view.length + 1) + 2 + 12);
  const numericCols = useMemo(() => {
    const sample = Math.min(table.rows.length, 100);
    return table.headers.map((_, c) => {
      let filled = 0;
      for (let r = 0; r < sample; r++) {
        const v = table.rows[r][c];
        if (!v) continue;
        if (!NUMERIC_CELL.test(v)) return false;
        filled++;
      }
      return filled > 0;
    });
  }, [table]);

  useEffect(() => {
    if (editing) editRef.current?.focus();
  }, [editing]);

  function focusCell(cell: GridCell) {
    rowVirtualizer.scrollToIndex(cell.row, { align: 'auto' });
    colVirtualizer.scrollToIndex(cell.col, { align: 'auto' });
    requestAnimationFrame(() => {
      scrollRef.current?.querySelector<HTMLElement>(`[data-cell="${cell.row}:${cell.col}"]`)?.focus({ preventScroll: true });
    });
  }

  function move(cell: GridCell, dr: number, dc: number) {
    const next = {
      row: Math.min(view.length - 1, Math.max(0, cell.row + dr)),
      col: Math.min(table.headers.length - 1, Math.max(0, cell.col + dc)),
    };
    onSelect(next);
    focusCell(next);
  }

  function commit(then?: [number, number]) {
    if (!editing) return;
    const rowIndex = view[editing.cell.row];
    if (rowIndex !== undefined) onEdit?.(rowIndex, editing.cell.col, editing.value);
    const cell = editing.cell;
    setEditing(null);
    if (then) move(cell, then[0], then[1]);
    else focusCell(cell);
  }

  function startEdit(cell: GridCell, initial?: string) {
    if (!onEdit) return;
    const rowIndex = view[cell.row];
    if (rowIndex === undefined) return;
    setEditing({ cell, value: initial ?? table.rows[rowIndex][cell.col] ?? '' });
  }

  function onGridKeyDown(e: KeyboardEvent) {
    if (editing || !selected || !view.length) return;
    const moves: Record<string, [number, number]> = {
      ArrowDown: [1, 0],
      ArrowUp: [-1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      PageDown: [10, 0],
      PageUp: [-10, 0],
    };
    const m = moves[e.key];
    if (m) {
      e.preventDefault();
      move(selected, m[0], m[1]);
      return;
    }
    if (e.key === 'Home' && e.ctrlKey) {
      e.preventDefault();
      move(selected, -view.length, -table.headers.length);
    } else if (e.key === 'End' && e.ctrlKey) {
      e.preventDefault();
      move(selected, view.length, table.headers.length);
    } else if (e.key === 'Tab') {
      if ((e.shiftKey && selected.col > 0) || (!e.shiftKey && selected.col < table.headers.length - 1)) {
        e.preventDefault();
        move(selected, 0, e.shiftKey ? -1 : 1);
      }
    } else if (onEdit && (e.key === 'Enter' || e.key === 'F2')) {
      e.preventDefault();
      startEdit(selected);
    } else if (onEdit && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      const rowIndex = view[selected.row];
      if (rowIndex !== undefined) onEdit(rowIndex, selected.col, '');
    } else if (onEdit && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      startEdit(selected, e.key);
    } else if (e.key === 'Escape') {
      onSelect(null);
    }
  }

  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualCols = colVirtualizer.getVirtualItems();

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-label={label}
      aria-rowcount={view.length + 1}
      aria-colcount={table.headers.length + 1}
      aria-readonly={!onEdit || undefined}
      onKeyDown={onGridKeyDown}
      className="relative overflow-auto rounded-lg border border-line bg-surface-sunken"
      style={{ height: gridHeight }}
    >
      <div style={{ width: totalWidth, minWidth: '100%', height: rowVirtualizer.getTotalSize() + ROW_HEIGHT, position: 'relative' }}>
        {/* Header row */}
        <div
          role="row"
          aria-rowindex={1}
          className="sticky top-0 z-20 flex border-b border-line-strong bg-surface-raised"
          style={{ height: ROW_HEIGHT, width: totalWidth, minWidth: '100%' }}
        >
          <div
            role="columnheader"
            className="sticky left-0 z-10 flex shrink-0 items-center justify-end border-r border-line bg-surface-raised px-2 text-[11px] text-fg-muted"
            style={{ width: numWidth }}
          >
            #
          </div>
          <div className="relative flex-1">
            {virtualCols.map((vc) => {
              const c = vc.index;
              const name = table.headers[c];
              const active = sort?.column === c;
              const SortIcon = active ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
              const isSelCol = selected?.col === c;
              return (
                <div
                  key={vc.key}
                  role="columnheader"
                  aria-colindex={c + 2}
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className={cn('absolute top-0 flex h-full items-center border-r border-line', isSelCol && 'bg-accent-soft')}
                  style={{ left: vc.start, width: vc.size }}
                >
                  {onSort ? (
                    <button
                      type="button"
                      onClick={() => onSort(c)}
                      className="group flex h-full w-full min-w-0 items-center gap-1.5 px-2.5 text-left text-[12.5px] font-semibold text-fg hover:bg-surface-hover"
                      title={t('{name} · click to sort', { name: name || t('unnamed') })}
                    >
                      <span className={cn('truncate', !name && 'text-fg-muted italic')}>{name || t('unnamed')}</span>
                      <SortIcon
                        size={12}
                        aria-hidden
                        className={cn(
                          'ml-auto shrink-0',
                          active ? 'text-accent-text' : 'text-fg-muted opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
                        )}
                      />
                    </button>
                  ) : (
                    <span className="truncate px-2.5 text-[12.5px] font-semibold text-fg" title={name}>
                      {name}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Body */}
        {virtualRows.map((vr) => {
          const rowIndex = view[vr.index];
          const row = table.rows[rowIndex];
          if (!row) return null;
          const isSelRow = selected?.row === vr.index;
          return (
            <div
              key={vr.key}
              role="row"
              aria-rowindex={vr.index + 2}
              className={cn(
                'absolute left-0 flex border-b border-line',
                vr.index % 2 === 1 && 'bg-surface-hover/35',
                isSelRow && 'bg-accent-soft/60',
              )}
              style={{ top: ROW_HEIGHT + vr.start, height: ROW_HEIGHT, width: totalWidth, minWidth: '100%' }}
            >
              <div
                role="rowheader"
                className={cn(
                  'sticky left-0 z-10 flex shrink-0 items-center justify-end border-r border-line px-2 font-mono text-[11px] tabular-nums',
                  isSelRow ? 'bg-accent-soft text-accent-text' : 'bg-surface-sunken text-fg-muted',
                )}
                style={{ width: numWidth }}
                title={t('Row {rowIndex} in the file', { rowIndex: rowIndex + 1 })}
              >
                {formatNumber(rowIndex + 1, 0)}
              </div>
              <div className="relative flex-1">
                {virtualCols.map((vc) => {
                  const c = vc.index;
                  const value = row[c] ?? '';
                  const isSel = isSelRow && selected?.col === c;
                  const isEditing = editing && editing.cell.row === vr.index && editing.cell.col === c;
                  const cell = { row: vr.index, col: c };
                  return (
                    <div
                      key={vc.key}
                      role="gridcell"
                      aria-colindex={c + 2}
                      data-cell={`${vr.index}:${c}`}
                      tabIndex={isSel || (!selected && vr.index === 0 && c === 0) ? 0 : -1}
                      aria-selected={isSel}
                      onMouseDown={() => {
                        if (!isSel) onSelect(cell);
                      }}
                      onFocus={() => {
                        if (!isSel && !editing) onSelect(cell);
                      }}
                      onDoubleClick={() => startEdit(cell)}
                      className={cn(
                        'absolute top-0 flex h-full items-center overflow-hidden border-r border-line font-mono text-[12.5px] whitespace-nowrap text-fg outline-none',
                        !isEditing && 'px-2.5',
                        numericCols[c] && 'justify-end tabular-nums',
                        isSel && 'z-[1] bg-accent-soft ring-2 ring-accent ring-inset',
                      )}
                      style={{ left: vc.start, width: vc.size }}
                      title={value.length > 30 || value.includes('\n') ? value.slice(0, 500) : undefined}
                    >
                      {isEditing ? (
                        <input
                          ref={editRef}
                          aria-label={t('Edit {headers}, row {rowIndex}', { headers: table.headers[c] || t('Column {i}', { i: c + 1 }), rowIndex: rowIndex + 1 })}
                          value={editing.value}
                          onChange={(e) => setEditing({ cell: editing.cell, value: e.target.value })}
                          onBlur={() => commit()}
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commit([e.shiftKey ? -1 : 1, 0]);
                            } else if (e.key === 'Tab') {
                              e.preventDefault();
                              commit([0, e.shiftKey ? -1 : 1]);
                            } else if (e.key === 'Escape') {
                              e.preventDefault();
                              setEditing(null);
                              focusCell(editing.cell);
                            }
                          }}
                          className="h-full w-full bg-surface-raised px-2.5 font-mono text-[12.5px] text-fg outline-none ring-2 ring-accent ring-inset"
                        />
                      ) : value === '' ? null : (
                        <span className="truncate">{value.includes('\n') ? value.replace(/\r?\n/g, ' ↵ ') : value}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
