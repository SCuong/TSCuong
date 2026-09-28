import { useCallback, useEffect, useRef, useState } from 'react';
import { errorMessage } from '@/lib/utils';
import { runBatch } from '../lib/pool';

export interface BatchOutput {
  blob: Blob;
  name: string;
  width?: number;
  height?: number;
  sourceWidth?: number;
  sourceHeight?: number;
  /** Shown under the file name (e.g. "Original kept: output was larger"). */
  note?: string;
  warning?: boolean;
  /** Tool-specific data rendered by the tool (e.g. a metadata report). */
  data?: unknown;
}

export interface BatchItem {
  id: string;
  file: File;
  thumbUrl: string;
  status: 'pending' | 'working' | 'done' | 'error';
  output?: BatchOutput;
  error?: string;
}

export type BatchProcessor = (file: File, signal: AbortSignal) => Promise<BatchOutput>;

let idSeq = 0;

/**
 * Manages a list of input files and (re)processes them with concurrency 2
 * whenever files are added or `settingsKey` changes. Object URLs for
 * thumbnails are revoked when items are removed or the tool unmounts.
 */
export function useImageBatch(processor: BatchProcessor, settingsKey: string, { enabled = true }: { enabled?: boolean } = {}) {
  const [items, setItems] = useState<BatchItem[]>([]);
  const [running, setRunning] = useState(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const controller = useRef<AbortController | null>(null);
  const processorRef = useRef(processor);
  processorRef.current = processor;
  const [kick, setKick] = useState(0);

  const update = useCallback((id: string, patch: Partial<BatchItem>) => {
    setItems((list) => list.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }, []);

  const start = useCallback(async () => {
    controller.current?.abort();
    const ctrl = new AbortController();
    controller.current = ctrl;
    const todo = itemsRef.current.filter((it) => it.status === 'pending' || it.status === 'working');
    if (todo.length === 0) {
      setRunning(false);
      return;
    }
    setRunning(true);
    try {
      await runBatch(todo, (item, _i, signal) => processorRef.current(item.file, signal), {
        concurrency: 2,
        signal: ctrl.signal,
        onStart: (item) => update(item.id, { status: 'working', error: undefined }),
        onDone: (item, output) => update(item.id, { status: 'done', output, error: undefined }),
        onError: (item, error) =>
          update(item.id, { status: 'error', output: undefined, error: errorMessage(error, 'Could not process this image.') }),
      });
    } catch {
      // Aborted: a newer run replaced this one.
    } finally {
      if (controller.current === ctrl) {
        controller.current = null;
        setRunning(false);
      }
    }
  }, [update]);

  // Reprocess everything when settings change.
  useEffect(() => {
    if (!enabled) return;
    setItems((list) => list.map((it) => ({ ...it, status: 'pending' as const })));
    setKick((k) => k + 1);
  }, [settingsKey, enabled]);

  useEffect(() => {
    if (!enabled || kick === 0) return;
    const t = setTimeout(() => void start(), 120);
    return () => clearTimeout(t);
  }, [kick, enabled, start]);

  const addFiles = useCallback((files: File[]) => {
    const added: BatchItem[] = files.map((file) => ({
      id: `img-${++idSeq}`,
      file,
      thumbUrl: URL.createObjectURL(file),
      status: 'pending',
    }));
    setItems((list) => [...list, ...added]);
    setKick((k) => k + 1);
  }, []);

  const remove = useCallback((id: string) => {
    setItems((list) => {
      const it = list.find((x) => x.id === id);
      if (it) URL.revokeObjectURL(it.thumbUrl);
      return list.filter((x) => x.id !== id);
    });
  }, []);

  const clear = useCallback(() => {
    controller.current?.abort();
    setItems((list) => {
      list.forEach((it) => URL.revokeObjectURL(it.thumbUrl));
      return [];
    });
  }, []);

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setRunning(false);
    setItems((list) =>
      list.map((it) =>
        it.status === 'pending' || it.status === 'working' ? { ...it, status: 'error' as const, error: 'Cancelled.' } : it,
      ),
    );
  }, []);

  const retry = useCallback(() => {
    setItems((list) => list.map((it) => (it.status === 'error' ? { ...it, status: 'pending' as const } : it)));
    setKick((k) => k + 1);
  }, []);

  // Revoke everything on unmount.
  useEffect(
    () => () => {
      controller.current?.abort();
      itemsRef.current.forEach((it) => URL.revokeObjectURL(it.thumbUrl));
    },
    [],
  );

  const done = items.filter((it) => it.status === 'done' || it.status === 'error').length;
  return {
    items,
    addFiles,
    remove,
    clear,
    cancel,
    retry,
    running,
    progress: items.length ? done / items.length : 0,
    doneCount: done,
  };
}
