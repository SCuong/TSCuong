import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronDown, type LucideIcon } from 'lucide-react';
import { Button, type ButtonSize, type ButtonVariant } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

export interface MenuItem {
  label: ReactNode;
  onSelect: () => void;
  icon?: LucideIcon;
  disabled?: boolean;
  hint?: ReactNode;
}

/** A small dropdown action menu (button + popover list) with keyboard support. */
export function Menu({
  label,
  icon,
  items,
  size = 'sm',
  variant = 'secondary',
  align = 'end',
  disabled,
  className,
}: {
  label: ReactNode;
  icon?: LucideIcon;
  items: MenuItem[];
  size?: ButtonSize;
  variant?: ButtonVariant;
  align?: 'start' | 'end';
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    const first = itemRefs.current.find((b) => b && !b.disabled);
    first?.focus();
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  function onKeyDown(e: KeyboardEvent) {
    if (!open) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      root.current?.querySelector<HTMLButtonElement>('button')?.focus();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const enabled = itemRefs.current.filter((b): b is HTMLButtonElement => Boolean(b && !b.disabled));
      const idx = enabled.indexOf(document.activeElement as HTMLButtonElement);
      const next = (idx + (e.key === 'ArrowDown' ? 1 : -1) + enabled.length) % enabled.length;
      enabled[next]?.focus();
    }
  }

  return (
    <div ref={root} className={cn('relative inline-block', className)} onKeyDown={onKeyDown}>
      <Button
        size={size}
        variant={variant}
        icon={icon}
        iconRight={ChevronDown}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </Button>
      {open && (
        <div
          id={menuId}
          role="menu"
          className={cn(
            'absolute top-full z-30 mt-1 min-w-48 overflow-hidden rounded-lg border border-line-strong bg-surface-raised p-1 shadow-popover lk-anim-pop',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item, i) => {
            const Icon = item.icon;
            return (
              <button
                key={i}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] text-fg hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none disabled:opacity-50"
              >
                {Icon && <Icon size={14} className="shrink-0 text-fg-muted" aria-hidden />}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.hint && <span className="text-[11.5px] text-fg-muted">{item.hint}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
