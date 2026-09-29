import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Ellipsis, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HttpMethod } from '../lib/model';
import { statusTone, type StatusTone } from '../lib/response';

export const METHOD_COLOR: Record<HttpMethod, string> = {
  GET: 'text-success',
  POST: 'text-warning',
  PUT: 'text-accent-text',
  PATCH: 'text-[var(--lk-syn-function)]',
  DELETE: 'text-danger',
  HEAD: 'text-fg-muted',
  OPTIONS: 'text-fg-muted',
};

export function MethodLabel({ method, className }: { method: HttpMethod; className?: string }) {
  return (
    <span className={cn('inline-block w-[3.25rem] shrink-0 font-mono text-[11px] font-semibold tracking-tight', METHOD_COLOR[method], className)}>
      {method === 'OPTIONS' ? 'OPT' : method === 'DELETE' ? 'DEL' : method}
    </span>
  );
}

const TONE_CLASS: Record<StatusTone, string> = {
  info: 'bg-surface-hover text-fg-secondary',
  success: 'bg-success-soft text-success',
  redirect: 'bg-accent-soft text-accent-text',
  client: 'bg-warning-soft text-warning',
  server: 'bg-danger-soft text-danger',
};

export function StatusPill({ status, children, className }: { status: number; children?: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center rounded-md px-1.5 py-px font-mono text-[12px] font-semibold tabular-nums', TONE_CLASS[statusTone(status)], className)}>
      {children ?? status}
    </span>
  );
}

/** Underlined tab strip (tablist semantics, arrow keys). */
export function TabStrip<T extends string>({
  tabs,
  value,
  onChange,
  label,
  className,
}: {
  tabs: Array<{ id: T; label: ReactNode; badge?: ReactNode }>;
  value: T;
  onChange: (id: T) => void;
  label: string;
  className?: string;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const index = tabs.findIndex((t) => t.id === value);
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn('flex min-w-0 items-end gap-1 overflow-x-auto border-b border-line px-2', className)}
      onKeyDown={(e) => {
        const delta = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!delta) return;
        e.preventDefault();
        const next = (Math.max(index, 0) + delta + tabs.length) % tabs.length;
        onChange(tabs[next].id);
        refs.current[next]?.focus();
      }}
    >
      {tabs.map((tab, i) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn(
              '-mb-px inline-flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-[13px] font-medium whitespace-nowrap transition-colors',
              selected ? 'border-accent text-fg' : 'border-transparent text-fg-muted hover:text-fg',
            )}
          >
            {tab.label}
            {tab.badge !== undefined && tab.badge !== null && tab.badge !== 0 && (
              <span className="rounded bg-surface-hover px-1 text-[11px] tabular-nums text-fg-secondary">{tab.badge}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export interface MenuItem {
  label: string;
  icon?: LucideIcon;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** A small popover menu opened from an icon button. Closes on outside click, Escape and selection. */
export function RowMenu({ items, label, className }: { items: MenuItem[]; label: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div ref={root} className={cn('relative', className)}>
      <button
        ref={button}
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          setUp(window.innerHeight - rect.bottom < 40 + items.length * 34);
          setOpen((o) => !o);
        }}
        className="inline-flex size-7 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg"
      >
        <Ellipsis size={15} aria-hidden />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className={cn(
            'absolute right-0 z-30 min-w-44 rounded-lg border border-line-strong bg-surface-raised p-1 shadow-popover lk-anim-fade',
            up ? 'bottom-full mb-1' : 'top-full mt-1',
          )}
          onKeyDown={(e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
            const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
            buttons[(i + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
          }}
        >
          {items.map((item, i) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                autoFocus={i === 0}
                disabled={item.disabled}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  item.onSelect();
                }}
                className={cn(
                  'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] whitespace-nowrap disabled:opacity-50',
                  item.danger ? 'text-danger hover:bg-danger-soft' : 'text-fg hover:bg-surface-hover',
                )}
              >
                {Icon && <Icon size={14} aria-hidden className={item.danger ? undefined : 'text-fg-muted'} />}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Inline text input used for renaming; commits on Enter/blur, cancels on Escape. */
export function InlineRename({ value, onCommit, onCancel, label }: { value: string; onCommit: (v: string) => void; onCancel: () => void; label: string }) {
  const [text, setText] = useState(value);
  const done = useRef(false);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    const next = text.trim();
    if (commit && next && next !== value) onCommit(next);
    else onCancel();
  };
  return (
    <input
      autoFocus
      aria-label={label}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
      }}
      onBlur={() => finish(true)}
      className="lk-field h-7 min-w-0 flex-1 px-2 py-0 text-[13px]"
    />
  );
}
