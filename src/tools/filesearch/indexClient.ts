import type { IndexProgress, RequestMap, RequestType, WorkerRequest, WorkerResponse } from './lib/protocol';

export class CancelledError extends Error {
  constructor(message = 'Cancelled.') {
    super(message);
    this.name = 'CancelledError';
  }
}

export class WatchdogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WatchdogError';
  }
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onProgress?: (p: IndexProgress) => void;
  watchdog?: { ms: number; message: string; timer: ReturnType<typeof setTimeout> | undefined };
}

/** Typed wrapper around the indexing worker, with an optional per-call watchdog. */
export class IndexClient {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();
  terminated = false;

  constructor(private onCrash?: (error: Error) => void) {
    this.worker = new Worker(new URL('./fileIndex.worker.ts', import.meta.url), { type: 'module', name: 'file-search-index' });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.armWatchdog(message.id, entry);
      if ('progress' in message) {
        entry.onProgress?.(message.progress);
        return;
      }
      this.pending.delete(message.id);
      clearTimeout(entry.watchdog?.timer);
      if (message.ok) entry.resolve(message.result);
      else entry.reject(message.cancelled ? new CancelledError(message.error) : new Error(message.error));
    };
    this.worker.onerror = (event) => {
      event.preventDefault();
      const error = new Error('The indexing worker crashed, probably because it ran out of memory.');
      this.terminate(error);
      this.onCrash?.(error);
    };
  }

  private armWatchdog(id: number, entry: Pending) {
    if (!entry.watchdog) return;
    clearTimeout(entry.watchdog.timer);
    const { ms, message } = entry.watchdog;
    entry.watchdog.timer = setTimeout(() => {
      if (!this.pending.has(id)) return;
      const error = new WatchdogError(message);
      this.terminate(error);
      this.onCrash?.(error);
    }, ms);
  }

  call<K extends RequestType>(
    type: K,
    payload: RequestMap[K]['req'],
    options: { onProgress?: (p: IndexProgress) => void; watchdogMs?: number; watchdogMessage?: string } = {},
  ): Promise<RequestMap[K]['res']> {
    if (this.terminated) return Promise.reject(new Error('The search engine was restarted. Try again.'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const entry: Pending = { resolve: resolve as (v: unknown) => void, reject, onProgress: options.onProgress };
      if (options.watchdogMs) {
        entry.watchdog = { ms: options.watchdogMs, message: options.watchdogMessage ?? 'The operation took too long.', timer: undefined };
      }
      this.pending.set(id, entry);
      this.armWatchdog(id, entry);
      this.worker.postMessage({ id, type, payload } as WorkerRequest);
    });
  }

  /** Ask the worker to stop the current indexing job or search (it answers the original call with a CancelledError). */
  cancel() {
    if (!this.terminated) this.worker.postMessage({ id: ++this.seq, type: 'cancel', payload: null } as WorkerRequest);
  }

  terminate(error: Error = new CancelledError('Stopped.')) {
    if (this.terminated) return;
    this.terminated = true;
    this.worker.terminate();
    for (const entry of this.pending.values()) {
      clearTimeout(entry.watchdog?.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }
}
