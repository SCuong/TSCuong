// Copies runtime engine assets that must be served as plain static files
// (never fetched from a CDN) into versioned folders under public/:
//
//   public/<ocr>/worker.min.js                      tesseract.js worker
//   public/<ocr>/core/tesseract-core-*-lstm.wasm.js tesseract core (LSTM-only builds; wasm embedded)
//   public/<ocr>/lang/eng.traineddata.gz            English LSTM model (@tesseract.js-data/eng, best_int)
//   public/<pdfjs>/standard_fonts/*                 pdf.js fonts for PDFs that do not embed the 14 standard fonts
//   public/<pdfjs>/wasm/*.wasm                      pdf.js JPEG 2000 / JBIG2 / colour-management decoders
//   public/<pdfjs>/cmaps/*.bcmap                    pdf.js CJK character maps
//
// <ocr> and <pdfjs> include the library versions (see engine-assets.mjs), so URLs are
// immutable and safe to cache forever. Folders for other versions are removed.
// Idempotent: files are only copied when missing or when their size differs.
// Usage: node scripts/copy-engine-assets.mjs
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineAssetDirs } from './engine-assets.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const nm = join(root, 'node_modules');
const pub = join(root, 'public');
const dirs = engineAssetDirs();

let copied = 0;
let skipped = 0;
let pruned = 0;

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

/** Removes everything under public/<group>/ except the current versioned folder. */
function pruneOtherVersions(versionedDir) {
  const group = join(pub, versionedDir.split('/')[0]);
  const keep = versionedDir.split('/')[1];
  if (!existsSync(group)) return;
  for (const name of readdirSync(group)) {
    if (name === keep) continue;
    rmSync(join(group, name), { recursive: true, force: true });
    pruned++;
  }
}

// --- tesseract.js ----------------------------------------------------------
const ocr = join(pub, dirs.ocr);
pruneOtherVersions(dirs.ocr);
copy(join(nm, 'tesseract.js/dist/worker.min.js'), join(ocr, 'worker.min.js'));
copy(join(nm, 'tesseract.js/LICENSE.md'), join(ocr, 'LICENSE-tesseract.js.md'));
for (const variant of ['tesseract-core-lstm', 'tesseract-core-simd-lstm', 'tesseract-core-relaxedsimd-lstm']) {
  copy(join(nm, `tesseract.js-core/${variant}.wasm.js`), join(ocr, `core/${variant}.wasm.js`));
}
copy(join(nm, 'tesseract.js-core/LICENSE'), join(ocr, 'core/LICENSE'));
copy(join(nm, '@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'), join(ocr, 'lang/eng.traineddata.gz'));

// --- pdf.js ----------------------------------------------------------------
const pdfjs = join(nm, 'pdfjs-dist');
const pdfjsOut = join(pub, dirs.pdfjs);
pruneOtherVersions(dirs.pdfjs);
copyDir(join(pdfjs, 'standard_fonts'), join(pdfjsOut, 'standard_fonts'), () => true);
// Only the decoders pdf.js needs for rendering; the QuickJS sandbox is not used.
copyDir(join(pdfjs, 'wasm'), join(pdfjsOut, 'wasm'), (n) => /^(openjpeg|jbig2|qcms_bg)\.wasm$|^LICENSE/.test(n));
copyDir(join(pdfjs, 'cmaps'), join(pdfjsOut, 'cmaps'), () => true);

console.log(`[copy-engine-assets] ${copied} copied, ${skipped} up to date, ${pruned} stale folders removed (${dirs.ocr}, ${dirs.pdfjs})`);
