import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { hasOcrPack, prepareOcrPack } from './offlinePack';
const saved = new Map<string, Response>();
beforeEach(() => {
  saved.clear();
  vi.stubGlobal('navigator', { serviceWorker: { controller: {} } });
  vi.stubGlobal('caches', { open: async () => ({ match: async (url: string) => saved.get(url)?.clone(), put: async (url: string, response: Response) => { saved.set(url, response.clone()); } }) });
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => new Response(String(url).endsWith('chunks.json') ? JSON.stringify(['assets/lazy/engine-test.js']) : 'engine bytes')));
});
afterEach(() => vi.unstubAllGlobals());
it('requires a complete pack, including the OCR JavaScript dependency after a reload', async () => {
  expect(await hasOcrPack()).toBe(false);
  await prepareOcrPack(new AbortController().signal, () => {});
  expect(await hasOcrPack()).toBe(true);
  saved.delete(new URL('/assets/lazy/engine-test.js', location.origin).href);
  expect(await hasOcrPack()).toBe(false);
});
it('never declares a partial or cancelled download ready', async () => {
  const controller = new AbortController();
  await expect(prepareOcrPack(controller.signal, () => controller.abort())).rejects.toMatchObject({ name: 'AbortError' });
  expect(await hasOcrPack()).toBe(false);
});
it('requires an installed service worker before preparing the offline pack', async () => {
  vi.stubGlobal('navigator', { serviceWorker: { controller: null } });
  await expect(prepareOcrPack(new AbortController().signal, () => {})).rejects.toThrow('online once');
});
