import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { makePdf } from './files';

// The service worker only exists in the production build (`vite build` + `vite preview`).
test.skip(Boolean(process.env.E2E_DEV), 'PWA checks need the production build');

async function waitForServiceWorkerControl(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // The first load is not controlled yet; a reload hands the page to the worker.
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}

test('ships a valid web app manifest with installable icons', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const res = await request.get(href!);
  expect(res.ok()).toBe(true);
  const manifest = (await res.json()) as {
    name: string;
    short_name: string;
    start_url: string;
    display: string;
    icons: Array<{ src: string; sizes: string; purpose?: string }>;
  };
  expect(manifest.name).toContain('LocalKit');
  expect(manifest.display).toBe('standalone');
  expect(manifest.start_url).toBe('/');
  const sizes = manifest.icons.map((i) => i.sizes);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
  expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  for (const icon of manifest.icons) expect((await request.get(icon.src)).ok()).toBe(true);
});

test('the app shell and core tools keep working offline', async ({ page, context }) => {
  await page.goto('/');
  await waitForServiceWorkerControl(page);

  await context.setOffline(true);
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

  await page.goto('/tools/json-formatter');
  const input = page.getByRole('textbox', { name: 'Input JSON', exact: true });
  await input.click();
  await input.fill('{"offline":true}');
  await expect(page.getByRole('textbox', { name: 'Formatted', exact: true })).toContainText('"offline": true');

  // Client-side routes that were never visited are still served from the precached shell.
  await page.goto('/tools/text/case-converter');
  await expect(page.getByRole('heading', { level: 1, name: 'Case Converter' })).toBeVisible();
  await context.setOffline(false);
});

const engines: Array<{ name: string; route: string; use: (page: Page) => Promise<void> }> = [
  {
    name: 'Mermaid',
    route: '/tools/diagrams',
    use: async (page) => {
      await expect(page.getByRole('img', { name: 'Diagram preview' }).locator('svg')).toBeVisible({ timeout: 30_000 });
    },
  },
  {
    name: 'SQLite (WebAssembly + worker)',
    route: '/tools/sqlite',
    use: async (page) => {
      await page.getByRole('button', { name: 'Load sample database' }).click();
      await expect(page.getByRole('button', { name: /^customers \d+$/ })).toBeVisible({ timeout: 30_000 });
    },
  },
  {
    name: 'pdf-lib worker',
    route: '/tools/pdf/merge',
    use: async (page) => {
      await page.locator('input[type=file]').first().setInputFiles([await makePdf('a.pdf', 1), await makePdf('b.pdf', 1)]);
      await page.getByRole('button', { name: 'Merge PDFs' }).click();
      await expect(page.getByText('Merged 2 pages from 2 files')).toBeVisible({ timeout: 30_000 });
    },
  },
];

for (const engine of engines) {
  test(`${engine.name} keeps working offline after its first use`, async ({ page, context }) => {
    await page.goto('/');
    await waitForServiceWorkerControl(page);

    // First use online downloads the engine; the service worker caches it.
    await page.goto(engine.route);
    await engine.use(page);

    await context.setOffline(true);
    await page.reload();
    await engine.use(page);
    await context.setOffline(false);
  });
}
