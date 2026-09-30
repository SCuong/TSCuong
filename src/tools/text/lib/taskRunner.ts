import type { TaskName } from './tasks';

export type TaskOutcome<R> =
  | { status: 'done'; value: R }
  | { status: 'error'; error: string }
  | { status: 'timeout' }
  | { status: 'superseded' };

export interface TaskRequest {
  id: number;
  name: TaskName;
  args: unknown[];
}

export type TaskResponse = { id: number; ok: true; value: unknown } | { id: number; ok: false; error: string };

/** Heavy but finite work that exceeds this is treated as a crashed worker (e.g. out of memory). */
const SAFETY_TIMEOUT_MS = 120_000;

/**
 * Runs text tasks in a Web Worker. Only the latest request matters: starting a new one
 * terminates a worker that is still busy (a runaway regular expression cannot be interrupted
 * inside the engine) and a fresh worker is created. An optional time limit stops user
 * patterns with catastrophic backtracking.
 */
export class TaskRunner {
  private worker: Worker | null = null;
  private seq = 0;
  private pending: { id: number; resolve: (o: TaskOutcome<unknown>) => void; timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(private readonly createWorker: () => Worker) {}

  private ensure(): Worker {
    if (!this.worker) {
      const worker = this.createWorker();
      worker.onmessage = (event: MessageEvent<TaskResponse>) => {
        const p = this.pending;
        if (!p || p.id !== event.data.id) return;
        clearTimeout(p.timer);
        this.pending = null;
        p.resolve(event.data.ok ? { status: 'done', value: event.data.value } : { status: 'error', error: event.data.error });
      };
      worker.onerror = (event) => {
        event.preventDefault();
        this.fail('The calculation stopped unexpectedly, probably because the text is too large for this device.');
      };
      worker.onmessageerror = () => this.fail('The result could not be transferred back to the page.');
      this.worker = worker;
    }
    return this.worker;
  }

  private fail(error: string) {
    const p = this.pending;
    this.kill();
    if (p) {
      clearTimeout(p.timer);
      this.pending = null;
      p.resolve({ status: 'error', error });
    }
  }

  private kill() {
    this.worker?.terminate();
    this.worker = null;
  }

  run<R>(name: TaskName, args: unknown[], timeoutMs?: number): Promise<TaskOutcome<R>> {
    this.cancel();
    const id = ++this.seq;
    return new Promise<TaskOutcome<R>>((resolve) => {
      const limit = timeoutMs ?? SAFETY_TIMEOUT_MS;
      const timer = setTimeout(() => {
        if (this.pending?.id !== id) return;
        this.pending = null;
        this.kill();
        resolve(timeoutMs ? { status: 'timeout' } : { status: 'error', error: 'The calculation took too long and was stopped.' });
      }, limit);
      this.pending = { id, resolve: resolve as (o: TaskOutcome<unknown>) => void, timer };
      const request: TaskRequest = { id, name, args };
      this.ensure().postMessage(request);
    });
  }

  /** Abandon the running task (its worker is terminated, since it may be stuck). */
  cancel() {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.resolve({ status: 'superseded' });
    this.pending = null;
    this.kill();
  }

  dispose() {
    this.cancel();
    this.kill();
  }
}

export function createTaskWorker(): Worker {
  return new Worker(new URL('./tasks.worker.ts', import.meta.url), { type: 'module' });
}
