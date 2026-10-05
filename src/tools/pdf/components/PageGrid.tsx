import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Check, ChevronLeft, ChevronRight, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { PDFDocumentProxy } from '../lib/pdfjs';
import { Thumbnail } from './Thumbnail';
import { t } from '@/lib/i18n';

export interface GridItem {
  id: string;
  /** null renders a blank page. */
  doc: PDFDocumentProxy | null;
  pageIndex: number;
  /** Extra rotation shown on the thumbnail (degrees clockwise). */
  rotation?: number;
  label: string;
  sublabel?: string;
  /** Visual state: 'removed' dims the card and strikes it through. */
  state?: 'normal' | 'removed' | 'highlight';
}

/** Live-region text after a reorder; `to` is the new 0-based index. */
export function moveAnnouncement(label: string, to: number, count: number): string {
  return t('{label} moved to position {position} of {count}.', { label, position: to + 1, count });
}

export function arrayMove<T>(list: readonly T[], from: number, to: number): T[] {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item);
  return next;
}

interface PageGridProps {
  items: GridItem[];
  ariaLabel: string;
  /** Enables selection (click / Space toggles; Shift extends a range). */
  selected?: ReadonlySet<string>;
  onSelectionChange?: (next: Set<string>) => void;
  /** Enables reordering (drag, Alt/Ctrl+Arrow, move buttons). `to` is the final index. */
  onMove?: (from: number, to: number) => void;
  /** Extra per-card buttons shown under the thumbnail. */
  renderActions?: (item: GridItem, index: number) => ReactNode;
  /** Optional keyboard handler for a focused card (e.g. Delete, R). Return true if handled. */
  onCardKey?: (event: KeyboardEvent, item: GridItem, index: number) => boolean;
  thumbWidth?: number;
  className?: string;
}

interface DragState {
  from: number;
  slot: number;
  x: number;
  y: number;
  width: number;
}

/**
 * A responsive grid of page thumbnails with selection, roving keyboard focus,
 * pointer drag-to-reorder (mouse anywhere on the card, touch via the grip)
 * and accessible move buttons.
 */
export function PageGrid({
  items,
  ariaLabel,
  selected,
  onSelectionChange,
  onMove,
  renderActions,
  onCardKey,
  thumbWidth = 180,
  className,
}: PageGridProps) {
  const cards = useRef<Array<HTMLLIElement | null>>([]);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  const [focusIndex, setFocusIndex] = useState(0);
  const anchor = useRef<number | null>(null);
  const [drag, setDragState] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const setDrag = (next: DragState | null) => {
    dragRef.current = next;
    setDragState(next);
  };
  const pending = useRef<{ index: number; x: number; y: number; pointerId: number; el: HTMLElement } | null>(null);
  const suppressClick = useRef(false);
  const scrollTimer = useRef<number | undefined>(undefined);
  const pointer = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [announcement, setAnnouncement] = useState('');
  const selectable = Boolean(onSelectionChange && selected);
  const safeFocus = Math.min(focusIndex, Math.max(0, items.length - 1));

  useEffect(() => () => window.clearInterval(scrollTimer.current), []);

  const focusCard = useCallback((index: number) => {
    setFocusIndex(index);
    requestAnimationFrame(() => buttons.current[index]?.focus());
  }, []);

  /**
   * After an action that may remove the focused card (Delete key, a card's delete button),
   * move focus to the nearest remaining card instead of letting it fall back to <body>.
   */
  function keepFocusNear(index: number) {
    requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body) return;
      const list = buttons.current;
      for (let i = Math.min(index, list.length - 1); i >= 0; i--) {
        const button = list[i];
        if (button?.isConnected) {
          setFocusIndex(i);
          button.focus();
          return;
        }
      }
    });
  }

  /** Reorder and tell screen reader users where the page went (drag, keys and move buttons). */
  function move(from: number, to: number) {
    if (!onMove || to === from || to < 0 || to >= items.length) return;
    onMove(from, to);
    setAnnouncement(moveAnnouncement(items[from].label, to, items.length));
  }

  function toggle(index: number, shift: boolean) {
    if (!selectable) return;
    const next = new Set(selected);
    const item = items[index];
    if (shift && anchor.current !== null && anchor.current < items.length) {
      const [a, b] = [anchor.current, index].sort((x, y) => x - y);
      for (let i = a; i <= b; i++) next.add(items[i].id);
    } else {
      if (next.has(item.id)) next.delete(item.id);
      else next.add(item.id);
      anchor.current = index;
    }
    onSelectionChange!(next);
  }

  function columns(): number {
    const first = cards.current[0];
    if (!first) return 1;
    const top = first.offsetTop;
    let n = 0;
    for (const card of cards.current) {
      if (!card || card.offsetTop !== top) break;
      n++;
    }
    return Math.max(1, n);
  }

  function onKeyDown(event: KeyboardEvent, index: number) {
    if (onCardKey?.(event, items[index], index)) {
      keepFocusNear(index);
      return;
    }
    const cols = columns();
    const moveKeys: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -cols,
      ArrowDown: cols,
    };
    if (event.key in moveKeys) {
      event.preventDefault();
      const target = Math.max(0, Math.min(items.length - 1, index + moveKeys[event.key]));
      if (onMove && (event.altKey || event.ctrlKey || event.metaKey)) {
        if (target !== index) {
          move(index, target);
          focusCard(target);
        }
        return;
      }
      if (event.shiftKey && selectable) {
        const next = new Set(selected);
        next.add(items[target].id);
        next.add(items[index].id);
        onSelectionChange!(next);
      }
      focusCard(target);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusCard(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusCard(items.length - 1);
    } else if ((event.key === ' ' || event.key === 'Enter') && selectable) {
      event.preventDefault();
      toggle(index, event.shiftKey);
    } else if (selectable && event.key.toLowerCase() === 'a' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      onSelectionChange!(new Set(items.map((i) => i.id)));
    }
  }

  // ---- Pointer drag -------------------------------------------------------

  function slotAt(x: number, y: number): number {
    let best = items.length;
    let bestDist = Infinity;
    cards.current.forEach((card, i) => {
      if (!card) return;
      const r = card.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const d = Math.hypot(x - cx, (y - cy) * 1.5);
      if (d < bestDist) {
        bestDist = d;
        best = x > cx ? i + 1 : i;
      }
    });
    return best;
  }

  function onPointerDown(event: PointerEvent<HTMLElement>, index: number) {
    if (!onMove || event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('[data-card-action]')) return;
    const onHandle = Boolean(target.closest('[data-drag-handle]'));
    if (event.pointerType === 'touch' && !onHandle) return;
    pending.current = { index, x: event.clientX, y: event.clientY, pointerId: event.pointerId, el: event.currentTarget };
    if (onHandle) event.preventDefault();
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    pointer.current = { x: event.clientX, y: event.clientY };
    const p = pending.current;
    const current = dragRef.current;
    if (!current && p && event.pointerId === p.pointerId) {
      if (Math.hypot(event.clientX - p.x, event.clientY - p.y) < 6) return;
      try {
        p.el.setPointerCapture(p.pointerId);
      } catch {
        /* ignore */
      }
      const rect = cards.current[p.index]?.getBoundingClientRect();
      setDrag({ from: p.index, slot: slotAt(event.clientX, event.clientY), x: event.clientX, y: event.clientY, width: rect?.width ?? thumbWidth });
      startAutoScroll();
      return;
    }
    if (current) {
      event.preventDefault();
      setDrag({ ...current, x: event.clientX, y: event.clientY, slot: slotAt(event.clientX, event.clientY) });
    }
  }

  function startAutoScroll() {
    window.clearInterval(scrollTimer.current);
    scrollTimer.current = window.setInterval(() => {
      const { y } = pointer.current;
      const edge = 70;
      if (y < edge) window.scrollBy(0, -Math.ceil((edge - y) / 4));
      else if (y > window.innerHeight - edge) window.scrollBy(0, Math.ceil((y - (window.innerHeight - edge)) / 4));
    }, 16);
  }

  function endDrag(commit: boolean) {
    window.clearInterval(scrollTimer.current);
    const d = dragRef.current;
    pending.current = null;
    if (!d) return;
    setDrag(null);
    suppressClick.current = true;
    setTimeout(() => (suppressClick.current = false), 0);
    if (!commit || !onMove) return;
    const to = d.slot > d.from ? d.slot - 1 : d.slot;
    if (to !== d.from) {
      move(d.from, to);
      setFocusIndex(to);
    }
  }

  const dragItem = drag ? items[drag.from] : null;
  const interactive = selectable || Boolean(onMove);

  function cardLabel(item: GridItem): string {
    const rotation = item.rotation ? ', ' + t('rotated {degrees} degrees', { degrees: ((item.rotation % 360) + 360) % 360 }) : '';
    return `${item.label}${item.sublabel ? `, ${item.sublabel}` : ''}${rotation}${item.state === 'removed' ? ', ' + t('marked for removal') : ''}`;
  }

  function cardContent(item: GridItem, isSelected: boolean) {
    return (
      <>
        <Thumbnail
          doc={item.doc}
          pageIndex={item.pageIndex}
          rotation={item.rotation}
          width={thumbWidth}
          alt=""
          className={item.state === 'removed' ? 'opacity-35 grayscale' : undefined}
        />
        {item.state === 'removed' && (
          <span aria-hidden className="absolute inset-0 flex items-center justify-center">
            <span className="h-1 w-3/4 rotate-[-35deg] rounded-full bg-danger shadow-card" />
          </span>
        )}
        {selectable && (
          <span
            aria-hidden
            className={cn(
              'absolute top-2.5 left-2.5 flex size-5 items-center justify-center rounded-md border shadow-card',
              isSelected
                ? item.state === 'removed'
                  ? 'border-danger-solid bg-danger-solid text-white'
                  : 'border-accent bg-accent text-accent-contrast'
                : 'border-line-strong bg-surface-raised text-transparent',
            )}
          >
            <Check size={13} strokeWidth={3} />
          </span>
        )}
      </>
    );
  }

  return (
    <>
      <ul
        aria-label={ariaLabel}
        className={cn(
          'grid gap-2.5 sm:gap-3',
          // Reorderable cards also hold a grip and two move buttons: keep room for the page label on phones.
          onMove ? 'grid-cols-[repeat(auto-fill,minmax(140px,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(112px,1fr))]',
          'sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))]',
          drag && 'cursor-grabbing select-none',
          className,
        )}
      >
        {items.map((item, index) => {
          const isSelected = selectable && selected!.has(item.id);
          const showSlotBefore = drag && drag.slot === index && drag.slot !== drag.from && drag.slot !== drag.from + 1;
          const showSlotAfter =
            drag && index === items.length - 1 && drag.slot === items.length && drag.from !== items.length - 1;
          return (
            <li
              key={item.id}
              ref={(el) => {
                cards.current[index] = el;
              }}
              onPointerDown={(e) => onPointerDown(e, index)}
              onPointerMove={onPointerMove}
              onPointerUp={() => endDrag(true)}
              onPointerCancel={() => endDrag(false)}
              onLostPointerCapture={(event) => {
                // Touch starts with implicit capture on the grip's SVG. Moving capture to
                // the card emits a bubbling loss from that SVG; the card still owns the drag.
                if (event.target === event.currentTarget) endDrag(true);
              }}
              className={cn(
                'group relative flex min-w-0 flex-col rounded-xl border bg-surface p-1.5 shadow-card transition-[border-color,background-color,opacity] duration-100',
                isSelected
                  ? item.state === 'removed'
                    ? 'border-danger bg-danger-soft ring-1 ring-danger'
                    : 'border-accent bg-accent-soft ring-1 ring-accent'
                  : 'border-line hover:border-line-strong',
                item.state === 'highlight' && !isSelected && 'border-accent-line',
                drag?.from === index && 'opacity-30',
              )}
            >
              {(showSlotBefore || showSlotAfter) && (
                <span
                  aria-hidden
                  className={cn(
                    'absolute top-2 bottom-2 w-1 rounded-full bg-accent',
                    showSlotBefore ? '-left-[7px] sm:-left-[8px]' : '-right-[7px] sm:-right-[8px]',
                  )}
                />
              )}
              {interactive ? (
                <button
                  ref={(el) => {
                    buttons.current[index] = el;
                  }}
                  type="button"
                  tabIndex={index === safeFocus ? 0 : -1}
                  aria-pressed={selectable ? isSelected : undefined}
                  aria-label={cardLabel(item)}
                  onFocus={() => setFocusIndex(index)}
                  onKeyDown={(e) => onKeyDown(e, index)}
                  onClick={(e) => {
                    if (suppressClick.current) return;
                    setFocusIndex(index);
                    toggle(index, e.shiftKey);
                  }}
                  className={cn(
                    'relative block w-full cursor-pointer rounded-lg bg-surface-sunken p-1.5 outline-offset-2',
                    onMove && 'active:cursor-grabbing',
                  )}
                >
                  {cardContent(item, isSelected)}
                </button>
              ) : (
                // A preview only (nothing to select or move): an image with a description, not a button that does nothing.
                <div role="img" aria-label={cardLabel(item)} className="relative block w-full rounded-lg bg-surface-sunken p-1.5">
                  {cardContent(item, isSelected)}
                </div>
              )}
              <div className="flex min-h-8 items-center gap-1 px-0.5 pt-1">
                {onMove && (
                  <span
                    data-drag-handle
                    aria-hidden
                    className="-ml-0.5 flex h-7 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-fg-muted hover:text-fg"
                  >
                    <GripVertical size={14} />
                  </span>
                )}
                <div className="min-w-0 flex-1 leading-tight">
                  <p className="truncate text-[12.5px] font-medium text-fg">{item.label}</p>
                  {item.sublabel && <p className="truncate text-[11.5px] text-fg-muted">{item.sublabel}</p>}
                </div>
                {onMove && (
                  <div data-card-action className="-mr-1 flex shrink-0 items-center">
                    <CardButton
                      label={t('Move {label} earlier', { label: item.label })}
                      disabled={index === 0}
                      onClick={() => {
                        move(index, index - 1);
                        setFocusIndex(index - 1);
                      }}
                    >
                      <ChevronLeft size={15} aria-hidden />
                    </CardButton>
                    <CardButton
                      label={t('Move {label} later', { label: item.label })}
                      disabled={index === items.length - 1}
                      onClick={() => {
                        move(index, index + 1);
                        setFocusIndex(index + 1);
                      }}
                    >
                      <ChevronRight size={15} aria-hidden />
                    </CardButton>
                  </div>
                )}
              </div>
              {renderActions && (
                <div
                  data-card-action
                  className="flex flex-wrap items-center justify-center gap-0.5 border-t border-line pt-1"
                  onClickCapture={() => keepFocusNear(index)}
                >
                  {renderActions(item, index)}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {drag && dragItem && (
        <div
          aria-hidden
          className="pointer-events-none fixed z-[90] rounded-xl border border-accent bg-surface-raised p-1.5 opacity-95 shadow-popover"
          style={{ left: drag.x - drag.width / 2, top: drag.y - 40, width: drag.width }}
        >
          <Thumbnail doc={dragItem.doc} pageIndex={dragItem.pageIndex} rotation={dragItem.rotation} width={thumbWidth} />
          <p className="truncate px-1 pt-1 text-[12px] font-medium text-fg">{dragItem.label}</p>
        </div>
      )}
      {onMove && (
        <p className="sr-only" aria-live="polite">
          {drag ? t('Moving {label}. Release to drop.', { label: dragItem?.label }) : announcement}
        </p>
      )}
    </>
  );
}

export function CardButton({
  label,
  onClick,
  disabled,
  active,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  danger?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex size-7 items-center justify-center rounded-md transition-colors duration-100 disabled:pointer-events-none disabled:opacity-35',
        danger ? 'text-fg-muted hover:bg-danger-soft hover:text-danger' : 'text-fg-muted hover:bg-surface-hover hover:text-fg',
        active && (danger ? 'bg-danger-soft text-danger' : 'bg-accent-soft text-accent-text'),
      )}
    >
      {children}
    </button>
  );
}
