import type { ProtectionJob } from './protectionOptions';
export { passwordValid } from './protectionOptions';
export function runProtection(job: ProtectionJob, signal: AbortSignal, progress: (fraction: number | null) => void) {
  return new Promise<Uint8Array>((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
    const worker = new Worker(new URL('./protection.worker.ts', import.meta.url), { type: 'module', name: 'localkit-pdf-protection' });
    const cancel = () => { finish(); reject(new DOMException('Cancelled', 'AbortError')); };
    signal.addEventListener('abort', cancel, { once: true });
    const finish = () => { signal.removeEventListener('abort', cancel); worker.onmessage = null; worker.onerror = null; worker.terminate(); };
    worker.onmessage = (event: MessageEvent<{ bytes?: Uint8Array; progress?: number | null; error?: boolean }>) => {
      if ('progress' in event.data) progress(event.data.progress ?? null);
      else if (event.data.bytes) { finish(); resolve(event.data.bytes); }
      else { finish(); reject(new Error('The protected PDF could not be processed. Check the password and choose a valid PDF.')); }
    };
    worker.onerror = () => { finish(); reject(new Error('The local PDF protection engine could not start. Reload LocalKit and try again.')); };
    // Copy, because worker transfer must never detach the reader's original bytes.
    const bytes = job.bytes.slice();
    worker.postMessage({ ...job, bytes }, [bytes.buffer]);
  });
}
