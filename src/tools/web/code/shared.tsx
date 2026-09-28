import { useEffect, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { cn, formatBytes } from '@/lib/utils';
import { sizeSavings } from '../lib/sizes';

export type AsyncResult<T> = { status: 'idle' } | { status: 'pending' } | { status: 'done'; value: T } | { status: 'error'; error: unknown };

/**
 * Runs an async transform whenever `key` changes, ignoring stale results.
 * `key` must capture every input of `run`; pass null to reset to idle.
 */
export function useAsyncResult<T>(key: string | null, run: () => Promise<T>): AsyncResult<T> {
  const [state, setState] = useState<{ key: string | null; result: AsyncResult<T> }>({ key: null, result: { status: 'idle' } });
  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    run().then(
      (value) => !cancelled && setState({ key, result: { status: 'done', value } }),
      (error: unknown) => !cancelled && setState({ key, result: { status: 'error', error } }),
    );
    return () => {
      cancelled = true;
    };
    // `key` captures the inputs of `run` by contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (key === null) return { status: 'idle' };
  if (state.key !== key) return { status: 'pending' };
  return state.result;
}

/** Original → minified sizes with the percentage saved. */
export function SizeSavingsBar({ before, after }: { before: string; after: string }) {
  const s = sizeSavings(before, after);
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
        {s.saved >= 0 ? `${formatBytes(s.saved)} saved` : `${formatBytes(-s.saved)} larger`}
      </span>
      <div className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-surface-hover" aria-hidden>
        <div className="h-full rounded-full bg-success" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
    </div>
  );
}
