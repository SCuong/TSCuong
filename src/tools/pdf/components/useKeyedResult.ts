import { useCallback, useState } from 'react';

/**
 * A result that is only shown while the inputs it was made from are unchanged.
 *
 * `key` describes the current inputs (pages, options, order...). A result stored for a
 * different key — because the inputs changed after the job finished, or while it was still
 * running — is hidden instead of being offered for download under a title that no longer
 * matches what is on screen.
 */
export function useKeyedResult<T>(key: string) {
  const [state, setState] = useState<{ key: string; value: T } | null>(null);
  const value = state !== null && state.key === key ? state.value : null;
  /** Store `next` for the inputs described by `forKey` (capture it when the job starts). */
  const set = useCallback((forKey: string, next: T) => setState({ key: forKey, value: next }), []);
  const clear = useCallback(() => setState(null), []);
  return { value, set, clear };
}
