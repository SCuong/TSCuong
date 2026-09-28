// Copies runtime engine assets that must be served as plain static files
// (never fetched from a CDN) into public/:
//
//   public/ocr/worker.min.js                     tesseract.js worker
//   public/ocr/core/tesseract-core-*-lstm.wasm.js tesseract core (LSTM-only builds; wasm embedded)
//   public/ocr/lang/eng.traineddata.gz           English LSTM model (@tesseract.js-data/eng, best_int)
//   public/pdfjs/standard_fonts/*                pdf.js fonts for PDFs that do not embed the 14 standard fonts
//   public/pdfjs/wasm/*.wasm                     pdf.js JPEG 2000 / JBIG2 / colour-management decoders
//   public/pdfjs/cmaps/*.bcmap                   pdf.js CJK character maps
//
// Idempotent: files are only copied when missing or when their size differs.
// Usage: node scripts/copy-engine-assets.mjs
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const pub = join(root, 'public');

let copied = 0;
let skipped = 0;

function copy(from, to) {
  if (!existsSync(from)) {
    throw new Error(`Missing ${from}. Run npm install first.`);
  }
  mkdirSync(dirname(to), { recursive: true });
  if (existsSync(to) && statSync(to).size === statSync(from).size) {
    skipped++;
    return;
  }
  copyFileSync(from, to);
  copied++;
}

function copyDir(fromDir, toDir, filter) {
  for (const name of readdirSync(fromDir)) {
    const from = join(fromDir, name);
    if (statSync(from).isDirectory() || !filter(name)) continue;
    copy(from, join(toDir, name));
  }
}

// --- tesseract.js ----------------------------------------------------------
copy(join(nm, 'tesseract.js/dist/worker.min.js'), join(pub, 'ocr/worker.min.js'));
copy(join(nm, 'tesseract.js/LICENSE.md'), join(pub, 'ocr/LICENSE-tesseract.js.md'));
for (const variant of ['tesseract-core-lstm', 'tesseract-core-simd-lstm', 'tesseract-core-relaxedsimd-lstm']) {
  copy(join(nm, `tesseract.js-core/${variant}.wasm.js`), join(pub, `ocr/core/${variant}.wasm.js`));
}
copy(join(nm, 'tesseract.js-core/LICENSE'), join(pub, 'ocr/core/LICENSE'));
copy(join(nm, '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'), join(pub, 'ocr/lang/eng.traineddata.gz'));

// --- pdf.js ----------------------------------------------------------------
const pdfjs = join(nm, 'pdfjs-dist');
copyDir(join(pdfjs, 'standard_fonts'), join(pub, 'pdfjs/standard_fonts'), () => true);
// Only the decoders pdf.js needs for rendering; the QuickJS sandbox is not used.
copyDir(join(pdfjs, 'wasm'), join(pub, 'pdfjs/wasm'), (n) => /^(openjpeg|jbig2|qcms_bg)\.wasm$|^LICENSE/.test(n));
copyDir(join(pdfjs, 'cmaps'), join(pub, 'pdfjs/cmaps'), () => true);

console.log(`[copy-engine-assets] ${copied} copied, ${skipped} up to date`);
