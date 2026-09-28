import type { PdfErrorData } from './errors';
import type { OpArgs, OpName } from './ops';

export interface WorkerRequest<K extends OpName = OpName> {
  op: K;
  args: OpArgs<K>;
}

export type WorkerResponse =
  | { type: 'progress'; value: number; label?: string }
  | { type: 'result'; result: unknown }
  | { type: 'error'; error: PdfErrorData };
