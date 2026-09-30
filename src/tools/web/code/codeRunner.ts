import { useCallback, useEffect, useRef, useState } from 'react';
import type { CodeError, CodeRequest, CodeResponse, CodeTask, CodeTaskResult } from '../lib/codeTask';

export type CodeOutcome<T> = { status: 'done'; value: T } | { status: 'error'; error: CodeError } | { status: 'cancelled' };

/** Work that exceeds this is treated as a crashed worker (it would have run out of memory long before). */
const SAFETY_TIMEOUT_MS = 180_000;

const failure = (message: string): CodeError => ({ message, line: null, column: null, frame: null });

/**
 * Runs code tasks in a Web Worker so formatting or minifying megabytes never freezes the page.
 * Only the latest job matters: starting a new one (or cancelling) terminates a worker that is
 * still busy, because Prettier or Terser cannot be interrupted from outside.
 */
export class CodeRunner {
  private worker: Worker | null = null;
  private seq = 0;
  private pending: { id: number; resolve: (outcome: CodeOutcome<unknown>) => void; timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(
    private readonly createWorker: () => Worker,
    private readonly timeoutMs = SAFETY_TIMEOUT_MS,
  ) {}

  private ensure(): Worker {
    if (!this.worker) {
      const worker = this.createWorker();
      worker.onmessage = (event: MessageEvent<CodeResponse>) => {
        const p = this.pending;
        if (!p || p.id !== event.data.id) return;
        clearTimeout(p.timer);
        this.pending = null;
        p.resolve(event.data.ok ? { status: 'done', value: event.data.value } : { status: 'error', error: event.data.error });
      };
      worker.onerror = (event) => {
        event.preventDefault();
        this.fail('The job stopped unexpectedly, probably because the input is too large for this device.');
      };
      worker.onmessageerror = () => this.fail('The result could not be transferred back to the page.');
      this.worker = worker;
    }
    return this.worker;
  }

  private kill() {
    this.worker?.terminate();
    this.worker = null;
  }

  private fail(message: string) {
    const p = this.pending;
    this.pending = null;
    this.kill();
    if (p) {
      clearTimeout(p.timer);
      p.resolve({ status: 'error', error: failure(message) });
    }
  }

  run<K extends CodeTask['kind']>(task: Extract<CodeTask, { kind: K }>): Promise<CodeOutcome<CodeTaskResult[K]>> {
    this.cancel();
    const id = ++this.seq;
    return new Promise<CodeOutcome<CodeTaskResult[K]>>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending?.id === id) this.fail('The job took too long and was stopped.');
      }, this.timeoutMs);
      this.pending = { id, resolve: resolve as (outcome: CodeOutcome<unknown>) => void, timer };
      try {
        this.ensure().postMessage({ id, task } satisfies CodeRequest);
      } catch {
        this.fail('The background worker could not be started in this browser.');
      }
    });
  }

  /** Stops the running job, if any (its worker is terminated). */
  cancel() {
    const p = this.pending;
    if (!p) return;
    clearTimeout(p.timer);
    this.pending = null;
    this.kill();
    p.resolve({ status: 'cancelled' });
  }

  dispose() {
    this.cancel();
    this.kill();
  }
}

export function createCodeWorker(): Worker {
  return new Worker(new URL('../lib/code.worker.ts', import.meta.url), { type: 'module', name: 'code-tools' });
}

export type CodeJobState<T> =
  | { status: 'idle' }
  | { status: 'pending' }
  | { status: 'done'; value: T }
  | { status: 'error'; error: CodeError }
  | { status: 'cancelled' };

/**
 * Runs `task` in the code worker whenever `key` changes (`key` must capture every input of the task;
 * pass null to go idle). A newer key supersedes a running job; the job stops when the tool unmounts.
 */
export function useCodeJob<K extends CodeTask['kind']>(
  key: string | null,
  makeTask: () => Extract<CodeTask, { kind: K }>,
): {
  state: CodeJobState<CodeTaskResult[K]>;
  /** The last settled outcome (possibly for older input): shown while a new job runs, to avoid flicker. */
  previous: CodeOutcome<CodeTaskResult[K]> | null;
  cancel: () => void;
} {
  const runner = useRef<CodeRunner | null>(null);
  const [result, setResult] = useState<{ key: string; outcome: CodeOutcome<CodeTaskResult[K]> } | null>(null);

  useEffect(
    () => () => {
      runner.current?.dispose();
    },
    [],
  );

  useEffect(() => {
    if (key === null) return;
    runner.current ??= new CodeRunner(createCodeWorker);
    let active = true;
    void runner.current.run<K>(makeTask()).then((outcome) => {
      if (active) setResult({ key, outcome });
    });
    return () => {
      // The input changed or the tool closed: stop working on the stale job.
      active = false;
      runner.current?.cancel();
    };
    // `key` captures the task's inputs by contract.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const cancel = useCallback(() => runner.current?.cancel(), []);

  let state: CodeJobState<CodeTaskResult[K]>;
  if (key === null) state = { status: 'idle' };
  else if (result?.key !== key) state = { status: 'pending' };
  else state = result.outcome;
  return { state, previous: result?.outcome ?? null, cancel };
}
