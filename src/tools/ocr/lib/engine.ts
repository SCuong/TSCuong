/**
 * tesseract.js wrapper. Every engine file (worker script, WebAssembly core and
 * the English model) is served from this site's versioned /ocr/<versions>/ folder
 * (see scripts/engine-assets.mjs): nothing is fetched from a CDN. Only English
 * ("eng") recognition data is bundled.
 */
import Tesseract from 'tesseract.js';
import { cleanText, flattenBlocks, meanConfidence, type OcrPageResult, type TesseractBlock } from './result';
import { PendingJobs, cancelledError } from './cancellable';

export const OCR_LANGUAGE = 'eng';

function assetBase(): string {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
  return new URL(`${base}${__OCR_ASSET_DIR__}`, window.location.origin).href;
}

export type OcrProgress = (fraction: number, status: string) => void;

const STATUS: Record<string, string> = {
  'loading tesseract core': 'Loading the OCR engine',
  'initializing tesseract': 'Starting the OCR engine',
  'loading language traineddata': 'Loading English language data',
  'initializing api': 'Preparing recognition',
  'recognizing text': 'Recognizing text',
};

export interface OcrEngine {
  /** Rejects with an AbortError when the engine is terminated while recognizing. */
  recognize: (image: HTMLCanvasElement | Blob, onProgress?: OcrProgress) => Promise<OcrPageResult>;
  terminate: () => Promise<void>;
}

/** PNG (or the blob's own) bytes of the image to recognize. */
async function encodeImage(image: HTMLCanvasElement | Blob): Promise<Uint8Array> {
  const blob =
    image instanceof Blob
      ? image
      : await new Promise<Blob>((resolve, reject) =>
          image.toBlob((b) => (b ? resolve(b) : reject(new Error('The image is too large to process in this browser.'))), 'image/png'),
        );
  return new Uint8Array(await blob.arrayBuffer());
}

/** Create a tesseract worker. Call terminate() when done (or to cancel). */
export async function createOcrEngine(onLoadProgress?: OcrProgress): Promise<OcrEngine> {
  const base = assetBase();
  let current: OcrProgress | undefined = onLoadProgress;
  let worker: Tesseract.Worker;
  try {
    worker = await Tesseract.createWorker(OCR_LANGUAGE, 1 /* OEM.LSTM_ONLY */, {
      workerPath: `${base}worker.min.js`,
      corePath: `${base}core`,
      langPath: `${base}lang`,
      gzip: true,
      cacheMethod: 'none',
      workerBlobURL: false,
      logger: (m) => current?.(typeof m.progress === 'number' ? m.progress : 0, STATUS[m.status] ?? m.status),
      errorHandler: () => {},
    });
  } catch (error) {
    throw new Error(
      `The OCR engine could not start${error instanceof Error && error.message ? ` (${error.message})` : ''}. Make sure the page finished loading and try again.`,
      { cause: error },
    );
  }
  let terminated = false;
  const pending = new PendingJobs();
  return {
    async recognize(image, onProgress) {
      if (terminated) throw cancelledError();
      current = onProgress;
      // tesseract.js encodes a canvas or blob asynchronously *before* posting the job to its
      // worker; a terminate() in that window makes it post to a null worker (an unhandled
      // rejection). Encode here instead, and never start a job once the engine is terminated.
      const bytes = await encodeImage(image);
      if (terminated) throw cancelledError();
      const { data } = await pending.track(worker.recognize(bytes as unknown as Tesseract.ImageLike, {}, { text: true, blocks: true }));
      const lines = flattenBlocks(data.blocks as unknown as TesseractBlock[]);
      const words = lines.flatMap((l) => l.words);
      let width = 0;
      let height = 0;
      if (image instanceof HTMLCanvasElement) {
        width = image.width;
        height = image.height;
      }
      return {
        text: cleanText(data.text ?? ''),
        confidence: words.length ? meanConfidence(words) : 0,
        lines,
        width,
        height,
      };
    },
    async terminate() {
      if (terminated) return;
      terminated = true;
      current = undefined;
      // Settle in-flight recognitions first: tesseract.js never settles them after terminate().
      pending.cancelAll();
      await worker.terminate().catch(() => {});
    },
  };
}
