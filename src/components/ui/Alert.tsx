import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

type Tone = 'info' | 'success' | 'warning' | 'danger';

const TONES: Record<Tone, { icon: LucideIcon; box: string; icon_: string }> = {
  info: { icon: Info, box: 'border-accent-line bg-accent-soft', icon_: 'text-accent-text' },
  success: { icon: CircleCheck, box: 'border-transparent bg-success-soft', icon_: 'text-success' },
  warning: { icon: TriangleAlert, box: 'border-transparent bg-warning-soft', icon_: 'text-warning' },
  danger: { icon: CircleAlert, box: 'border-transparent bg-danger-soft', icon_: 'text-danger' },
};

export function Alert({
  tone = 'info',
  title,
  children,
  className,
  action,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  const t = TONES[tone];
  const Icon = t.icon;
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn('flex gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] leading-relaxed', t.box, className)}
    >
      <Icon size={16} className={cn('mt-0.5 shrink-0', t.icon_)} aria-hidden />
      <div className="min-w-0 flex-1 text-fg">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn('break-words', title && 'mt-0.5 text-fg-secondary')}>{children}</div>}
      </div>
      {action && <div className="shrink-0 self-center">{action}</div>}
    </div>
  );
}

/** Inline error for tool output areas. Renders nothing when there is no error. */
export function ErrorMessage({ error, title, className }: { error: string | null | undefined; title?: string; className?: string }) {
  if (!error) return null;
  return (
    <Alert tone="danger" title={title} className={className}>
      {error}
    </Alert>
  );
}
