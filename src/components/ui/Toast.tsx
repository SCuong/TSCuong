import { useSyncExternalStore } from 'react';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

type ToastTone = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  message: string;
  tone: ToastTone;
}

let toasts: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(message: string, tone: ToastTone = 'success', duration = 2600) {
  const id = ++seq;
  toasts = [...toasts.slice(-3), { id, message, tone }];
  emit();
  setTimeout(() => dismiss(id), duration);
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function Toaster() {
  const items = useSyncExternalStore(subscribe, () => toasts, () => toasts);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[100] flex flex-col items-center gap-2 p-4 sm:items-end"
    >
      {items.map((item) => {
        const Icon = item.tone === 'error' ? CircleAlert : item.tone === 'info' ? Info : CircleCheck;
        return (
          <div
            key={item.id}
            role={item.tone === 'error' ? 'alert' : 'status'}
            className="pointer-events-auto flex max-w-sm items-center gap-2.5 rounded-lg border border-line-strong bg-surface-raised py-2 pr-2 pl-3 text-[13px] text-fg shadow-popover [animation:lk-toast-in_160ms_ease-out]"
          >
            <Icon
              size={16}
              aria-hidden
              className={cn(item.tone === 'error' ? 'text-danger' : item.tone === 'info' ? 'text-accent-text' : 'text-success')}
            />
            <span className="min-w-0 flex-1">{item.message}</span>
            <button
              type="button"
              onClick={() => dismiss(item.id)}
              aria-label={t('Dismiss notification')}
              className="rounded p-1 text-fg-muted hover:bg-surface-hover hover:text-fg"
            >
              <X size={14} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
