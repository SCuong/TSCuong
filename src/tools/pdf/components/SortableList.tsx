import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

export interface SortableHandle {
  /** Spread on the drag handle element. */
  handleProps: {
    onPointerDown: (e: PointerEvent<HTMLElement>) => void;
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
    'aria-label': string;
    'aria-describedby': string;
    tabIndex: number;
    role: 'button';
    className: string;
  };
  moveUp: ReactNode;
  moveDown: ReactNode;
  dragging: boolean;
}

/**
 * Vertical list with pointer drag-to-reorder (via a grip handle, works with
 * touch), Alt/Ctrl+Arrow keyboard moves on the handle and explicit move buttons.
 */
export function SortableList<T>({
  items,
  getKey,
  getLabel,
  onMove,
  renderItem,
  ariaLabel,
  className,
}: {
  items: T[];
  getKey: (item: T) => string;
  getLabel: (item: T) => string;
  onMove: (from: number, to: number) => void;
  renderItem: (item: T, index: number, sortable: SortableHandle) => ReactNode;
  ariaLabel: string;
  className?: string;
}) {
  const rows = useRef<Array<HTMLLIElement | null>>([]);
  const handles = useRef<Array<HTMLElement | null>>([]);
  const [drag, setDrag] = useState<{ from: number; slot: number } | null>(null);
  const dragRef = useRef<{ from: number; slot: number; pointerId: number } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const helpId = useId();

  useEffect(() => {
    if (!drag) return;
    const onMovePointer = (e: globalThis.PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      e.preventDefault();
      let slot = items.length;
      for (let i = 0; i < rows.current.length; i++) {
        const row = rows.current[i];
        if (!row) continue;
        const r = row.getBoundingClientRect();
        if (e.clientY < r.top + r.height / 2) {
          slot = i;
          break;
        }
      }
      const edge = 60;
      if (e.clientY < edge) window.scrollBy(0, -12);
      else if (e.clientY > window.innerHeight - edge) window.scrollBy(0, 12);
      if (slot !== d.slot) {
        dragRef.current = { ...d, slot };
        setDrag({ from: d.from, slot });
      }
    };
    const onUp = (e: globalThis.PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      dragRef.current = null;
      setDrag(null);
      const to = d.slot > d.from ? d.slot - 1 : d.slot;
      if (e.type === 'pointerup' && to !== d.from) {
        onMove(d.from, to);
        setAnnouncement(`${getLabel(items[d.from])} moved to position ${to + 1} of ${items.length}.`);
      }
    };
    window.addEventListener('pointermove', onMovePointer, { passive: false });
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMovePointer);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [drag, items, onMove, getLabel]);

  function move(from: number, to: number) {
    if (to < 0 || to >= items.length || to === from) return;
    onMove(from, to);
    setAnnouncement(`${getLabel(items[from])} moved to position ${to + 1} of ${items.length}.`);
    requestAnimationFrame(() => handles.current[to]?.focus());
  }

  return (
    <>
      <ul aria-label={ariaLabel} className={cn('flex flex-col', drag && 'select-none', className)}>
        {items.map((item, index) => {
          const label = getLabel(item);
          const sortable: SortableHandle = {
            dragging: drag?.from === index,
            handleProps: {
              role: 'button',
              tabIndex: 0,
              'aria-label': t('Reorder {label}. Position {index} of {count}.', { label, index: index + 1, count: items.length }),
              'aria-describedby': helpId,
              className:
                'flex h-9 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg active:cursor-grabbing',
              onPointerDown: (e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                dragRef.current = { from: index, slot: index, pointerId: e.pointerId };
                setDrag({ from: index, slot: index });
              },
              onKeyDown: (e) => {
                if (!(e.altKey || e.ctrlKey || e.metaKey)) return;
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  move(index, index - 1);
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  move(index, index + 1);
                }
              },
            },
            moveUp: (
              <MoveButton label={t('Move {label} up', { label })} disabled={index === 0} onClick={() => move(index, index - 1)}>
                <ArrowUp size={15} aria-hidden />
              </MoveButton>
            ),
            moveDown: (
              <MoveButton label={t('Move {label} down', { label })} disabled={index === items.length - 1} onClick={() => move(index, index + 1)}>
                <ArrowDown size={15} aria-hidden />
              </MoveButton>
            ),
          };
          const before = drag && drag.slot === index && drag.slot !== drag.from && drag.slot !== drag.from + 1;
          const after = drag && index === items.length - 1 && drag.slot === items.length && drag.from !== index;
          return (
            <li
              key={getKey(item)}
              ref={(el) => {
                rows.current[index] = el;
                handles.current[index] = el?.querySelector<HTMLElement>('[role="button"][aria-describedby]') ?? null;
              }}
              className={cn('relative', drag?.from === index && 'opacity-50')}
            >
              {before && <span aria-hidden className="absolute -top-[3px] right-0 left-0 z-10 h-[3px] rounded-full bg-accent" />}
              {renderItem(item, index, sortable)}
              {after && <span aria-hidden className="absolute right-0 -bottom-[3px] left-0 z-10 h-[3px] rounded-full bg-accent" />}
            </li>
          );
        })}
      </ul>
      <p id={helpId} className="sr-only">
        {t('Drag the handle, or press Alt plus the arrow keys, to reorder.')}
      </p>
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </>
  );
}

export function GripIcon() {
  return <GripVertical size={16} aria-hidden />;
}

function MoveButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="inline-flex size-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-surface-hover hover:text-fg disabled:pointer-events-none disabled:opacity-35"
    >
      {children}
    </button>
  );
}
