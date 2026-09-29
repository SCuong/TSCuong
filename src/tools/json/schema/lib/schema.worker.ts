import { generateSchema, type GenerateSchemaResult } from './generate';
import { runValidation, type ValidationJob, type ValidationRun } from './validate';

export type SchemaWorkerRequest = ({ kind: 'validate' } & ValidationJob) | { kind: 'generate'; doc: string };
export type SchemaWorkerResult =
  | { kind: 'validate'; run: ValidationRun }
  | { kind: 'generate'; result: GenerateSchemaResult }
  | { kind: 'error'; message: string };

self.onmessage = (event: MessageEvent<SchemaWorkerRequest & { id: number }>) => {
  const { id, ...request } = event.data;
  let result: SchemaWorkerResult;
  try {
    if (request.kind === 'generate') result = { kind: 'generate', result: generateSchema(request.doc) };
    else result = { kind: 'validate', run: runValidation(request) };
  } catch {
    result = { kind: 'error', message: 'Something went wrong while processing this schema.' };
  }
  self.postMessage({ id, result });
};
