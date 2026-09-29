import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, CircleX, Info, TriangleAlert, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { prettyJson, tokenizeJson, type JsonTokenKind } from './jsonTokens';

const JSON_COLORS: Record<JsonTokenKind, string> = {
  key: 'text-[var(--lk-syn-property)]',
  string: 'text-[var(--lk-syn-string)]',
  number: 'text-[var(--lk-syn-number)]',
  literal: 'text-[var(--lk-syn-keyword)]',
  punct: 'text-fg-muted',
};

/** Read-only, syntax-coloured JSON. Long values wrap instead of overflowing. */
export function JsonView({ value, className }: { value: unknown; className?: string }) {
  const tokens = useMemo(() => tokenizeJson(prettyJson(value)), [value]);
  return (
    <pre
      className={cn(
        'min-w-0 rounded-lg border border-line bg-surface-sunken px-3 py-2.5 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]',
        className,
      )}
    >
      {tokens.map((t, i) => (
        <span key={i} className={JSON_COLORS[t.kind]}>
          {t.text}
        </span>
      ))}
    </pre>
  );
}

/** Current time (ms), refreshed every `intervalMs` while `enabled`. */
export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, enabled]);
  return now;
}

export type StatusTone = 'success' | 'danger' | 'warning' | 'neutral';

const TONE_STYLES: Record<StatusTone, { box: string; text: string; icon: LucideIcon }> = {
  success: { box: 'bg-success-soft border-transparent', text: 'text-success', icon: CircleCheck },
  danger: { box: 'bg-danger-soft border-transparent', text: 'text-danger', icon: CircleX },
  warning: { box: 'bg-warning-soft border-transparent', text: 'text-warning', icon: TriangleAlert },
  neutral: { box: 'bg-surface-sunken border-line', text: 'text-fg-secondary', icon: Info },
};

/** Prominent result box (e.g. "Signature verified"). */
export function StatusBanner({
  tone,
  title,
  children,
  icon,
  className,
}: {
  tone: StatusTone;
  title: ReactNode;
  children?: ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  const style = TONE_STYLES[tone];
  const Icon = icon ?? style.icon;
  return (
    <div role="status" className={cn('flex items-start gap-3 rounded-lg border px-4 py-3', style.box, className)}>
      <Icon size={20} className={cn('mt-0.5 shrink-0', style.text)} aria-hidden />
      <div className="min-w-0">
        <p className={cn('text-[14.5px] font-semibold', style.text)}>{title}</p>
        {children && <div className="mt-0.5 text-[13px] leading-relaxed break-words text-fg-secondary">{children}</div>}
      </div>
    </div>
  );
}

export interface IssueItem {
  level: 'danger' | 'warning' | 'info';
  message: string;
}

const ISSUE_ICONS = {
  danger: { icon: CircleAlert, className: 'text-danger' },
  warning: { icon: TriangleAlert, className: 'text-warning' },
  info: { icon: Info, className: 'text-accent-text' },
} as const;

/** Compact list of findings, most severe first. */
export function IssueList({ issues, className }: { issues: IssueItem[]; className?: string }) {
  if (issues.length === 0) return null;
  return (
    <ul className={cn('flex flex-col gap-2', className)}>
      {issues.map((issue, i) => {
        const { icon: Icon, className: iconClass } = ISSUE_ICONS[issue.level];
        return (
          <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-fg">
            <Icon size={15} className={cn('mt-[3px] shrink-0', iconClass)} aria-hidden />
            <span className="min-w-0 break-words">
              <span className="sr-only">{issue.level === 'danger' ? 'Danger: ' : issue.level === 'warning' ? 'Warning: ' : 'Note: '}</span>
              {issue.message}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Small coloured dot + label, used for legends. */
export function LegendDot({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] text-fg-secondary">
      <span className={cn('size-2 shrink-0 rounded-full bg-current', className)} aria-hidden />
      <span className="text-fg-secondary">{children}</span>
    </span>
  );
}
