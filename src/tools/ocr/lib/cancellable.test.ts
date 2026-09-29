import { describe, expect, it } from 'vitest';
import { PendingJobs, cancelledError } from './cancellable';

describe('PendingJobs', () => {
  it('passes results and errors through', async () => {
    const jobs = new PendingJobs();
    await expect(jobs.track(Promise.resolve(42))).resolves.toBe(42);
    await expect(jobs.track(Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(jobs.size).toBe(0);
  });

  it('rejects jobs that would otherwise never settle (tesseract.js after terminate)', async () => {
    const jobs = new PendingJobs();
    const never = new Promise<number>(() => {});
    const tracked = jobs.track(never);
    expect(jobs.size).toBe(1);
    jobs.cancelAll();
    await expect(tracked).rejects.toMatchObject({ name: 'AbortError' });
    expect(jobs.size).toBe(0);
  });

  it('ignores a late result after cancellation', async () => {
    const jobs = new PendingJobs();
    let finish!: (v: string) => void;
    const tracked = jobs.track(new Promise<string>((resolve) => (finish = resolve)));
    jobs.cancelAll();
    finish('late');
    await expect(tracked).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('creates AbortErrors that the PDF error mapper treats as cancellation', () => {
    const e = cancelledError();
    expect(e.name).toBe('AbortError');
    expect(e.message).toMatch(/cancelled/);
  });
});
