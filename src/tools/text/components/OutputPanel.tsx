import type { ReactNode } from 'react';
import { EditorPanel } from '@/components/tool/EditorPanel';
import { CopyButton, DownloadButton } from '@/components/ui/Actions';
import { Textarea } from '@/components/ui/Field';
import { Spinner } from '@/components/ui/Feedback';
import { cn, formatNumber } from '@/lib/utils';
import { t } from '@/lib/i18n';

/** Longest output shown in full; a text area with tens of megabytes makes the page crawl. */
export const OUTPUT_PREVIEW_LIMIT = 1_000_000;

export interface OutputPanelProps {
  title: ReactNode;
  value: string;
  placeholder?: string;
  downloadName?: string;
  downloadType?: string;
  height?: string;
  lineWrapping?: boolean;
  invalid?: boolean;
  footer?: ReactNode;
  /** Shows a spinner while a newer result is being computed. */
  busy?: boolean;
  ariaLabel?: string;
}

/**
 * Read-only result panel. Behaves like EditorPanel, but a very large value is shown as a
 * preview of its first characters while Copy and Save still use the complete text.
 */
export function OutputPanel({
  title,
  value,
  placeholder,
  downloadName,
  downloadType,
  height = '360px',
  lineWrapping = true,
  invalid,
  footer,
  busy,
  ariaLabel,
}: OutputPanelProps) {
  const spinner = busy ? <Spinner size={14} label={t('Updating…')} /> : null;
  const label = ariaLabel ?? (typeof title === 'string' ? title : t('Result'));
  if (value.length <= OUTPUT_PREVIEW_LIMIT) {
    return (
      <EditorPanel
        title={title}
        value={value}
        placeholder={placeholder}
        downloadName={downloadName}
        downloadType={downloadType}
        height={height}
        lineWrapping={lineWrapping}
        invalid={invalid}
        footer={footer}
        actions={spinner}
        ariaLabel={label}
      />
    );
  }
  return (
    <section className={cn('flex min-w-0 flex-col rounded-xl border bg-surface shadow-card', invalid ? 'border-danger/60' : 'border-line')}>
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-line py-1.5 pr-2 pl-4">
        <h2 className="text-[13px] font-semibold tracking-tight text-fg">{title}</h2>
        <div className="flex flex-wrap items-center gap-1">
          {spinner}
          {downloadName && <DownloadButton data={value} filename={downloadName} type={downloadType} label={t('Save')} variant="ghost" />}
          <CopyButton value={value} iconOnly />
        </div>
      </header>
      <div className="min-h-0 p-2" style={{ height }}>
        <Textarea
          value={value.slice(0, OUTPUT_PREVIEW_LIMIT)}
          readOnly
          aria-label={label}
          className={cn('h-full resize-none', !lineWrapping && 'whitespace-pre')}
          wrap={lineWrapping ? 'soft' : 'off'}
        />
      </div>
      <footer className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-1.5 text-[12.5px] text-fg-muted">
        {footer}
        <span>
          {t('Showing the first {OUTPUT_PREVIEW_LIMIT} of {count} characters. Copy and Save include everything.', { OUTPUT_PREVIEW_LIMIT: formatNumber(OUTPUT_PREVIEW_LIMIT, 0), count: formatNumber(value.length, 0) })}
        </span>
      </footer>
    </section>
  );
}
