import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button, IconButton } from './Button';

/**
 * Modal dialog built on the native <dialog> element, which provides focus
 * trapping, Escape handling and inert background for free. Focus returns to
 * the previously focused element on close.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocus.current = document.activeElement as HTMLElement | null;
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
      returnFocus.current?.focus?.();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      aria-labelledby={titleId}
      className={cn(
        'm-auto w-[calc(100%-24px)] max-h-[calc(100dvh-32px)] overflow-hidden rounded-xl border border-line-strong bg-surface-raised p-0 text-fg shadow-popover backdrop:bg-overlay open:[animation:lk-pop-in_160ms_ease-out]',
        size === 'sm' ? 'max-w-sm' : size === 'lg' ? 'max-w-3xl' : 'max-w-lg',
        className,
      )}
    >
      {open && (
        <div className="flex max-h-[calc(100dvh-32px)] flex-col">
          <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <h2 id={titleId} className="text-[15px] font-semibold tracking-tight">
                {title}
              </h2>
              {description && <p className="mt-0.5 text-[13px] text-fg-muted">{description}</p>}
            </div>
            <IconButton icon={X} label="Close dialog" size="sm" onClick={onClose} />
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

/** Confirmation dialog for destructive actions. */
export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  children,
  confirmLabel = 'Delete',
  danger = true,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: ReactNode;
  children?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-fg-secondary">{children}</div>
    </Dialog>
  );
}
