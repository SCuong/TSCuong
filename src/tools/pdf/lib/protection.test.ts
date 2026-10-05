import { afterEach, expect, it, vi } from 'vitest';
import { runProtection } from './protection';
const instances: WorkerStub[] = [];
class WorkerStub {
  terminate = vi.fn();
  postMessage = vi.fn((_job: { bytes: Uint8Array }, _transfer: Transferable[]) => {});
  onmessage: ((event: { data: { bytes?: Uint8Array; error?: boolean } }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { instances.push(this); }
}
afterEach(() => { instances.length = 0; vi.unstubAllGlobals(); });
it('cancels a running worker without detaching the original PDF or accepting late output', async () => {
  vi.stubGlobal('Worker', WorkerStub);
  const source = new Uint8Array([37, 80, 68, 70]); const controller = new AbortController();
  const job = runProtection({ bytes: source, newPassword: 'Secret password', ownerPassword: 'Owner password' }, controller.signal, () => {});
  const worker = instances[0];
  const transferred = worker.postMessage.mock.calls[0][0].bytes;
  expect(transferred).not.toBe(source);
  controller.abort(); await expect(job).rejects.toMatchObject({ name: 'AbortError' });
  expect(worker.terminate).toHaveBeenCalledOnce();
  worker.onmessage?.({ data: { bytes: new Uint8Array([0]) } });
  expect(source).toEqual(new Uint8Array([37, 80, 68, 70]));
});
it('terminates and rejects engine errors instead of returning an unusable file', async () => {
  vi.stubGlobal('Worker', WorkerStub);
  const job = runProtection({ bytes: new Uint8Array([1]) }, new AbortController().signal, () => {});
  instances[0].onerror?.(); await expect(job).rejects.toThrow('could not start');
  expect(instances[0].terminate).toHaveBeenCalledOnce();
});
