import { buildLineRows, computeDiff, createPatch, type DiffOptions } from './diff';

export type DiffWorkerRequest =
  | { id: number; type: 'diff'; a: string; b: string; options: DiffOptions }
  | { id: number; type: 'patch'; a: string; b: string; oldName: string; newName: string };

self.onmessage = (event: MessageEvent<DiffWorkerRequest>) => {
  const msg = event.data;
  try {
    if (msg.type === 'diff') {
      const result = computeDiff(msg.a, msg.b, msg.options);
      const rows = result.ok && msg.options.mode === 'line' ? buildLineRows(msg.a, msg.b, result.changes) : null;
      self.postMessage({ id: msg.id, type: 'diff', result, rows });
    } else {
      self.postMessage({ id: msg.id, type: 'patch', patch: createPatch(msg.a, msg.b, msg.oldName, msg.newName) });
    }
  } catch (error) {
    self.postMessage({ id: msg.id, type: 'error', error: error instanceof Error ? error.message : 'The comparison failed.' });
  }
};
