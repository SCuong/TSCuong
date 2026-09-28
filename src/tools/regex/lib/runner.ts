import type { RegexJob, RegexJobResult } from './job';
import type { RegexWorkerRequest } from './regex.worker';

export type RunOutcome = { status: 'done'; result: RegexJobResult } | { status: 'timeout' } | { status: 'superseded' };

/**
 * Runs regex jobs in a Web Worker with a time limit. A runaway pattern
 * (catastrophic backtracking) cannot be interrupted inside the engine, so on
 * timeout the worker is terminated and a fresh one is created for the next job.
 * Starting a new job supersedes (and, if still busy, kills) the previous one.
 */
export class RegexRunner {
  private worker: Worker | null = null;
  private seq = 0;
  private pending: { id: number; resolve: (o: RunOutcome) => void; timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(private readonly createWorker: () => Worker) {}

  private ensure(): Worker {
    if (!this.worker) {
      const worker = this.createWorker();
      worker.onmessage = (event: MessageEvent<{ id: number; result: RegexJobResult }>) => {
        const p = this.pending;
        if (!p || p.id !== event.data.id) return;
        clearTimeout(p.timer);
        this.pending = null;
        p.resolve({ status: 'done', result: event.data.result });
      };
      worker.onerror = (event) => {
        event.preventDefault();
        const p = this.pending;
        this.kill();
        if (p) {
          clearTimeout(p.timer);
          this.pending = null;
          p.resolve({ status: 'done', result: { ok: false, error: 'The matcher stopped unexpectedly. Try again.' } });
        }
      };
      this.worker = worker;
    }
    return this.worker;
  }

  private kill() {
    this.worker?.terminate();
    this.worker = null;
  }

  run(job: RegexJob, timeoutMs: number): Promise<RunOutcome> {
    if (this.pending) {
      // The previous job is still running: it may be stuck, so start from a clean worker.
      clearTimeout(this.pending.timer);
      this.pending.resolve({ status: 'superseded' });
      this.pending = null;
      this.kill();
    }
    const id = ++this.seq;
    return new Promise<RunOutcome>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending?.id !== id) return;
        this.pending = null;
        this.kill();
        resolve({ status: 'timeout' });
      }, timeoutMs);
      this.pending = { id, resolve, timer };
      const request: RegexWorkerRequest = { id, ...job };
      this.ensure().postMessage(request);
    });
  }

  dispose() {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.resolve({ status: 'superseded' });
      this.pending = null;
    }
    this.kill();
  }
}

export function createRegexWorker(): Worker {
  return new Worker(new URL('./regex.worker.ts', import.meta.url), { type: 'module' });
}
