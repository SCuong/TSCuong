import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useKeyedResult } from './useKeyedResult';

describe('useKeyedResult', () => {
  it('hides a result once the inputs change and shows it again when they match', () => {
    const { result, rerender } = renderHook(({ key }) => useKeyedResult<string>(key), { initialProps: { key: 'pages:1,2,3' } });
    expect(result.current.value).toBeNull();
    act(() => result.current.set('pages:1,2,3', 'file-A'));
    expect(result.current.value).toBe('file-A');
    // e.g. the user picks other pages after extracting: the old file must not be offered as the new selection.
    rerender({ key: 'pages:1' });
    expect(result.current.value).toBeNull();
    rerender({ key: 'pages:1,2,3' });
    expect(result.current.value).toBe('file-A');
  });

  it('drops a result that finishes after the inputs changed (job still running)', () => {
    const { result, rerender } = renderHook(({ key }) => useKeyedResult<string>(key), { initialProps: { key: 'a' } });
    const keyAtStart = 'a';
    rerender({ key: 'b' });
    act(() => result.current.set(keyAtStart, 'stale'));
    expect(result.current.value).toBeNull();
  });

  it('clears', () => {
    const { result } = renderHook(() => useKeyedResult<string>('k'));
    act(() => result.current.set('k', 'x'));
    act(() => result.current.clear());
    expect(result.current.value).toBeNull();
  });
});
