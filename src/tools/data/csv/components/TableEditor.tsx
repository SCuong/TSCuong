import { useRef, useState, type KeyboardEvent } from 'react';
import { ClipboardPaste, Eraser, Plus, TextAlignCenter, TextAlignEnd, TextAlignStart, X, type LucideIcon } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button, IconButton } from '@/components/ui/Button';
import { ConfirmDialog, Dialog } from '@/components/ui/Dialog';
import { Switch, Textarea } from '@/components/ui/Field';
import { cn, pluralize } from '@/lib/utils';
import type { Table } from '../lib/csv';
import { importTable, type ImportedTable } from '../lib/importTable';
import type { Align } from '../lib/markdownTable';
import { deleteColumn, deleteRows, insertColumn, insertRow, renameColumn, setCell } from '../lib/table';

/** Rows rendered as inputs; bigger imports still go into the output in full. */
export const EDITOR_MAX_ROWS = 300;
const MAX_COLS = 60;

const ALIGN_ICON: Record<Exclude<Align, 'none'>, LucideIcon> = {
  left: TextAlignStart,
  center: TextAlignCenter,
  right: TextAlignEnd,
};
const NEXT_ALIGN: Record<Align, Align> = { none: 'left', left: 'center', center: 'right', right: 'none' };

/**
 * A small spreadsheet-like editor for hand-made tables (Markdown/HTML
 * generators): editable header and cells, add/remove rows and columns,
 * optional per-column alignment and a paste/import dialog.
 */
export function TableEditor({
  table,
  onChange,
  align,
  onAlignChange,
  onImport,
}: {
  table: Table;
  onChange: (table: Table) => void;
  align?: Align[];
  onAlignChange?: (align: Align[]) => void;
  onImport?: (imported: ImportedTable) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importHeader, setImportHeader] = useState(true);
  const [importError, setImportError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const cols = table.headers.length;
  const shown = Math.min(table.rows.length, EDITOR_MAX_ROWS);

  function focus(row: number, col: number) {
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLInputElement>(`[data-pos="${row}:${col}"]`)?.focus());
  }

  function setAlign(col: number, value: Align) {
    if (!align || !onAlignChange) return;
    const next = Array.from({ length: cols }, (_, i) => align[i] ?? 'none');
    next[col] = value;
    onAlignChange(next);
  }

  function addColumn(at: number) {
    if (cols >= MAX_COLS) return;
    onChange(insertColumn(table, at, `Header ${cols + 1}`));
    if (align && onAlignChange) {
      const next = Array.from({ length: cols }, (_, i) => align[i] ?? 'none');
      next.splice(at, 0, 'none');
      onAlignChange(next);
    }
  }

  function removeColumn(col: number) {
    if (cols <= 1) return;
    onChange(deleteColumn(table, col));
    if (align && onAlignChange) onAlignChange(align.filter((_, i) => i !== col));
  }

  /** Enter moves down (adding a row at the end), like a spreadsheet. */
  function onCellKey(e: KeyboardEvent<HTMLInputElement>, row: number, col: number) {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
    e.preventDefault();
    const target = e.shiftKey ? row - 1 : row + 1;
    if (target < -1) return;
    if (target >= table.rows.length) {
      onChange(insertRow(table, table.rows.length));
    }
    focus(target, col);
  }

  function runImport() {
    const imported = importTable(importText, importHeader);
    if (!imported) {
      setImportError('Paste a Markdown table or CSV/TSV text first.');
      return;
    }
    if (imported.table.headers.length > MAX_COLS) {
      setImportError(`That table has ${imported.table.headers.length} columns; the editor supports up to ${MAX_COLS}.`);
      return;
    }
    onImport?.(imported);
    onChange(imported.table);
    if (onAlignChange) onAlignChange(imported.align);
    setImportOpen(false);
    setImportText('');
    setImportError(null);
  }

  const cellClass =
    'block h-8 w-full min-w-28 bg-transparent px-2.5 text-[13px] text-fg outline-none placeholder:text-fg-muted focus:bg-surface-raised focus:ring-2 focus:ring-accent focus:ring-inset';

  return (
    <div ref={rootRef} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon={Plus} onClick={() => onChange(insertRow(table, table.rows.length))}>
          Row
        </Button>
        <Button size="sm" icon={Plus} disabled={cols >= MAX_COLS} onClick={() => addColumn(cols)}>
          Column
        </Button>
        <Button size="sm" icon={ClipboardPaste} onClick={() => setImportOpen(true)}>
          Import CSV / Markdown
        </Button>
        <Button size="sm" variant="ghost" icon={Eraser} className="ml-auto" onClick={() => setConfirmClear(true)}>
          Clear cells
        </Button>
      </div>

      <div className="max-h-[460px] overflow-auto rounded-lg border border-line bg-surface-sunken">
        <table className="w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-surface-raised">
            <tr>
              <th scope="col" className="w-10 min-w-10 border-r border-b border-line-strong" aria-label="Row" />
              {table.headers.map((h, c) => {
                const a = align?.[c] ?? 'none';
                const AlignIcon = a === 'none' ? TextAlignStart : ALIGN_ICON[a];
                return (
                  <th key={c} scope="col" className="border-r border-b border-line-strong p-0 align-top">
                    <div className="flex items-center">
                      <input
                        value={h}
                        data-pos={`-1:${c}`}
                        aria-label={`Header ${c + 1}`}
                        onChange={(e) => onChange(renameColumn(table, c, e.target.value))}
                        onKeyDown={(e) => onCellKey(e, -1, c)}
                        className={cn(cellClass, 'font-semibold')}
                      />
                      {align && onAlignChange && (
                        <IconButton
                          icon={AlignIcon}
                          size="sm"
                          label={`Column ${c + 1} alignment: ${a === 'none' ? 'default' : a}. Click to change.`}
                          className={cn('shrink-0', a === 'none' ? 'opacity-50' : 'text-accent-text')}
                          onClick={() => setAlign(c, NEXT_ALIGN[a])}
                        />
                      )}
                      <IconButton
                        icon={X}
                        size="sm"
                        label={`Delete column ${c + 1}`}
                        className="mr-0.5 shrink-0"
                        disabled={cols <= 1}
                        onClick={() => removeColumn(c)}
                      />
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {table.rows.slice(0, shown).map((row, r) => (
              <tr key={r} className="group">
                <th scope="row" className="w-10 min-w-10 border-r border-b border-line p-0 font-mono text-[11px] font-normal text-fg-muted">
                  <div className="flex h-8 items-center justify-center">
                    <span className="group-focus-within:hidden group-hover:hidden">{r + 1}</span>
                    <span className="hidden group-focus-within:flex group-hover:flex">
                      <IconButton icon={X} size="sm" label={`Delete row ${r + 1}`} onClick={() => onChange(deleteRows(table, [r]))} />
                    </span>
                  </div>
                </th>
                {table.headers.map((_, c) => (
                  <td key={c} className="border-r border-b border-line p-0">
                    <input
                      value={row[c] ?? ''}
                      data-pos={`${r}:${c}`}
                      aria-label={`Row ${r + 1}, ${table.headers[c] || `column ${c + 1}`}`}
                      onChange={(e) => onChange(setCell(table, r, c, e.target.value))}
                      onKeyDown={(e) => onCellKey(e, r, c)}
                      className={cn(cellClass, align?.[c] === 'right' && 'text-right', align?.[c] === 'center' && 'text-center')}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {table.rows.length > shown && (
        <Alert tone="info">
          Showing the first {EDITOR_MAX_ROWS} of {pluralize(table.rows.length, 'row')} for editing. The output below includes every row.
        </Alert>
      )}
      <p className="text-[12.5px] text-fg-muted">
        {pluralize(table.rows.length, 'row')} × {pluralize(cols, 'column')} · Enter moves down and adds rows at the end
      </p>

      <Dialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import a table"
        description="Paste a Markdown table, CSV, TSV or cells copied from a spreadsheet."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setImportOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={runImport} disabled={!importText.trim()}>
              Import
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Textarea
            value={importText}
            onChange={(e) => {
              setImportText(e.target.value);
              setImportError(null);
            }}
            aria-label="Table to import"
            placeholder={'name,role\nAda,Engineer'}
            className="h-56 resize-y whitespace-pre"
            wrap="off"
            autoFocus
          />
          <Switch label="First row is header (CSV)" checked={importHeader} onChange={setImportHeader} />
          {importError && (
            <p role="alert" className="text-[13px] text-danger">
              {importError}
            </p>
          )}
        </div>
      </Dialog>

      <ConfirmDialog
        open={confirmClear}
        title="Clear all cells?"
        confirmLabel="Clear"
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => {
          setConfirmClear(false);
          onChange({ headers: table.headers, rows: table.rows.map((r) => r.map(() => '')) });
        }}
      >
        Headers are kept; every cell is emptied.
      </ConfirmDialog>
    </div>
  );
}
