/// <reference lib="webworker" />
import { bcryptCheck, bcryptHash } from './bcrypt';

export type BcryptRequest =
  | { id: number; op: 'hash'; password: string; cost: number }
  | { id: number; op: 'verify'; password: string; hash: string };

export type BcryptResponse =
  | { id: number; ok: true; hash?: string; match?: boolean; ms: number }
  | { id: number; ok: false; error: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (event: MessageEvent<BcryptRequest>) => {
  const req = event.data;
  const start = performance.now();
  try {
    if (req.op === 'hash') {
      const hash = await bcryptHash(req.password, req.cost);
      scope.postMessage({ id: req.id, ok: true, hash, ms: performance.now() - start } satisfies BcryptResponse);
    } else {
      const match = await bcryptCheck(req.password, req.hash);
      scope.postMessage({ id: req.id, ok: true, match, ms: performance.now() - start } satisfies BcryptResponse);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'bcrypt failed.';
    scope.postMessage({ id: req.id, ok: false, error: message } satisfies BcryptResponse);
  }
};
