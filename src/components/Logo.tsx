import { cn } from '@/lib/utils';

/** LocalKit mark: a key-cap grid with one lit cell. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('size-7', className)} aria-hidden>
      <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--lk-text-primary)" />
      <rect x="7" y="7" width="8" height="8" rx="2" fill="var(--lk-bg)" />
      <rect x="17" y="7" width="8" height="8" rx="2" fill="var(--lk-bg)" opacity="0.55" />
      <rect x="7" y="17" width="8" height="8" rx="2" fill="var(--lk-bg)" opacity="0.55" />
      <rect x="17" y="17" width="8" height="8" rx="2" fill="#f5a524" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      <span className="text-[15px] font-semibold tracking-tight text-fg">LocalKit</span>
    </span>
  );
}
