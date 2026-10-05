const paths = ['worker.min.js', 'core/tesseract-core-lstm.wasm.js', 'core/tesseract-core-simd-lstm.wasm.js', 'core/tesseract-core-relaxedsimd-lstm.wasm.js', 'lang/eng.traineddata.gz'];
const urls = () => paths.map((path) => new URL(import.meta.env.BASE_URL + __OCR_ASSET_DIR__ + path, location.origin).href);
const marker = () => new URL(import.meta.env.BASE_URL + __OCR_ASSET_DIR__ + '.localkit-complete.json', location.origin).href;
export async function hasOcrPack() {
  if (!('caches' in window)) return false;
  const cache = await caches.open('localkit-engines');
  const saved = await cache.match(marker());
  if (!saved) return false;
  const chunks = await saved.json() as string[];
  return (await Promise.all([...urls(), ...chunks].map((url) => cache.match(url)))).every(Boolean);
}
/** Cache the versioned engine, all CPU variants and language data explicitly, with cancellable downloads. */
export async function prepareOcrPack(signal: AbortSignal, progress: (fraction: number) => void) {
  if (!navigator.serviceWorker?.controller) throw new Error('Open the installed application online once, then reload before preparing offline OCR.');
  const cache = await caches.open('localkit-engines');
  const files = urls();
  for (const [index, url] of files.entries()) {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (!await cache.match(url)) {
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error('An OCR file could not be downloaded. Check your connection and try again.');
      await cache.put(url, response);
    }
    progress((index + 1) / (files.length + 1));
  }
  // Use the build's dependency graph, not resource timing (which can overflow or omit already imported modules).
  const manifest = await fetch(new URL(import.meta.env.BASE_URL + __OCR_ASSET_DIR__ + 'chunks.json', location.origin), { signal });
  if (!manifest.ok) throw new Error('An OCR file could not be downloaded. Check your connection and try again.');
  const names = await manifest.json() as string[];
  const chunks = names.map((name) => new URL(import.meta.env.BASE_URL + name, location.origin).href);
  for (const url of new Set(chunks)) {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (!await cache.match(url)) { const response = await fetch(url, { signal }); if (!response.ok) throw new Error('An OCR file could not be downloaded. Check your connection and try again.'); await cache.put(url, response); }
  }
  await cache.put(marker(), new Response(JSON.stringify([...new Set(chunks)]), { headers: { 'Content-Type': 'application/json' } }));
  progress(1);
}
