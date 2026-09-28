/**
 * PDF worker: runs pdf-lib operations off the main thread.
 * Protocol (one job per worker; the main thread terminates the worker to cancel):
 *   main → worker  { op, args }
 *   worker → main  { type: 'progress', value, label } | { type: 'result', result } | { type: 'error', error }
 */
import { serializeError } from './errors';
import { OPS, type OpName } from './ops';
import type { WorkerRequest, WorkerResponse } from './protocol';

// Typed view of the dedicated worker scope (the app tsconfig uses DOM typings, not WebWorker).
const scope = self as unknown as {
  postMessage: (message: WorkerResponse, transfer: Transferable[]) => void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

function post(message: WorkerResponse, transfer: Transferable[] = []) {
  scope.postMessage(message, transfer);
}

/** Collect ArrayBuffers in the result so they are moved, not copied. */
function transferables(value: unknown, out: Transferable[] = [], depth = 0): Transferable[] {
  if (depth > 3 || !value) return out;
  if (value instanceof Uint8Array) {
    if (value.byteOffset === 0 && value.byteLength === value.buffer.byteLength && value.buffer instanceof ArrayBuffer) {
      if (!out.includes(value.buffer)) out.push(value.buffer);
    }
  } else if (Array.isArray(value)) {
    for (const v of value) transferables(v, out, depth + 1);
  } else if (typeof value === 'object') {
    for (const v of Object.values(value)) transferables(v, out, depth + 1);
  }
  return out;
}

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { op, args } = event.data;
  try {
    const fn = OPS[op as OpName] as (a: unknown, ctx: unknown) => Promise<unknown>;
    if (!fn) throw new Error(`Unknown operation "${op}".`);
    let last = 0;
    const result = await fn(args, {
      progress: (value: number, label?: string) => {
        const now = Date.now();
        if (now - last < 60 && value < 1) return;
        last = now;
        post({ type: 'progress', value, label });
      },
      checkCancelled: () => {},
    });
    post({ type: 'result', result }, transferables(result));
  } catch (error) {
    post({ type: 'error', error: serializeError(error) });
  }
};
