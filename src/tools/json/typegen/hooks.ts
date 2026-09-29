import { useEffect, useMemo, useRef, useState } from 'react';
import type { Extension } from '@codemirror/state';
import { LatestJobRunner } from './lib/workerRunner';

/** A LatestJobRunner that lives as long as the component and terminates its worker on unmount. */
export function useLatestJobRunner<Req extends object, Res>(createWorker: () => Worker, timeoutMs: number) {
  const ref = useRef<LatestJobRunner<Req, Res> | null>(null);
  if (!ref.current) ref.current = new LatestJobRunner<Req, Res>(createWorker, timeoutMs);
  useEffect(() => () => ref.current?.dispose(), []);
  return ref.current;
}

export type ExtraLanguage = 'csharp' | 'kotlin';

/**
 * Syntax highlighting for languages the shared editor does not list (C#, Kotlin),
 * loaded on demand from the CodeMirror legacy modes. Returns a stable extension array.
 */
export function useExtraLanguage(language: ExtraLanguage | null): Extension[] | undefined {
  const [loaded, setLoaded] = useState<Partial<Record<ExtraLanguage, Extension>>>({});
  const needed = language && !loaded[language] ? language : null;
  useEffect(() => {
    if (!needed) return;
    let cancelled = false;
    void Promise.all([import('@codemirror/language'), import('@codemirror/legacy-modes/mode/clike')])
      .then(([{ StreamLanguage }, clike]) => {
        if (cancelled) return;
        const mode = needed === 'csharp' ? clike.csharp : clike.kotlin;
        setLoaded((prev) => ({ ...prev, [needed]: StreamLanguage.define(mode) }));
      })
      .catch(() => {
        // Highlighting is optional; plain text is fine.
      });
    return () => {
      cancelled = true;
    };
  }, [needed]);
  const ext = language ? loaded[language] : undefined;
  return useMemo(() => (ext ? [ext] : undefined), [ext]);
}
