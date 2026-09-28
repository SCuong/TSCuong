import { useCallback, useEffect, useRef, useState } from 'react';
import { readRaw, writeRaw } from './storage/local';
import { settingsStore } from './userPrefs';

export function useDebouncedValue<T>(value: T, delay = 200): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

const MAX_REMEMBERED_CHARS = 200_000;

/**
 * `useState` that remembers its value for a tool across visits (when the
 * "remember tool input" setting is on). Only for small JSON-serializable values;
 * very large text is intentionally not persisted.
 */
export function useToolState<T>(toolId: string, key: string, initial: T): [T, (next: T | ((prev: T) => T)) => void] {
  const storageKey = `tool:${toolId}:${key}`;
  const [value, setValue] = useState<T>(() => {
    if (!settingsStore.get().rememberToolInput) return initial;
    const raw = readRaw(storageKey);
    if (raw === null) return initial;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    if (!settingsStore.get().rememberToolInput) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const serialized = JSON.stringify(value);
      writeRaw(storageKey, serialized.length > MAX_REMEMBERED_CHARS ? null : serialized);
    }, 300);
    return () => clearTimeout(timer.current);
  }, [storageKey, value]);

  return [value, setValue];
}

/** Creates an object URL for a Blob and revokes it when the blob changes or the component unmounts. */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

/** Tracks a cancellable async job with progress. */
export function useAsyncJob() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [label, setLabel] = useState<string>('');
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const run = useCallback(
    async <R,>(
      job: (ctx: { signal: AbortSignal; progress: (fraction: number | null, label?: string) => void }) => Promise<R>,
    ): Promise<R> => {
      controller.current?.abort();
      const ctrl = new AbortController();
      controller.current = ctrl;
      setRunning(true);
      setProgress(null);
      setLabel('');
      try {
        return await job({
          signal: ctrl.signal,
          progress: (fraction, text) => {
            if (ctrl.signal.aborted) return;
            setProgress(fraction);
            if (text !== undefined) setLabel(text);
          },
        });
      } finally {
        if (controller.current === ctrl) {
          controller.current = null;
          setRunning(false);
          setProgress(null);
          setLabel('');
        }
      }
    },
    [],
  );

  const cancel = useCallback(() => controller.current?.abort(), []);

  return { running, progress, label, run, cancel };
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  );
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

/** Throws the AbortError if the signal was aborted; use inside long loops. */
export function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
}

/** Yield to the event loop so the UI can repaint during long main-thread loops. */
export function nextFrame(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
