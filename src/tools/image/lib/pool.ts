/**
 * Runs image jobs in a small pool of Web Workers (OffscreenCanvas) with a
 * transparent main-thread fallback, plus a generic cancellable batch runner.
 */
import { processImage, type ImageJob, type JobResult } from './pipeline';
import type { WorkerRequest, WorkerResponse } from './image.worker';
import type { OutputFormat } from './canvas';
import type { ImageFormat } from './formats';

function workersSupported(): boolean {
  try {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return false;
    if (typeof OffscreenCanvas.prototype.convertToBlob !== 'function') return false;
    return Boolean(new OffscreenCanvas(1, 1).getContext('2d'));
  } catch {
    return false;
  }
}

const abortError = () => new DOMException('Aborted', 'AbortError');

interface Slot {
  worker: Worker;
  busy: boolean;
}

export class ImagePool {
  private slots: Slot[] = [];
  private queue: Array<() => void> = [];
  private seq = 0;
  readonly useWorkers: boolean;

  constructor(private size = 2) {
    this.useWorkers = workersSupported();
  }

  private spawn(): Slot {
    const worker = new Worker(new URL('./image.worker.ts', import.meta.url), { type: 'module' });
    const slot = { worker, busy: false };
    this.slots.push(slot);
    return slot;
  }

  private acquire(): Promise<Slot> {
    return new Promise((resolve) => {
      const tryTake = () => {
        let slot = this.slots.find((s) => !s.busy);
        if (!slot && this.slots.length < this.size) slot = this.spawn();
        if (slot) {
          slot.busy = true;
          resolve(slot);
          return true;
        }
        return false;
      };
      const retry = () => {
        if (!tryTake()) this.queue.unshift(retry);
      };
      if (!tryTake()) this.queue.push(retry);
    });
  }

  private release(slot: Slot) {
    slot.busy = false;
    const next = this.queue.shift();
    next?.();
  }

  private replace(slot: Slot) {
    slot.worker.terminate();
    this.slots = this.slots.filter((s) => s !== slot);
    const next = this.queue.shift();
    next?.();
  }

  async run(file: Blob, job: ImageJob, signal?: AbortSignal): Promise<JobResult> {
    if (signal?.aborted) throw abortError();
    if (!this.useWorkers) return processImage(file, job);
    const slot = await this.acquire();
    if (signal?.aborted) {
      this.release(slot);
      throw abortError();
    }
    const id = ++this.seq;
    const response = await new Promise<WorkerResponse | 'aborted' | 'crashed'>((resolve) => {
      const onMessage = (e: MessageEvent<WorkerResponse>) => {
        if (e.data.id !== id) return;
        cleanup();
        resolve(e.data);
      };
      const onError = () => {
        cleanup();
        resolve('crashed');
      };
      const onAbort = () => {
        cleanup();
        resolve('aborted');
      };
      const cleanup = () => {
        slot.worker.removeEventListener('message', onMessage);
        slot.worker.removeEventListener('error', onError);
        signal?.removeEventListener('abort', onAbort);
      };
      slot.worker.addEventListener('message', onMessage);
      slot.worker.addEventListener('error', onError);
      signal?.addEventListener('abort', onAbort);
      const req: WorkerRequest = { id, file, job };
      slot.worker.postMessage(req);
    });
    if (response === 'aborted') {
      this.replace(slot);
      throw abortError();
    }
    if (response === 'crashed') {
      this.replace(slot);
      return processImage(file, job);
    }
    this.release(slot);
    if (response.ok) {
      return {
        blob: response.blob,
        width: response.width,
        height: response.height,
        format: response.format as OutputFormat,
        sourceFormat: response.sourceFormat as ImageFormat,
        sourceWidth: response.sourceWidth,
        sourceHeight: response.sourceHeight,
      };
    }
    if (response.fallback) return processImage(file, job);
    throw new Error(response.error);
  }

  /** Terminate all workers. The pool stays usable and respawns workers lazily. */
  dispose() {
    for (const s of this.slots) s.worker.terminate();
    this.slots = [];
    this.queue = [];
  }
}

export interface BatchCallbacks<T, R> {
  onStart?: (item: T, index: number) => void;
  onDone?: (item: T, result: R, index: number) => void;
  onError?: (item: T, error: unknown, index: number) => void;
}

/**
 * Process items with limited concurrency. Errors are reported per item and do
 * not stop the batch; aborting stops scheduling and rejects with AbortError.
 */
export async function runBatch<T, R>(
  items: T[],
  worker: (item: T, index: number, signal: AbortSignal) => Promise<R>,
  { concurrency = 2, signal, ...cb }: BatchCallbacks<T, R> & { concurrency?: number; signal: AbortSignal },
): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      if (signal.aborted) return;
      const index = next++;
      const item = items[index];
      cb.onStart?.(item, index);
      try {
        const result = await worker(item, index, signal);
        if (signal.aborted) return;
        cb.onDone?.(item, result, index);
      } catch (error) {
        if (signal.aborted) return;
        cb.onError?.(item, error, index);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, lane));
  if (signal.aborted) throw abortError();
}
