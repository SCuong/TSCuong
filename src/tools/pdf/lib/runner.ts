/**
 * Runs pdf-lib operations in a dedicated Web Worker (one worker per job, so a
 * cancel can simply terminate it). Falls back to the main thread only when a
 * worker cannot be created (very old browsers, strict CSP).
 */
import { PdfError, deserializeError, toPdfError } from './errors';
import type { OpArgs, OpName, OpResult } from './ops';
import type { WorkerRequest, WorkerResponse } from './protocol';

export interface RunOptions {
  signal?: AbortSignal;
  onProgress?: (fraction: number, label?: string) => void;
}

let workersBroken = false;

function cancelled() {
  return new PdfError('cancelled', 'The operation was cancelled.');
}

function createWorker(): Worker | null {
  if (workersBroken || typeof Worker === 'undefined') return null;
  try {
    return new Worker(new URL('./pdf.worker.ts', import.meta.url), { type: 'module', name: 'localkit-pdf' });
  } catch {
    workersBroken = true;
    return null;
  }
}

export async function runPdfOp<K extends OpName>(op: K, args: OpArgs<K>, options: RunOptions = {}): Promise<OpResult<K>> {
  const { signal, onProgress } = options;
  if (signal?.aborted) throw cancelled();
  const worker = createWorker();
  if (!worker) return runOnMainThread(op, args, options);

  return new Promise<OpResult<K>>((resolve, reject) => {
    let settled = false;
    let heardFromWorker = false;
    const finish = () => {
      settled = true;
      worker.terminate();
      signal?.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      if (settled) return;
      finish();
      reject(cancelled());
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      heardFromWorker = true;
      const msg = event.data;
      if (msg.type === 'progress') {
        if (!settled) onProgress?.(msg.value, msg.label);
      } else if (msg.type === 'result') {
        finish();
        resolve(msg.result as OpResult<K>);
      } else {
        finish();
        reject(deserializeError(msg.error));
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      if (settled) return;
      finish();
      if (!heardFromWorker && !event.message) {
        // The worker script failed to load: remember it and use the main thread.
        workersBroken = true;
        runOnMainThread(op, args, options).then(resolve, reject);
      } else {
        reject(toPdfError(event.message || 'The PDF worker crashed (the file may be too large for this browser).'));
      }
    };
    worker.onmessageerror = () => {
      if (settled) return;
      finish();
      reject(new PdfError('unknown', 'The PDF worker returned data that could not be read.'));
    };
    const request: WorkerRequest<K> = { op, args };
    try {
      worker.postMessage(request);
    } catch (error) {
      finish();
      reject(toPdfError(error));
    }
  });
}

async function runOnMainThread<K extends OpName>(op: K, args: OpArgs<K>, options: RunOptions): Promise<OpResult<K>> {
  const { OPS } = await import('./ops');
  const fn = OPS[op] as unknown as (a: OpArgs<K>, ctx: unknown) => Promise<OpResult<K>>;
  try {
    return await fn(args, {
      progress: (value: number, label?: string) => options.onProgress?.(value, label),
      checkCancelled: () => {
        if (options.signal?.aborted) throw cancelled();
      },
    });
  } catch (error) {
    throw toPdfError(error);
  }
}
