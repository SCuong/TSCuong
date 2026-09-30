import { useId, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { Upload, type LucideIcon } from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { t } from '@/lib/i18n';

export interface FileDropProps {
  onFiles: (files: File[]) => void;
  /** Same syntax as <input accept>, e.g. "application/pdf,.pdf" or "image/*". */
  accept?: string;
  multiple?: boolean;
  title?: ReactNode;
  hint?: ReactNode;
  icon?: LucideIcon;
  compact?: boolean;
  className?: string;
  disabled?: boolean;
  /** Called with a human readable reason when dropped files are rejected. */
  onReject?: (reason: string) => void;
  maxSize?: number;
}

export function matchesAccept(file: File, accept?: string): boolean {
  if (!accept) return true;
  const rules = accept
    .split(',')
    .map((r) => r.trim().toLowerCase())
    .filter(Boolean);
  const name = file.name.toLowerCase();
  const type = (file.type || '').toLowerCase();
  return rules.some((rule) => {
    if (rule.startsWith('.')) return name.endsWith(rule);
    if (rule.endsWith('/*')) return type.startsWith(rule.slice(0, -1));
    return type === rule;
  });
}

/** Drag-and-drop + click-to-browse file picker. Also accepts paste of files. */
export function FileDrop({
  onFiles,
  accept,
  multiple,
  title,
  hint,
  icon: Icon = Upload,
  compact,
  className,
  disabled,
  onReject,
  maxSize,
}: FileDropProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);
  const id = useId();

  function handle(list: FileList | File[] | null) {
    if (!list || disabled) return;
    const files = Array.from(list);
    const accepted = files.filter((f) => matchesAccept(f, accept) && (!maxSize || f.size <= maxSize));
    const rejected = files.length - accepted.length;
    if (rejected > 0) {
      const tooBig = maxSize ? files.some((f) => f.size > maxSize) : false;
      const types = accept ? accept.replace(/,/g, ', ') : '';
      const reason = tooBig
        ? t('Some files are larger than {size} and were skipped.', { size: formatBytes(maxSize!) })
        : rejected === files.length
          ? types
            ? t('This file type is not supported here (expected {types}).', { types })
            : t('This file type is not supported here.')
          : types
            ? t('Some files are not supported here (expected {types}).', { types })
            : t('Some files are not supported here.');
      setRejection(reason);
      onReject?.(reason);
    } else {
      setRejection(null);
    }
    const chosen = multiple ? accepted : accepted.slice(0, 1);
    if (chosen.length > 0) onFiles(chosen);
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setOver(false);
    handle(event.dataTransfer.files);
  }

  return (
    <div className={className}>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        onPaste={(e) => handle(e.clipboardData.files)}
        className={cn(
          'group relative flex flex-col items-center justify-center rounded-xl border border-dashed text-center transition-colors duration-100',
          compact ? 'gap-1.5 px-4 py-5' : 'gap-3 px-6 py-10 sm:py-12',
          over ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface-sunken hover:border-accent-line hover:bg-surface-hover/50',
          disabled && 'pointer-events-none opacity-60',
        )}
      >
        <div
          className={cn(
            'flex items-center justify-center rounded-xl border border-line bg-surface-raised text-fg-secondary shadow-card',
            compact ? 'size-9' : 'size-12',
          )}
        >
          <Icon size={compact ? 17 : 21} aria-hidden />
        </div>
        <div>
          <p className={cn('font-medium text-fg', compact ? 'text-[13px]' : 'text-[15px]')}>
            {title ?? (multiple ? t('Drop files here') : t('Drop a file here'))}{' '}
            <span className="text-fg-muted">{t('or')}</span>{' '}
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="font-medium text-accent-text underline-offset-2 hover:underline"
              aria-describedby={`${id}-hint`}
            >
              {t('browse')}
            </button>
          </p>
          <p id={`${id}-hint`} className="mt-1 text-[12.5px] text-fg-muted">
            {hint ?? t('Files are processed on this device and never uploaded.')}
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            handle(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {rejection && (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {rejection}
        </p>
      )}
    </div>
  );
}
