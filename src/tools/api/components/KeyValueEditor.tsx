import { useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { rowId, type KeyValue } from '../lib/model';
import type { Scope } from '../lib/vars';
import { VarInput } from './VarInput';

export interface KeyValueEditorProps<T extends KeyValue> {
  rows: T[];
  onChange: (rows: T[]) => void;
  /** Create a row of the right type from the base fields. */
  makeRow: (base: KeyValue) => T;
  scope: Scope;
  keyLabel?: string;
  valuePlaceholder?: string;
  keyPlaceholder?: string;
  /** id of a <datalist> with suggestions for the key column. */
  keyList?: string;
  /** Replace the value cell (e.g. a file picker). */
  renderValue?: (row: T, update: (patch: Partial<T>) => void) => ReactNode;
  /** Extra cell between value and delete (e.g. a type select or a secret toggle). */
  renderExtra?: (row: T, update: (patch: Partial<T>) => void) => ReactNode;
  extraWidth?: string;
  /** Highlight a row (e.g. a forbidden header). */
  rowNote?: (row: T) => string | null;
  label: string;
  className?: string;
}

/**
 * Editable key/value table with enable checkboxes and an always-present empty
 * row at the end: typing into it creates a real row without losing focus.
 */
export function KeyValueEditor<T extends KeyValue>({
  rows,
  onChange,
  makeRow,
  scope,
  keyLabel = 'Key',
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  keyList,
  renderValue,
  renderExtra,
  extraWidth = '0px',
  rowNote,
  label,
  className,
}: KeyValueEditorProps<T>) {
  const ghostId = useRef(rowId());
  const ghost = makeRow({ id: ghostId.current, key: '', value: '', enabled: true });
  const all = [...rows, ghost];
  const cols = renderExtra
    ? `24px minmax(0,1fr) minmax(0,1.35fr) ${extraWidth} 28px`
    : '24px minmax(0,1fr) minmax(0,1.35fr) 28px';

  const update = (row: T, patch: Partial<T>) => {
    if (row.id === ghostId.current) {
      ghostId.current = rowId();
      onChange([...rows, { ...row, ...patch }]);
    } else onChange(rows.map((r) => (r.id === row.id ? { ...r, ...patch } : r)));
  };

  return (
    <div className={cn('min-w-0', className)} role="table" aria-label={label}>
      <div role="row" className="grid items-center gap-x-1 border-b border-line px-1 pb-1.5 text-[12px] font-medium text-fg-muted" style={{ gridTemplateColumns: cols }}>
        <span role="columnheader">
          <span className="sr-only">Enabled</span>
        </span>
        <span role="columnheader" className="px-2">
          {keyLabel}
        </span>
        <span role="columnheader" className="px-2">
          Value
        </span>
        {renderExtra && (
          <span role="columnheader">
            <span className="sr-only">Options</span>
          </span>
        )}
        <span role="columnheader">
          <span className="sr-only">Remove</span>
        </span>
      </div>
      {all.map((row) => {
        const isGhost = row.id === ghostId.current;
        const note = !isGhost && rowNote ? rowNote(row) : null;
        const set = (patch: Partial<T>) => update(row, patch);
        // renderValue may return undefined to use the default text input.
        return (
          <div key={row.id} role="row" className={cn('border-b border-line/70 px-1 py-0.5', note && 'bg-warning-soft/60')}>
            <div className="grid items-center gap-x-1" style={{ gridTemplateColumns: cols }}>
              <span role="cell" className="flex justify-center">
                {!isGhost && (
                  <input
                    type="checkbox"
                    checked={row.enabled}
                    onChange={(e) => set({ enabled: e.target.checked } as Partial<T>)}
                    aria-label={`Enable ${row.key || 'row'}`}
                    className="size-3.5 cursor-pointer accent-[var(--lk-accent)]"
                  />
                )}
              </span>
              <span role="cell" className="min-w-0">
                <VarInput
                  cell
                  mono
                  value={row.key}
                  onChange={(key) => set({ key } as Partial<T>)}
                  scope={scope}
                  placeholder={keyPlaceholder}
                  aria-label={`${keyLabel}${row.key ? ` ${row.key}` : isGhost ? ' (new row)' : ''}`}
                  list={keyList}
                  className={cn(!row.enabled && !isGhost && 'opacity-50')}
                />
              </span>
              <span role="cell" className="min-w-0">
                {(!isGhost && renderValue?.(row, set)) || (
                  <VarInput
                    cell
                    mono
                    value={row.value}
                    onChange={(value) => set({ value } as Partial<T>)}
                    scope={scope}
                    placeholder={valuePlaceholder}
                    aria-label={`Value${row.key ? ` of ${row.key}` : ''}`}
                    className={cn(!row.enabled && !isGhost && 'opacity-50')}
                  />
                )}
              </span>
              {renderExtra && <span role="cell">{!isGhost && renderExtra(row, set)}</span>}
              <span role="cell" className="flex justify-center">
                {!isGhost && (
                  <button
                    type="button"
                    onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
                    aria-label={`Remove ${row.key || 'row'}`}
                    title="Remove"
                    className="inline-flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-danger"
                  >
                    <X size={14} aria-hidden />
                  </button>
                )}
              </span>
            </div>
            {note && <p className="px-8 pb-1 text-[12px] text-warning">{note}</p>}
          </div>
        );
      })}
    </div>
  );
}
