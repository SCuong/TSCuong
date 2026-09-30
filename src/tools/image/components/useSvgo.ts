import { useEffect, useRef, useState } from 'react';
import type { Config } from 'svgo/browser';
import type { SvgoRequest, SvgoResponse } from '../lib/svgo.worker';

export type SvgoResult = { input: string; ok: true; data: string } | { input: string; ok: false; error: string };

export const SVGO_LOAD_ERROR = 'The SVG optimizer failed to load. Check your connection and reload the page.';

/**
 * Optimizes SVG markup with SVGO in a Web Worker so large documents never freeze
 * the page. A new request while one is running restarts the worker (a slow job
 * can't block later edits); the worker is terminated on unmount.
 */
export function useSvgo(input: string, config: Config): { result: SvgoResult | null; working: boolean; loadError: string | null } {
  const [result, setResult] = useState<SvgoResult | null>(null);
  const [working, setWorking] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const busy = useRef(false);
  const seq = useRef(0);
  /** The input of the request in flight (results are reported against it). */
  const pending = useRef('');
  const configKey = JSON.stringify(config);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const id = ++seq.current;
    if (busy.current && workerRef.current) {
      workerRef.current.terminate();
      workerRef.current = null;
      busy.current = false;
    }
    if (!input.trim()) {
      setWorking(false);
      return;
    }
    let worker = workerRef.current;
    if (!worker) {
      const created = new Worker(new URL('../lib/svgo.worker.ts', import.meta.url), { type: 'module' });
      created.onmessage = (event: MessageEvent<SvgoResponse>) => {
        const msg = event.data;
        if (msg.id !== seq.current) return;
        busy.current = false;
        setWorking(false);
        setResult(
          msg.ok ? { input: pending.current, ok: true, data: msg.data } : { input: pending.current, ok: false, error: msg.error.split('\n')[0] },
        );
      };
      created.onerror = (event) => {
        event.preventDefault();
        busy.current = false;
        created.terminate();
        if (workerRef.current === created) workerRef.current = null;
        setWorking(false);
        setLoadError(SVGO_LOAD_ERROR);
      };
      workerRef.current = created;
      worker = created;
    }
    busy.current = true;
    pending.current = input;
    setWorking(true);
    setLoadError(null);
    const request: SvgoRequest = { id, input, config: JSON.parse(configKey) as Config };
    worker.postMessage(request);
  }, [input, configKey]);

  return { result: input.trim() ? result : null, working: Boolean(input.trim()) && working, loadError };
}
