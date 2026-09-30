import { useEffect, useRef, useState } from 'react';
import { t } from '@/lib/i18n';
import type { SqlFormatError, SqlFormatSettings } from './lib/sqlFormat';
import type { SqlFormatRequest, SqlFormatResponse } from './workers/sqlFormat.worker';

export type SqlFormatOutcome = { ok: true; value: string } | { ok: false; error: SqlFormatError };

/**
 * Formats SQL in a Web Worker (sql-formatter loads only there). Typing restarts
 * a long-running job so the newest input always wins; the previous result stays
 * visible while the next one is computed.
 */
export function useSqlFormatter(text: string, settings: SqlFormatSettings, enabled: boolean) {
  const worker = useRef<Worker | null>(null);
  const pending = useRef(false);
  const latest = useRef(0);
  const [result, setResult] = useState<{ id: number; outcome: SqlFormatOutcome } | null>(null);
  const [busy, setBusy] = useState(false);
  const active = enabled && text.trim() !== '';

  useEffect(
    () => () => {
      worker.current?.terminate();
      worker.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(
      () => {
        if (pending.current && worker.current) {
          worker.current.terminate();
          worker.current = null;
        }
        if (!worker.current) {
          const w = new Worker(new URL('./workers/sqlFormat.worker.ts', import.meta.url), { type: 'module', name: 'sql-format' });
          w.onmessage = (event: MessageEvent<SqlFormatResponse>) => {
            const data = event.data;
            if (data.id !== latest.current) return;
            pending.current = false;
            setBusy(false);
            setResult({ id: data.id, outcome: data.ok ? { ok: true, value: data.value } : { ok: false, error: data.error } });
          };
          w.onerror = (event) => {
            event.preventDefault();
            pending.current = false;
            setBusy(false);
            setResult({ id: latest.current, outcome: { ok: false, error: { message: t('The SQL formatter could not start in this browser.') } } });
          };
          worker.current = w;
        }
        const id = ++latest.current;
        pending.current = true;
        setBusy(true);
        worker.current.postMessage({ id, text, settings } satisfies SqlFormatRequest);
      },
      text.length > 100_000 ? 400 : 120,
    );
    return () => clearTimeout(timer);
  }, [active, text, settings]);

  return { outcome: active ? (result?.outcome ?? null) : null, busy: active && busy };
}
