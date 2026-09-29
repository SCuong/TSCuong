export type JobOutcome<R> =
  | { status: 'done'; result: R }
  | { status: 'timeout' }
  | { status: 'superseded' }
  | { status: 'crashed' };

interface Pending<R> {
  id: number;
  resolve: (outcome: JobOutcome<R>) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Runs one job at a time in a Web Worker and only cares about the latest one.
 * Starting a job while another is still running terminates the busy worker (its
 * result would be stale anyway) and a fresh worker takes the new job. Jobs that
 * exceed the time limit also terminate the worker, so a runaway computation
 * (e.g. a catastrophic regex in a schema `pattern`) can never freeze the page.
 */
export class LatestJobRunner<Req extends object, Res> {
  private worker: Worker | null = null;
  private seq = 0;
  private pending: Pending<Res> | null = null;

  constructor(
    private readonly createWorker: () => Worker,
    private readonly timeoutMs: number,
  ) {}

  private ensure(): Worker {
    if (!this.worker) {
      const worker = this.createWorker();
      worker.onmessage = (event: MessageEvent<{ id: number; result: Res }>) => {
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
          p.resolve({ status: 'crashed' });
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

  run(request: Req): Promise<JobOutcome<Res>> {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.resolve({ status: 'superseded' });
      this.pending = null;
      this.kill();
    }
    const id = ++this.seq;
    return new Promise<JobOutcome<Res>>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending?.id !== id) return;
        this.pending = null;
        this.kill();
        resolve({ status: 'timeout' });
      }, this.timeoutMs);
      this.pending = { id, resolve, timer };
      try {
        this.ensure().postMessage({ ...request, id });
      } catch {
        clearTimeout(timer);
        this.pending = null;
        this.kill();
        resolve({ status: 'crashed' });
      }
    });
  }

  /** Cancels the running job (if any) and terminates the worker. A later `run` starts a new one. */
  dispose() {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.resolve({ status: 'superseded' });
      this.pending = null;
    }
    this.kill();
  }
}
