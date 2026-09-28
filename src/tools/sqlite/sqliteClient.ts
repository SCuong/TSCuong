import type { RequestMap, RequestType, WorkerRequest, WorkerResponse } from './lib/protocol';

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  onProgress?: (label: string) => void;
}

/** Promise-based, typed wrapper around the SQLite worker. */
export class SqliteClient {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private terminated = false;

  constructor() {
    this.worker = new Worker(new URL('./sqlite.worker.ts', import.meta.url), { type: 'module', name: 'sqlite-studio' });
    this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      const entry = this.pending.get(message.id);
      if (!entry) return;
      if ('progress' in message) {
        entry.onProgress?.(message.progress);
        return;
      }
      this.pending.delete(message.id);
      if (message.ok) entry.resolve(message.result);
      else entry.reject(new Error(message.error));
    };
    this.worker.onerror = (event) => {
      event.preventDefault();
      this.failAll(new Error('The SQLite worker crashed. The database may be too large for this browser.'));
    };
  }

  call<K extends RequestType>(
    type: K,
    payload: RequestMap[K]['req'],
    options: { onProgress?: (label: string) => void; transfer?: Transferable[] } = {},
  ): Promise<RequestMap[K]['res']> {
    if (this.terminated) return Promise.reject(new Error('The database engine was stopped.'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress: options.onProgress });
      this.worker.postMessage({ id, type, payload } as WorkerRequest, options.transfer ?? []);
    });
  }

  get busy(): boolean {
    return this.pending.size > 0;
  }

  private failAll(error: Error) {
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }

  terminate(reason = 'The query was stopped.') {
    if (this.terminated) return;
    this.terminated = true;
    this.worker.terminate();
    this.failAll(new Error(reason));
  }
}
