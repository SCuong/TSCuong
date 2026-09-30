import { afterEach, describe, expect, it, vi } from 'vitest';
import { TaskRunner, type TaskRequest } from './taskRunner';
import { runTask } from './tasks';

/** A stand-in for a Web Worker that runs tasks after a delay (or never, to simulate a stuck regex). */
class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminated = false;
  constructor(private readonly delayMs: number | null) {}
  postMessage(request: TaskRequest) {
    if (this.delayMs === null) return; // stuck forever
    setTimeout(() => {
      if (this.terminated) return;
      this.onmessage?.({ data: { id: request.id, ok: true, value: runTask(request.name, request.args) } } as MessageEvent);
    }, this.delayMs);
  }
  terminate() {
    this.terminated = true;
  }
}

describe('TaskRunner', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns the result of a task', async () => {
    const runner = new TaskRunner(() => new FakeWorker(1) as unknown as Worker);
    const outcome = await runner.run('findAndReplace', ['a-b', '-', '+', {}]);
    expect(outcome).toMatchObject({ status: 'done', value: { ok: true, text: 'a+b', count: 1 } });
  });

  it('stops a stuck task after the time limit and terminates its worker', async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const runner = new TaskRunner(() => {
      const w = new FakeWorker(null);
      workers.push(w);
      return w as unknown as Worker;
    });
    const pending = runner.run('findAndReplace', ['aaaa', '(a+)+$', '', { regex: true }], 2000);
    vi.advanceTimersByTime(2001);
    await expect(pending).resolves.toEqual({ status: 'timeout' });
    expect(workers[0].terminated).toBe(true);
  });

  it('supersedes a running task and starts a fresh worker for the next one', async () => {
    const workers: FakeWorker[] = [];
    const runner = new TaskRunner(() => {
      const w = new FakeWorker(workers.length === 0 ? null : 1);
      workers.push(w);
      return w as unknown as Worker;
    });
    const first = runner.run('textStats', ['stuck']);
    const second = runner.run('textStats', ['two words']);
    await expect(first).resolves.toEqual({ status: 'superseded' });
    expect(workers[0].terminated).toBe(true);
    await expect(second).resolves.toMatchObject({ status: 'done', value: { words: 2 } });
    runner.dispose();
    expect(workers[1].terminated).toBe(true);
  });

  it('reports a crashed worker as an error sentence', async () => {
    let worker: FakeWorker | null = null;
    const runner = new TaskRunner(() => {
      worker = new FakeWorker(null);
      return worker as unknown as Worker;
    });
    const pending = runner.run('textStats', ['x']);
    (worker as unknown as FakeWorker).onerror?.({ preventDefault() {} } as ErrorEvent);
    await expect(pending).resolves.toMatchObject({ status: 'error', error: expect.stringMatching(/stopped unexpectedly/) });
  });

  it('rejects unknown task names', () => {
    expect(() => runTask('nope' as never, [])).toThrow(/Unknown task/);
  });
});
