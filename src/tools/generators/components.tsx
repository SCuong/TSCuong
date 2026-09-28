import type { ReactNode } from 'react';
import { CopyButton, DownloadButton } from '@/components/ui/Actions';
import { Textarea } from '@/components/ui/Field';
import { cn, formatBytes, formatNumber } from '@/lib/utils';

/** Characters rendered in the output box; larger outputs are still copied/downloaded in full. */
export const DISPLAY_LIMIT = 250_000;

/**
 * Read-only output area with copy + download of the FULL text, even when the
 * on-screen preview is truncated to keep huge outputs responsive.
 */
export function OutputPanel({
  title,
  text,
  filename,
  mime = 'text/plain;charset=utf-8',
  footer,
  actions,
  height = '320px',
  className,
  mono = true,
  emptyText = 'Nothing generated yet.',
}: {
  title: ReactNode;
  text: string;
  filename: string;
  mime?: string;
  footer?: ReactNode;
  actions?: ReactNode;
  height?: string;
  className?: string;
  mono?: boolean;
  emptyText?: string;
}) {
  const truncated = text.length > DISPLAY_LIMIT;
  const shown = truncated ? `${text.slice(0, DISPLAY_LIMIT)}\n…` : text;
  return (
    <section className={cn('flex min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card', className)}>
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-line py-1.5 pr-2 pl-4">
        <h2 className="text-[13px] font-semibold tracking-tight text-fg">{title}</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          {actions}
          <CopyButton value={text} label="Copy all" />
          <DownloadButton data={text} filename={filename} type={mime} />
        </div>
      </header>
      <div className="p-2" style={{ height }}>
        <Textarea
          value={shown}
          readOnly
          mono={mono}
          placeholder={emptyText}
          aria-label={typeof title === 'string' ? title : 'Output'}
          className={cn('h-full resize-none', !mono && 'text-[14px] leading-relaxed')}
        />
      </div>
      <footer className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-1.5 text-[12.5px] text-fg-muted">
        {footer}
        {text && <span className="tabular-nums">{formatBytes(new Blob([text]).size)}</span>}
        {truncated && (
          <span className="text-warning">
            Showing the first {formatNumber(DISPLAY_LIMIT, 0)} characters. Copy or download for the full output.
          </span>
        )}
      </footer>
    </section>
  );
}

/** Clamp a NumberInput value (number | '') into an integer range, with a fallback for empty input. */
export function clampInt(value: number | '', min: number, max: number, fallback = min): number {
  if (value === '' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/** Label above a control, sized for toolbars. */
export function ToolField({ label, htmlFor, children, className }: { label: string; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium text-fg-secondary">
        {label}
      </label>
      {children}
    </div>
  );
}
