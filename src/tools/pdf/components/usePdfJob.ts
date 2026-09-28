import { useCallback, useState } from 'react';
import { useAsyncJob } from '@/lib/hooks';
import { toPdfError } from '../lib/errors';

type JobFn<R> = (ctx: { signal: AbortSignal; progress: (fraction: number | null, label?: string) => void }) => Promise<R>;

/**
 * useAsyncJob plus friendly error handling for PDF work. `run` resolves to
 * undefined when the job fails or is cancelled (the error is kept in `error`).
 */
export function usePdfJob() {
  const job = useAsyncJob();
  const [error, setError] = useState<string | null>(null);
  const { run: runJob } = job;

  const run = useCallback(
    async <R>(fn: JobFn<R>): Promise<R | undefined> => {
      setError(null);
      try {
        return await runJob(fn);
      } catch (e) {
        const pe = toPdfError(e);
        if (pe.kind !== 'cancelled') setError(pe.message);
        return undefined;
      }
    },
    [runJob],
  );

  return { running: job.running, progress: job.progress, label: job.label, cancel: job.cancel, run, error, setError };
}
