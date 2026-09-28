import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, ArrowUpDown, Download, X } from 'lucide-react';
import { CopyButton } from '@/components/ui/Actions';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Panel';
import { useObjectUrl } from '@/lib/hooks';
import { cn, downloadBlob, formatBytes, formatNumber } from '@/lib/utils';
import type { SqlValue } from '../lib/sqlBuild';
import { cellKind, cellPreview, hexDump, rowToObject, rowToTsv, textValue } from '../lib/sqlFormat';

const ROW_HEIGHT = 32;
const NUM_COL = 56;

export interface GridSort {
  column: string;
  dir: 'asc' | 'desc';
}

function columnWidth(name: string, rows: SqlValue[][], index: number, type = ''): number {
  // Header: name + type label (smaller font) + sort icon.
  let chars = name.length + Math.ceil(type.length * 0.8) + (type ? 3 : 2);
  const sample = Math.min(rows.length, 80);
  for (let r = 0; r < sample; r++) {
    const v = rows[r][index];
    const len = v === null ? 4 : v instanceof Uint8Array ? 14 : Math.min(String(v).length, 60);
    if (len > chars) chars = len;
  }
  return Math.round(Math.min(360, Math.max(76, chars * 7.4 + 26)));
}

function imageMime(bytes: Uint8Array): string | null {
  const b = bytes;
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a) {
    return b.length > 40 ? 'image/png' : null;
  }
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b.length > 12 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

export function CellValue({ value }: { value: SqlValue }) {
  const kind = cellKind(value);
  if (kind === 'null') {
    return (
      <span className="rounded border border-line bg-surface-hover px-1 font-sans text-[10.5px] font-semibold tracking-wide text-fg-muted">
        NULL
      </span>
    );
  }
  if (kind === 'blob') {
    return (
      <span className="font-sans text-[12px]">
        <span className="font-semibold text-accent-text">BLOB</span>{' '}
        <span className="text-fg-muted">{formatBytes((value as Uint8Array).length)}</span>
      </span>
    );
  }
  if (kind === 'integer' || kind === 'real') return <span className="text-[var(--lk-syn-number)]">{String(value)}</span>;
  return <>{cellPreview(value)}</>;
}

/** Virtualized, horizontally scrollable result table with a cell inspector. */
export function DataGrid({
  columns,
  rows,
  rowOffset = 0,
  sort,
  onSort,
  maxHeight = 480,
  label,
  columnTypes,
  fileBase = 'row',
}: {
  columns: string[];
  rows: SqlValue[][];
  rowOffset?: number;
  sort?: GridSort | null;
  onSort?: (column: string) => void;
  maxHeight?: number;
  label: string;
  columnTypes?: Record<string, string>;
  fileBase?: string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState<{ row: number; col: number } | null>(null);
  const widths = useMemo(() => columns.map((c, i) => columnWidth(c, rows, i, columnTypes?.[c])), [columns, rows, columnTypes]);
  const totalWidth = NUM_COL + widths.reduce((a, b) => a + b, 0);

  // Reset the selection when the data changes (derived-state pattern, no effect needed).
  const [lastRows, setLastRows] = useState(rows);
  if (lastRows !== rows) {
    setLastRows(rows);
    setSelected(null);
  }

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  const height = Math.min(maxHeight, ROW_HEIGHT * (rows.length + 1) + 2);

  function select(row: number, col: number) {
    setSelected({ row, col });
    virtualizer.scrollToIndex(row, { align: 'auto' });
    requestAnimationFrame(() => {
      scrollRef.current?.querySelector<HTMLElement>(`[data-cell="${row}:${col}"]`)?.focus({ preventScroll: false });
    });
  }

  function onKeyDown(e: KeyboardEvent) {
    if (!selected || !rows.length) return;
    const moves: Record<string, [number, number]> = {
      ArrowDown: [1, 0],
      ArrowUp: [-1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      PageDown: [10, 0],
      PageUp: [-10, 0],
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      const row = Math.min(rows.length - 1, Math.max(0, selected.row + move[0]));
      const col = Math.min(columns.length - 1, Math.max(0, selected.col + move[1]));
      select(row, col);
    } else if (e.key === 'Escape') {
      setSelected(null);
    }
  }

  const selectedRow = selected ? rows[selected.row] : null;
  const selectedValue = selected && selectedRow ? (selectedRow[selected.col] ?? null) : null;

  return (
    <div className="min-w-0">
      <div
        ref={scrollRef}
        role="grid"
        aria-label={label}
        aria-rowcount={rows.length + 1}
        aria-colcount={columns.length + 1}
        onKeyDown={onKeyDown}
        className="relative overflow-auto rounded-lg border border-line bg-surface-sunken"
        style={{ height }}
      >
        <div style={{ width: totalWidth, minWidth: '100%' }}>
          <div role="row" aria-rowindex={1} className="sticky top-0 z-10 flex border-b border-line-strong bg-surface-raised">
            <div
              role="columnheader"
              className="sticky left-0 z-10 flex shrink-0 items-center justify-end border-r border-line bg-surface-raised px-2 text-[11px] text-fg-muted"
              style={{ width: NUM_COL, height: ROW_HEIGHT }}
            >
              #
            </div>
            {columns.map((col, i) => {
              const active = sort?.column === col;
              const SortIcon = active ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown;
              const type = columnTypes?.[col];
              return (
                <div
                  key={`${col}-${i}`}
                  role="columnheader"
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                  className="flex shrink-0 items-center border-r border-line"
                  style={{ width: widths[i], height: ROW_HEIGHT }}
                >
                  {onSort ? (
                    <button
                      type="button"
                      onClick={() => onSort(col)}
                      className="group flex h-full w-full min-w-0 items-center gap-1.5 px-2.5 text-left text-[12.5px] font-semibold text-fg hover:bg-surface-hover"
                      title={`Sort by ${col}`}
                    >
                      <span className="truncate">{col}</span>
                      {type && <span className="truncate text-[10.5px] font-normal text-fg-muted uppercase">{type}</span>}
                      <SortIcon
                        size={12}
                        aria-hidden
                        className={cn('ml-auto shrink-0', active ? 'text-accent-text' : 'text-fg-muted opacity-0 group-hover:opacity-100')}
                      />
                    </button>
                  ) : (
                    <span className="truncate px-2.5 text-[12.5px] font-semibold text-fg" title={col}>
                      {col}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              return (
                <div
                  key={item.key}
                  role="row"
                  aria-rowindex={item.index + 2}
                  className={cn(
                    'absolute left-0 flex w-full border-b border-line',
                    item.index % 2 === 1 && 'bg-surface-hover/35',
                    selected?.row === item.index && 'bg-accent-soft',
                  )}
                  style={{ height: ROW_HEIGHT, transform: `translateY(${item.start}px)` }}
                >
                  <div
                    role="rowheader"
                    className="sticky left-0 flex shrink-0 items-center justify-end border-r border-line bg-surface-sunken px-2 font-mono text-[11px] text-fg-muted tabular-nums"
                    style={{ width: NUM_COL }}
                  >
                    {formatNumber(rowOffset + item.index + 1, 0)}
                  </div>
                  {columns.map((_, c) => {
                    const value = row[c] ?? null;
                    const isSel = selected?.row === item.index && selected.col === c;
                    const numeric = typeof value === 'number';
                    return (
                      <div
                        key={c}
                        role="gridcell"
                        data-cell={`${item.index}:${c}`}
                        tabIndex={isSel || (!selected && item.index === 0 && c === 0) ? 0 : -1}
                        aria-selected={isSel}
                        onClick={() => setSelected({ row: item.index, col: c })}
                        onFocus={() => !isSel && setSelected({ row: item.index, col: c })}
                        className={cn(
                          'flex shrink-0 cursor-default items-center overflow-hidden border-r border-line px-2.5 font-mono text-[12.5px] whitespace-nowrap text-fg outline-none',
                          numeric && 'justify-end tabular-nums',
                          isSel && 'bg-accent-soft ring-2 ring-accent ring-inset',
                        )}
                        style={{ width: widths[c] }}
                      >
                        <span className="truncate">
                          <CellValue value={value} />
                        </span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      {selected && selectedRow && (
        <CellInspector
          column={columns[selected.col]}
          columns={columns}
          row={selectedRow}
          rowNumber={rowOffset + selected.row + 1}
          value={selectedValue}
          fileBase={fileBase}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function CellInspector({
  column,
  columns,
  row,
  rowNumber,
  value,
  fileBase,
  onClose,
}: {
  column: string;
  columns: string[];
  row: SqlValue[];
  rowNumber: number;
  value: SqlValue;
  fileBase: string;
  onClose: () => void;
}) {
  const kind = cellKind(value);
  const blob = value instanceof Uint8Array ? value : null;
  const mime = blob ? imageMime(blob) : null;
  const imageBlob = useMemo(() => (blob && mime ? new Blob([blob as Uint8Array<ArrayBuffer>], { type: mime }) : null), [blob, mime]);
  const imageUrl = useObjectUrl(imageBlob);
  const text = typeof value === 'string' ? value : null;

  return (
    <section aria-label="Cell details" className="mt-2 rounded-lg border border-line bg-surface-raised">
      <header className="flex flex-wrap items-center gap-2 border-b border-line py-1.5 pr-1.5 pl-3">
        <span className="min-w-0 truncate text-[12.5px] text-fg-secondary">
          Row {formatNumber(rowNumber, 0)} · <span className="font-mono font-semibold text-fg">{column}</span>
        </span>
        <Badge>{kind.toUpperCase()}</Badge>
        {text !== null && <span className="text-[12px] text-fg-muted">{formatNumber(text.length, 0)} chars</span>}
        {blob && <span className="text-[12px] text-fg-muted">{formatBytes(blob.length)}</span>}
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <CopyButton value={() => (value === null ? 'NULL' : textValue(value))} label="Copy value" />
          <CopyButton value={() => JSON.stringify(rowToObject(columns, row), null, 2)} label="Row JSON" />
          <CopyButton value={() => rowToTsv(row)} label="Row TSV" />
          {blob && (
            <Button
              size="sm"
              icon={Download}
              onClick={() => downloadBlob(new Blob([blob as Uint8Array<ArrayBuffer>], { type: mime ?? 'application/octet-stream' }), `${fileBase}-${column}.bin`)}
            >
              Save BLOB
            </Button>
          )}
          <IconButton icon={X} label="Close cell details" size="sm" onClick={onClose} />
        </div>
      </header>
      <div className="max-h-72 overflow-auto p-3">
        {kind === 'null' ? (
          <p className="text-[13px] text-fg-muted italic">This cell is NULL (no value).</p>
        ) : blob ? (
          <div className="flex flex-col gap-3">
            {imageUrl && <img src={imageUrl} alt={`${column} image`} className="lk-checker max-h-40 w-auto self-start rounded border border-line" />}
            <pre className="overflow-x-auto font-mono text-[12px] leading-relaxed text-fg-secondary">{hexDump(blob, 256)}</pre>
          </div>
        ) : (
          <pre className="font-mono text-[12.5px] leading-relaxed break-words whitespace-pre-wrap text-fg">{String(value)}</pre>
        )}
      </div>
    </section>
  );
}
