import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { IconButton } from '@/components/ui/Button';

/** A left-side drawer built on <dialog> (focus trap, Escape and inert background for free). */
export function Drawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className="m-0 h-dvh max-h-dvh w-[88vw] max-w-sm border-r border-line-strong bg-surface p-0 text-fg shadow-popover backdrop:bg-overlay open:[animation:lk-slide-in-left_180ms_ease-out]"
    >
      {open && (
        <div className="flex h-full flex-col">
          <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <h2 id={titleId} className="text-[14px] font-semibold">
              {title}
            </h2>
            <IconButton icon={X} label="Close" size="sm" onClick={onClose} />
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        </div>
      )}
    </dialog>
  );
}
