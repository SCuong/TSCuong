import { useEffect, useMemo, useRef, useState } from 'react';
import { TaskRunner, createTaskWorker } from '../lib/taskRunner';
import type { TaskArgs, TaskName, TaskResult } from '../lib/tasks';

/** Inputs up to this many characters are processed synchronously: instant and without a worker. */
export const SYNC_LIMIT = 150_000;

export interface TaskOptions {
  /** Size of the input in characters; larger inputs are processed in a Web Worker. */
  size: number;
  /**
   * Always run in the worker and stop after this many milliseconds. Use it for work that can
   * run forever, such as a user's regular expression with catastrophic backtracking.
   */
  timeoutMs?: number;
}

export interface TaskState<N extends TaskName> {
  /** The latest result. While `pending` it may still belong to older arguments. */
  value: TaskResult<N> | null;
  /** The arguments `value` was computed from (use them to render the value consistently). */
  args: TaskArgs<N> | null;
  pending: boolean;
  error: string | null;
  timedOut: boolean;
}

const IDLE = { value: null, args: null, pending: false, error: null, timedOut: false };

function describe(error: unknown): string {
  if (error instanceof RangeError) return 'The text is too large to process in this browser.';
  if (error instanceof Error && error.message) return error.message;
  return 'The calculation failed.';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

/** Equal arguments: the same value, or small option objects with the same contents. */
function sameArg(a: unknown, b: unknown): boolean {
  return Object.is(a, b) || (isPlainObject(a) && isPlainObject(b) && JSON.stringify(a) === JSON.stringify(b));
}

/** Keeps the previous array when the new one has equal elements, so callers need not memoize options. */
function useStableArgs<A extends unknown[]>(args: A | null): A | null {
  const ref = useRef<A | null>(args);
  const prev = ref.current;
  const same = prev !== null && args !== null && prev.length === args.length && prev.every((v, i) => sameArg(v, args[i]));
  const stable = same ? prev : args;
  useEffect(() => {
    ref.current = stable;
  });
  return stable;
}

/**
 * Run a pure function on text without freezing the page. Small inputs are processed
 * synchronously; large ones (and every call with `timeoutMs`) run in a Web Worker, where
 * only the latest arguments count and older results stay visible until the new one is ready.
 * `name` must be the task-registry name of `fn` (see lib/tasks.ts).
 */
export function useTask<N extends TaskName>(
  name: N,
  fn: (...args: TaskArgs<N>) => TaskResult<N>,
  rawArgs: TaskArgs<N> | null,
  { size, timeoutMs }: TaskOptions,
): TaskState<N> {
  const args = useStableArgs(rawArgs);
  const sync = args !== null && timeoutMs === undefined && size <= SYNC_LIMIT;

  const syncState = useMemo<TaskState<N> | null>(() => {
    if (!sync || args === null) return null;
    try {
      return { value: fn(...args), args, pending: false, error: null, timedOut: false };
    } catch (error) {
      return { value: null, args, pending: false, error: describe(error), timedOut: false };
    }
  }, [sync, fn, args]);

  const [asyncState, setAsyncState] = useState<TaskState<N>>(IDLE);
  const runner = useRef<TaskRunner | null>(null);
  useEffect(() => () => runner.current?.dispose(), []);

  useEffect(() => {
    if (sync || args === null) {
      runner.current?.cancel();
      return;
    }
    let cancelled = false;
    // Wait for a pause in typing before starting; large inputs wait a little longer.
    const timer = setTimeout(
      () => {
        runner.current ??= new TaskRunner(createTaskWorker);
        void runner.current.run<TaskResult<N>>(name, args, timeoutMs).then((outcome) => {
          if (cancelled || outcome.status === 'superseded') return;
          setAsyncState({
            value: outcome.status === 'done' ? outcome.value : null,
            args,
            pending: false,
            error: outcome.status === 'error' ? outcome.error : null,
            timedOut: outcome.status === 'timeout',
          });
        });
      },
      size > 1_000_000 ? 250 : 100,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sync, name, args, size, timeoutMs]);

  // The last state that had a value, shown (as pending) while newer arguments are processed.
  const lastShown = useRef<TaskState<N>>(IDLE);
  let state: TaskState<N>;
  if (args === null) state = IDLE;
  else if (syncState) state = syncState;
  else if (asyncState.args === args) state = asyncState;
  else state = { ...lastShown.current, pending: true, error: null, timedOut: false };
  useEffect(() => {
    if (state.value !== null) lastShown.current = state;
  });
  return state;
}
