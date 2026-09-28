/**
 * tesseract.js wrapper. Every engine file (worker script, WebAssembly core and
 * the English model) is served from this site's /ocr/ folder: nothing is
 * fetched from a CDN. Only English ("eng") recognition data is bundled.
 */
import Tesseract from 'tesseract.js';
import { cleanText, flattenBlocks, meanConfidence, type OcrPageResult, type TesseractBlock } from './result';

export const OCR_LANGUAGE = 'eng';

function assetBase(): string {
  const base = import.meta.env.BASE_URL.replace(/\/?$/, '/');
  return new URL(`${base}ocr/`, window.location.origin).href;
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
  recognize: (image: HTMLCanvasElement | Blob, onProgress?: OcrProgress) => Promise<OcrPageResult>;
  terminate: () => Promise<void>;
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
  return {
    async recognize(image, onProgress) {
      current = onProgress;
      const { data } = await worker.recognize(image, {}, { text: true, blocks: true });
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
      await worker.terminate().catch(() => {});
    },
  };
}
