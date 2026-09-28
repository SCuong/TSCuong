/**
 * Lazy zxing-wasm reader. The WebAssembly binary is served from this app
 * (Vite `?url` import), never from a CDN.
 */
import wasmUrl from 'zxing-wasm/reader/zxing_reader.wasm?url';
import type { ReaderOptions, ReadResult } from 'zxing-wasm/reader';

export type { ReadResult };

type ReaderModule = typeof import('zxing-wasm/reader');

let ready: Promise<ReaderModule> | null = null;

export function loadReader(): Promise<ReaderModule> {
  if (!ready) {
    ready = (async () => {
      const mod = await import('zxing-wasm/reader');
      await mod.prepareZXingModule({
        overrides: {
          locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? wasmUrl : prefix + path),
        },
        fireImmediately: true,
      });
      return mod;
    })();
    ready.catch(() => {
      ready = null;
    });
  }
  return ready;
}

export const SCAN_FORMATS: NonNullable<ReaderOptions['formats']> = [
  'QRCode',
  'MicroQRCode',
  'RMQRCode',
  'DataMatrix',
  'Aztec',
  'PDF417',
  'EAN13',
  'EAN8',
  'UPCA',
  'UPCE',
  'Code128',
  'Code39',
  'Code93',
  'ITF',
  'Codabar',
  'DataBar',
  'DataBarExp',
];

export async function scan(input: Blob | ImageData, fast = false): Promise<ReadResult[]> {
  const mod = await loadReader();
  const results = await mod.readBarcodes(input, {
    formats: SCAN_FORMATS,
    tryHarder: !fast,
    tryRotate: !fast,
    tryInvert: true,
    tryDownscale: true,
    maxNumberOfSymbols: fast ? 4 : 16,
  });
  return results.filter((r) => r.isValid);
}

export function formatLabel(format: string): string {
  const labels: Record<string, string> = {
    QRCode: 'QR Code',
    MicroQRCode: 'Micro QR',
    RMQRCode: 'rMQR',
    DataMatrix: 'Data Matrix',
    Aztec: 'Aztec',
    PDF417: 'PDF417',
    EAN13: 'EAN-13',
    EAN8: 'EAN-8',
    UPCA: 'UPC-A',
    UPCE: 'UPC-E',
    Code128: 'Code 128',
    Code39: 'Code 39',
    Code93: 'Code 93',
    ITF: 'ITF',
    Codabar: 'Codabar',
    DataBar: 'DataBar',
    DataBarExp: 'DataBar Expanded',
  };
  return labels[format] ?? format;
}
