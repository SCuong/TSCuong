/// <reference lib="webworker" />
/** Runs SVGO off the main thread: large SVGs can take seconds (or minutes) to optimize. */
import { optimize, type Config } from 'svgo/browser';

export interface SvgoRequest {
  id: number;
  input: string;
  config: Config;
}

export type SvgoResponse = { id: number; ok: true; data: string } | { id: number; ok: false; error: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = (event: MessageEvent<SvgoRequest>) => {
  const { id, input, config } = event.data;
  let msg: SvgoResponse;
  try {
    msg = { id, ok: true, data: optimize(input, config).data };
  } catch (error) {
    msg = { id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  scope.postMessage(msg);
};
