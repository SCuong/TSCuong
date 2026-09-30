import { useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Feedback';
import { cn, formatBytes } from '@/lib/utils';
import { byteLength, sizeSavings } from '../lib/sizes';
import type { CodeJobState, CodeOutcome } from './codeRunner';
import { t } from '@/lib/i18n';

/** The outcome to display: the current one, or the previous one while a new job runs. */
export function settledOutcome<T>(state: CodeJobState<T>, previous: CodeOutcome<T> | null): CodeOutcome<T> | null {
  if (state.status === 'idle') return null;
  if (state.status === 'pending') return previous?.status === 'cancelled' ? null : previous;
  return state;
}

/** Footer content for a running or stopped worker job. Returns null when there is nothing to say. */
export function JobStatus({ status, busyLabel, onCancel }: { status: CodeJobState<unknown>['status']; busyLabel: string; onCancel: () => void }) {
  if (status === 'pending') {
    return (
      <span className="flex items-center gap-2">
        <Spinner size={13} label={busyLabel} />
        <Button size="sm" variant="ghost" onClick={onCancel} className="h-7">
          {t('Cancel')}
        </Button>
      </span>
    );
  }
  if (status === 'cancelled') return <span role="status">{t('Stopped. Edit the input or change an option to run it again.')}</span>;
  return null;
}

/** UTF-8 size of a text, memoized (inputs can be megabytes). */
export function useByteSize(text: string): number {
  return useMemo(() => byteLength(text), [text]);
}

/** Original → minified sizes with the percentage saved. */
export function SizeSavingsBar({ before, after }: { before: string; after: string }) {
  const s = useMemo(() => sizeSavings(before, after), [before, after]);
  const pct = s.ratio * 100;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-line bg-surface px-4 py-3 shadow-card">
      <div className="flex items-center gap-2 font-mono text-[14px] tabular-nums">
        <span className="text-fg-secondary">{formatBytes(s.before)}</span>
        <ArrowRight size={14} className="text-fg-muted" aria-hidden />
        <span className="font-semibold text-fg">{formatBytes(s.after)}</span>
      </div>
      <span
        className={cn(
          'rounded-md px-2 py-0.5 text-[13px] font-semibold tabular-nums',
          s.saved > 0 ? 'bg-success-soft text-success' : 'bg-surface-hover text-fg-secondary',
        )}
      >
        {s.saved >= 0 ? `−${pct.toFixed(1)}%` : `+${Math.abs(pct).toFixed(1)}%`}
      </span>
      <span className="text-[13px] text-fg-muted">
        {s.saved >= 0 ? t('{size} saved', { size: formatBytes(s.saved) }) : t('{size} larger', { size: formatBytes(-s.saved) })}
      </span>
      <div className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-surface-hover" aria-hidden>
        <div className="h-full rounded-full bg-success" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
    </div>
  );
}
