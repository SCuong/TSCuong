/// <reference lib="webworker" />
import { processImage, type ImageJob } from './pipeline';
import { ImageError } from './canvas';

export interface WorkerRequest {
  id: number;
  file: Blob;
  job: ImageJob;
}

export type WorkerResponse =
  | { id: number; ok: true; blob: Blob; width: number; height: number; format: string; sourceFormat: string; sourceWidth: number; sourceHeight: number }
  | { id: number; ok: false; error: string; fallback?: boolean };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, file, job } = event.data;
  try {
    const r = await processImage(file, job);
    const msg: WorkerResponse = { id, ok: true, ...r };
    scope.postMessage(msg);
  } catch (error) {
    const known = error instanceof ImageError;
    const message = error instanceof Error ? error.message : String(error);
    // Anything the worker cannot do (SVG rendering, missing OffscreenCanvas features)
    // is retried on the main thread.
    const fallback = !known || /main thread|Canvas is not available/.test(message);
    const msg: WorkerResponse = { id, ok: false, error: message, fallback };
    scope.postMessage(msg);
  }
};
