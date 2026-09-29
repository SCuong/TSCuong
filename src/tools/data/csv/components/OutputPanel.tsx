import { useMemo, type ReactNode } from 'react';
import { EditorPanel } from '@/components/tool/EditorPanel';
import type { EditorLanguage } from '@/components/editor/languages';
import { CopyButton, DownloadButton } from '@/components/ui/Actions';
import { Textarea } from '@/components/ui/Field';
import { formatBytes } from '@/lib/utils';

/** Above this size the output is not loaded into an editor; a preview is shown and copy/download use the full text. */
export const PREVIEW_LIMIT = 1_500_000;
const PREVIEW_LINES = 1000;

function previewOf(text: string): { text: string; lines: number } {
  let end = 0;
  let lines = 0;
  while (lines < PREVIEW_LINES && end < PREVIEW_LIMIT) {
    const next = text.indexOf('\n', end);
    if (next === -1) {
      end = text.length;
      break;
    }
    end = next + 1;
    lines++;
  }
  return { text: text.slice(0, Math.min(end, PREVIEW_LIMIT)), lines };
}

/**
 * A read-only output panel. Normal outputs use the shared EditorPanel; very
 * large outputs show a lightweight preview so the page stays responsive, while
 * Save and Copy still act on the complete text.
 */
export function OutputPanel({
  title,
  value,
  language,
  downloadName,
  downloadType,
  placeholder,
  height = '480px',
  lineWrapping = false,
  footer,
  actions,
  bytes,
}: {
  title: ReactNode;
  value: string;
  language?: EditorLanguage;
  downloadName: string;
  downloadType: string;
  placeholder?: string;
  height?: string;
  lineWrapping?: boolean;
  footer?: ReactNode;
  actions?: ReactNode;
  /** Byte size of `value`, if already known. */
  bytes?: number;
}) {
  const large = value.length > PREVIEW_LIMIT;
  const preview = useMemo(() => (large ? previewOf(value) : null), [large, value]);

  if (!preview) {
    return (
      <EditorPanel
        title={title}
        value={value}
        language={language}
        actions={actions}
        downloadName={downloadName}
        downloadType={downloadType}
        placeholder={placeholder}
        height={height}
        lineWrapping={lineWrapping}
        footer={footer}
      />
    );
  }

  return (
    <section className="flex min-w-0 flex-col rounded-xl border border-line bg-surface shadow-card">
      <header className="flex min-h-11 flex-wrap items-center justify-between gap-2 border-b border-line py-1.5 pr-2 pl-4">
        <h2 className="text-[13px] font-semibold tracking-tight text-fg">{title}</h2>
        <div className="flex flex-wrap items-center gap-1">
          {actions}
          <DownloadButton data={value} filename={downloadName} type={downloadType} label="Save" variant="ghost" />
          <CopyButton value={value} iconOnly />
        </div>
      </header>
      <p className="border-b border-line bg-accent-soft px-4 py-2 text-[12.5px] text-fg-secondary">
        The result is {formatBytes(bytes ?? new Blob([value]).size)}, so only the beginning is shown here. Save and Copy use the complete
        output.
      </p>
      <div className="min-h-0 p-2" style={{ height }}>
        <Textarea
          value={preview.text}
          readOnly
          aria-label="Output preview"
          className="h-full resize-none whitespace-pre"
          wrap={lineWrapping ? 'soft' : 'off'}
        />
      </div>
      {footer && (
        <footer className="flex min-h-9 flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-1.5 text-[12.5px] text-fg-muted">
          {footer}
        </footer>
      )}
    </section>
  );
}
