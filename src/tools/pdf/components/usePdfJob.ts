import { useCallback, useState } from 'react';
import { useAsyncJob } from '@/lib/hooks';
import { toPdfError } from '../lib/errors';
import { t } from '@/lib/i18n';
import { pdfProgressText } from '../lib/progressText';
import { usePdfWorkspace } from './PdfWorkspaceContext';

type JobFn<R> = (ctx: { signal: AbortSignal; progress: (fraction: number | null, label?: string) => void }) => Promise<R>;

/**
 * useAsyncJob plus friendly error handling for PDF work. `run` resolves to
 * undefined when the job fails or is cancelled (the error is kept in `error`).
 */
export function usePdfJob() {
  const job = useAsyncJob();
  const mobile = Boolean(usePdfWorkspace());
  const [error, setError] = useState<string | null>(null);
  const { run: runJob } = job;

  const run = useCallback(
    async <R>(fn: JobFn<R>): Promise<R | undefined> => {
      setError(null);
      try {
        return await runJob(fn);
      } catch (e) {
        const pe = toPdfError(e);
        if (pe.kind !== 'cancelled') setError(mobile && pe.kind === 'memory' ? t('This document exceeded available memory. Try fewer pages or split it into smaller PDFs.') : mobile && pe.kind === 'font' ? t('The built-in PDF font cannot draw this text. Use a PNG image watermark for Vietnamese or other Unicode text.') : mobile ? t(pe.message) : pe.message);
        return undefined;
      }
    },
    [runJob, mobile],
  );

  return { running: job.running, progress: job.progress, label: mobile ? pdfProgressText(job.label) : job.label, cancel: job.cancel, run, error, setError };
}
