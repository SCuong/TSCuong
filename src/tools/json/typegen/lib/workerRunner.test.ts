import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LatestJobRunner } from './workerRunner';

/** Minimal fake worker: echoes `{ value * 2 }` after `delay` ms unless told to hang or crash. */
class FakeWorker {
  static created = 0;
  static terminated = 0;
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: ErrorEvent) => void) | null = null;
  constructor() {
    FakeWorker.created++;
  }
  postMessage(msg: { id: number; value: number; mode?: 'hang' | 'crash' }) {
    if (msg.mode === 'hang') return;
    setTimeout(() => {
      if (msg.mode === 'crash') {
        this.onerror?.({ preventDefault() {} } as ErrorEvent);
        return;
      }
      this.onmessage?.({ data: { id: msg.id, result: msg.value * 2 } } as MessageEvent);
    }, 10);
  }
  terminate() {
    FakeWorker.terminated++;
  }
}

type Req = { value: number; mode?: 'hang' | 'crash' };

describe('LatestJobRunner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWorker.created = 0;
    FakeWorker.terminated = 0;
  });
  afterEach(() => vi.useRealTimers());

  const make = () => new LatestJobRunner<Req, number>(() => new FakeWorker() as unknown as Worker, 1000);

  it('returns results and reuses the worker', async () => {
    const runner = make();
    const a = runner.run({ value: 2 });
    await vi.advanceTimersByTimeAsync(20);
    expect(await a).toEqual({ status: 'done', result: 4 });
    const b = runner.run({ value: 5 });
    await vi.advanceTimersByTimeAsync(20);
    expect(await b).toEqual({ status: 'done', result: 10 });
    expect(FakeWorker.created).toBe(1);
  });

  it('supersedes a running job and restarts the worker', async () => {
    const runner = make();
    const first = runner.run({ value: 1, mode: 'hang' });
    const second = runner.run({ value: 3 });
    expect(await first).toEqual({ status: 'superseded' });
    await vi.advanceTimersByTimeAsync(20);
    expect(await second).toEqual({ status: 'done', result: 6 });
    expect(FakeWorker.terminated).toBe(1);
    expect(FakeWorker.created).toBe(2);
  });

  it('times out and kills a stuck worker', async () => {
    const runner = make();
    const job = runner.run({ value: 1, mode: 'hang' });
    await vi.advanceTimersByTimeAsync(1001);
    expect(await job).toEqual({ status: 'timeout' });
    expect(FakeWorker.terminated).toBe(1);
  });

  it('reports crashes and recovers', async () => {
    const runner = make();
    const job = runner.run({ value: 1, mode: 'crash' });
    await vi.advanceTimersByTimeAsync(20);
    expect(await job).toEqual({ status: 'crashed' });
    const next = runner.run({ value: 4 });
    await vi.advanceTimersByTimeAsync(20);
    expect(await next).toEqual({ status: 'done', result: 8 });
  });

  it('dispose cancels the pending job', async () => {
    const runner = make();
    const job = runner.run({ value: 1, mode: 'hang' });
    runner.dispose();
    expect(await job).toEqual({ status: 'superseded' });
  });
});
