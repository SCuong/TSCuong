import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useAsyncJob } from './hooks';

describe('useAsyncJob', () => {
  it('reports running while a job is in flight and resets when it finishes', async () => {
    const { result } = renderHook(() => useAsyncJob());
    let resolve!: (v: number) => void;
    let promise!: Promise<number>;
    act(() => {
      promise = result.current.run(
        ({ progress }) =>
          new Promise<number>((r) => {
            progress(0.5, 'Halfway');
            resolve = r;
          }),
      );
    });
    expect(result.current.running).toBe(true);
    expect(result.current.progress).toBe(0.5);
    expect(result.current.label).toBe('Halfway');
    await act(async () => {
      resolve(42);
      await expect(promise).resolves.toBe(42);
    });
    expect(result.current.running).toBe(false);
    expect(result.current.progress).toBeNull();
  });

  it('cancels a job that ignores its signal: UI returns to idle and run() rejects with AbortError', async () => {
    const { result } = renderHook(() => useAsyncJob());
    let promise!: Promise<unknown>;
    act(() => {
      promise = result.current.run(() => new Promise(() => {})); // never settles, ignores the signal
    });
    expect(result.current.running).toBe(true);
    act(() => result.current.cancel());
    expect(result.current.running).toBe(false);
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('ignores a late result after cancel and does not flip state back', async () => {
    const { result } = renderHook(() => useAsyncJob());
    let resolveLate!: (v: string) => void;
    let promise!: Promise<string>;
    act(() => {
      promise = result.current.run(() => new Promise<string>((r) => (resolveLate = r)));
    });
    act(() => result.current.cancel());
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    await act(async () => resolveLate('too late'));
    expect(result.current.running).toBe(false);
  });

  it('a new run aborts the previous one', async () => {
    const { result } = renderHook(() => useAsyncJob());
    let first!: Promise<unknown>;
    act(() => {
      first = result.current.run(() => new Promise(() => {}));
    });
    let second!: Promise<string>;
    act(() => {
      second = result.current.run(async () => 'second');
    });
    await expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await act(async () => {
      await expect(second).resolves.toBe('second');
    });
    expect(result.current.running).toBe(false);
  });
});
