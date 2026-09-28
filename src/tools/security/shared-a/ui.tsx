import { useEffect, useState, type ReactNode } from 'react';
import { Eye, EyeOff, File as FileIcon, X } from 'lucide-react';
import { IconButton } from '@/components/ui/Button';
import { CopyButton } from '@/components/ui/Actions';
import { Input } from '@/components/ui/Field';
import { cn, formatBytes, formatDuration } from '@/lib/utils';

/** A selected file with name, size and a remove button. */
export function FileChip({ file, onClear, disabled }: { file: File; onClear: () => void; disabled?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-xl border border-line bg-surface-sunken px-3 py-2.5">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-raised text-fg-secondary">
        <FileIcon size={17} aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium text-fg" title={file.name}>
          {file.name}
        </p>
        <p className="text-[12.5px] text-fg-muted tabular-nums">
          {formatBytes(file.size)}
          {file.type ? ` · ${file.type}` : ''}
        </p>
      </div>
      <IconButton icon={X} label="Remove file" size="sm" onClick={onClear} disabled={disabled} />
    </div>
  );
}

/** One labelled digest/value row with a copy button. Long values wrap. */
export function DigestRow({
  label,
  value,
  badge,
  highlight,
  stacked,
}: {
  label: ReactNode;
  value: string;
  badge?: ReactNode;
  highlight?: 'success' | 'danger';
  /** Keep the value under the label at every width (for narrow containers). */
  stacked?: boolean;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-[1fr_auto] items-start gap-x-3 gap-y-1 px-4 py-2.5',
        !stacked && 'sm:grid-cols-[150px_1fr_auto]',
        highlight === 'success' && 'bg-success-soft',
        highlight === 'danger' && 'bg-danger-soft',
      )}
    >
      <div className={cn('flex min-w-0 flex-wrap items-center gap-1.5 text-[13px] font-medium text-fg', stacked ? 'pt-1' : 'sm:pt-1')}>
        <span>{label}</span>
        {badge}
      </div>
      <code
        className={cn(
          'col-span-2 row-start-2 min-w-0 font-mono text-[12.5px] leading-relaxed break-all text-fg-secondary select-all',
          !stacked && 'sm:col-span-1 sm:row-start-1 sm:col-start-2 sm:pt-1',
        )}
      >
        {value}
      </code>
      <div className={cn('col-start-2 row-start-1', !stacked && 'sm:col-start-3')}>
        <CopyButton value={value} iconOnly label={`Copy ${typeof label === 'string' ? label : 'value'}`} />
      </div>
    </div>
  );
}

/** Password-style input with a show/hide toggle. */
export function SecretInput({
  id,
  value,
  onChange,
  placeholder,
  describedBy,
  invalid,
  mono,
  autoComplete = 'off',
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  describedBy?: string;
  invalid?: boolean;
  mono?: boolean;
  autoComplete?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-describedby={describedBy}
        aria-invalid={invalid || undefined}
        autoComplete={autoComplete}
        spellCheck={false}
        mono={mono}
        className="pr-10"
      />
      <IconButton
        icon={visible ? EyeOff : Eye}
        label={visible ? 'Hide' : 'Show'}
        size="sm"
        onClick={() => setVisible((v) => !v)}
        className="absolute top-1/2 right-1 -translate-y-1/2"
      />
    </div>
  );
}

/** Ticking elapsed-time readout while `running` is true. */
export function useElapsed(running: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!running) return;
    const start = performance.now();
    setElapsed(0);
    const id = setInterval(() => setElapsed(performance.now() - start), 100);
    return () => clearInterval(id);
  }, [running]);
  return elapsed;
}

export function ElapsedLabel({ ms, estimate }: { ms: number; estimate?: number }) {
  return (
    <span className="tabular-nums">
      {formatDuration(ms)}
      {estimate !== undefined && <span className="text-fg-muted"> / ~{formatDuration(estimate)} expected</span>}
    </span>
  );
}
