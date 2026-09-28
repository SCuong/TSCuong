import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useHistory } from './useHistory';
import { arrayMove } from './PageGrid';

describe('useHistory', () => {
  it('supports undo and redo', () => {
    const { result } = renderHook(() => useHistory([1, 2, 3]));
    act(() => result.current.set((v) => arrayMove(v, 0, 2)));
    expect(result.current.value).toEqual([2, 3, 1]);
    expect(result.current.canUndo).toBe(true);
    act(() => result.current.undo());
    expect(result.current.value).toEqual([1, 2, 3]);
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.redo());
    expect(result.current.value).toEqual([2, 3, 1]);
  });

  it('clears redo after a new change and ignores no-op sets', () => {
    const { result } = renderHook(() => useHistory('a'));
    act(() => result.current.set('b'));
    act(() => result.current.undo());
    act(() => result.current.set('c'));
    expect(result.current.canRedo).toBe(false);
    const before = result.current.canUndo;
    act(() => result.current.set('c'));
    expect(result.current.canUndo).toBe(before);
  });

  it('reset clears history', () => {
    const { result } = renderHook(() => useHistory(0));
    act(() => result.current.set(1));
    act(() => result.current.reset(5));
    expect(result.current).toMatchObject({ value: 5, canUndo: false, canRedo: false });
  });
});

describe('arrayMove', () => {
  it('moves items and clamps the target', () => {
    expect(arrayMove(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(arrayMove(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
    expect(arrayMove(['a', 'b', 'c'], 1, 99)).toEqual(['a', 'c', 'b']);
  });
});
