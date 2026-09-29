// Versioned public paths for engine assets that are loaded by URL at runtime
// (pdf.js fonts/cmaps/wasm, Tesseract worker/core/language data).
//
// The directory names include the library versions, so every file URL is
// immutable: the service worker can cache them "cache first" forever, and a
// dependency upgrade can never serve stale decoders that no longer match the
// JavaScript that loads them. Shared by copy-engine-assets.mjs and vite.config.ts.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function version(pkg) {
  return JSON.parse(readFileSync(join(root, 'node_modules', pkg, 'package.json'), 'utf8')).version;
}

export function engineAssetDirs() {
  return {
    /** Relative to the site root, with a trailing slash, e.g. `pdfjs/6.3.289/`. */
    pdfjs: `pdfjs/${version('pdfjs-dist')}/`,
    ocr: `ocr/${version('tesseract.js')}-core${version('tesseract.js-core')}-eng${version('@tesseract.js-data/eng')}/`,
  };
}
