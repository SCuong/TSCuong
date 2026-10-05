import { test, expect } from './fixtures';
import { readingPdf } from './reader-fixtures';
import { makePdf, type FilePayload } from './files';
import { encryptRc4 } from '../src/tools/pdf/lib/fixtures.test-util';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function open(page: Page, file?: FilePayload) {
  await page.goto('/read');
  await page.getByLabel('Open PDF from device').setInputFiles(file ?? (await readingPdf()));
  await expect(page.getByRole('heading', { name: file?.name ?? 'Reading guide.pdf', exact: true })).toBeVisible();
  await expect(page.locator('[data-page="1"] canvas')).toBeVisible();
}
async function jump(page: Page, n: number) {
  await page.getByRole('button', { name: 'Jump to page', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Page number' }).fill(String(n));
  await page.getByRole('button', { name: 'Go to page', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Jump to page', exact: true })).toHaveText(n + ' / 12');
}
async function waitForSW(page: Page) {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}

test('polished library and full reader fit the phone, with real selectable text', async ({ page }) => {
  await page.goto('/read');
  await expect(page.getByRole('heading', { name: 'PDF Reader', exact: true })).toBeVisible();
  await expect(page.getByText('Your next read starts here')).toBeVisible();
  await page.screenshot({ path: 'test-results/reader-library-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await open(page);
  await expect(page.locator('[data-page="1"] .textLayer')).toContainText('A quieter way to read');
  expect(
    await page.locator('[data-reader-scroller]').evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
  const selected = await page
    .locator('[data-page="1"] .textLayer span')
    .filter({ hasText: 'A quieter way to read' })
    .evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      return selection.toString();
    });
  expect(selected).toBe('A quieter way to read');
  await page.evaluate(() => getSelection()?.removeAllRanges());
  await page.screenshot({ path: 'test-results/reader-document-mobile.png' });
  const a11y = await new AxeBuilder({ page }).analyze();
  expect(a11y.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
});

test('jump, favorites, page bookmarks, thumbnails and contents work and survive reopen', async ({ page }) => {
  await open(page);
  await jump(page, 5);
  await page.getByRole('button', { name: 'Bookmark this page' }).click();
  await page.getByRole('button', { name: 'Reading options', exact: true }).click();
  await page.getByRole('button', { name: 'Add favorite', exact: true }).click();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Go to page 5', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Bookmarks', exact: true }).click();
  await page.getByRole('button', { name: 'Page 5', exact: true }).click();
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await page.getByRole('button', { name: 'Contents', exact: true }).click();
  await page.getByRole('button', { name: 'Start reading' }).click();
  await expect(page.getByRole('button', { name: 'Jump to page', exact: true })).toHaveText('1 / 12');
  await jump(page, 5);
  await page.getByRole('button', { name: 'Back to library' }).click();
  await page.getByRole('button', { name: 'Favorites', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reading guide.pdf' })).toBeVisible();
  await expect(page.getByText('Page 5 of 12')).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /^PDF Reading guide\.pdf/ }).click();
  await expect(page.getByRole('button', { name: 'Jump to page', exact: true })).toHaveText('5 / 12');
  await expect(page.getByRole('button', { name: 'Remove page bookmark' })).toBeVisible();
});

test('search highlights matches, navigates both ways and handles no results', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Search document' }).click();
  await page.getByRole('searchbox', { name: 'Search in PDF' }).fill('documents close');
  await expect(page.getByText('1 of 12 matches')).toBeVisible();
  await expect(page.locator('.lk-hit-active').first()).toBeVisible();
  await page.getByRole('button', { name: 'Next match' }).click();
  await expect(page.getByText('2 of 12 matches')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Jump to page', exact: true })).toHaveText('2 / 12');
  await page.getByRole('button', { name: 'Previous match' }).click();
  await expect(page.getByText('1 of 12 matches')).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search in PDF' }).fill('absent query');
  await expect(page.getByText('No matches found')).toBeVisible();
  await page.getByRole('button', { name: 'Close search' }).click();
  await expect(page.getByRole('searchbox', { name: 'Search in PDF' })).toBeHidden();
});

test('double tap and pinch re-render sharply, fit modes and night reading work', async ({ page }) => {
  await open(page);
  const surface = page.locator('[data-reader-scroller]');
  await surface.tap({ position: { x: 180, y: 240 } });
  await surface.tap({ position: { x: 180, y: 240 } });
  await expect(page.getByRole('button', { name: 'Zoom and appearance' })).toContainText('200%');
  await expect
    .poll(() => page.locator('[data-page="1"] canvas').evaluate((el: HTMLCanvasElement) => el.width))
    .toBeGreaterThan(1300);
  const touchSession = await page.context().newCDPSession(page);
  await touchSession.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [
      { x: 150, y: 300, id: 1 },
      { x: 250, y: 300, id: 2 },
    ],
  });
  for (let step = 1; step <= 5; step++) {
    await touchSession.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: 150 - step * 10, y: 300, id: 1 },
        { x: 250 + step * 10, y: 300, id: 2 },
      ],
    });
  }
  await touchSession.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await touchSession.detach();
  await expect(page.getByRole('button', { name: 'Zoom and appearance' })).toContainText('400%');
  await page.getByRole('button', { name: 'Reading options', exact: true }).click();
  await page.getByRole('button', { name: 'Fit page', exact: true }).click();
  await page.getByRole('button', { name: 'Night', exact: true }).click();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.locator('.reader-viewer')).toHaveClass(/reader-mode-night/);
  await expect(page.getByRole('button', { name: 'Zoom and appearance' })).toContainText('100%');
  await page.getByRole('button', { name: 'Reading options', exact: true }).click();
  await page.getByRole('button', { name: 'Fit width', exact: true }).click();
  await page.getByRole('button', { name: 'Sepia', exact: true }).click();
  await page.getByRole('button', { name: 'Immersive reading', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Show reader controls' })).toBeVisible();
  await page.getByRole('button', { name: 'Show reader controls' }).click();
  await expect(page.getByRole('button', { name: 'Back to library' })).toBeVisible();
});

test('mixed page sizes, rotation and large documents remain virtualized', async ({ page }) => {
  await open(page, await readingPdf(300, { mixed: true }));
  await page.getByRole('button', { name: 'Jump to page', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Page number' }).fill('2');
  await page.getByRole('button', { name: 'Go to page', exact: true }).click();
  await expect(page.locator('[data-page="2"] canvas')).toBeVisible();
  expect(
    await page.locator('[data-reader-scroller]').evaluate((el) => el.scrollWidth - el.clientWidth),
  ).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: 'Jump to page', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Page number' }).fill('250');
  await page.getByRole('button', { name: 'Go to page', exact: true }).click();
  await expect(page.locator('[data-page="250"] canvas')).toBeVisible();
  expect(await page.locator('.reader-paper').count()).toBeLessThanOrEqual(6);
  await page.setViewportSize({ width: 915, height: 412 });
  await expect(page.getByRole('button', { name: 'Jump to page', exact: true })).toHaveText('250 / 300');
  expect(await page.locator('.reader-paper').count()).toBeLessThanOrEqual(6);
  await page.screenshot({ path: 'test-results/reader-landscape.png' });
});

test('evicted file re-pick restores fingerprint position and manual removal deletes OPFS', async ({ page }) => {
  const file = await readingPdf();
  await open(page, file);
  await jump(page, 7);
  await page.getByRole('button', { name: 'Back to library' }).click();
  await page.getByRole('button', { name: 'Reader settings' }).click();
  await page.getByRole('button', { name: 'Clear saved copies except favorites' }).click();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByText('Pick file to reopen')).toBeVisible();
  await page.getByLabel('Open PDF from device').setInputFiles({ ...file, name: 'Renamed.pdf' });
  await expect(page.getByRole('heading', { name: 'Renamed.pdf', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Jump to page', exact: true })).toHaveText('7 / 12');
  await page.getByRole('button', { name: 'Back to library' }).click();
  await page.getByRole('button', { name: 'Remove Renamed.pdf' }).click();
  await page.getByRole('button', { name: 'Remove document', exact: true }).click();
  await expect(page.getByText('Your next read starts here')).toBeVisible();
  expect(
    await page.evaluate(async () => {
      const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle('reader-files');
      let count = 0;
      for await (const _entry of (folder as unknown as { values(): AsyncIterable<unknown> }).values()) count++;
      return count;
    }),
  ).toBe(0);
});

test('restores the scroll offset within a page after a full reload', async ({ page }) => {
  await open(page);
  const scroller = page.locator('[data-reader-scroller]');
  await scroller.evaluate((el) => {
    el.scrollTop = 350;
  });
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          new Promise<number>((resolve, reject) => {
            const request = indexedDB.open('localkit-reader', 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result;
              const get = db.transaction('documents', 'readonly').objectStore('documents').getAll();
              get.onsuccess = () => {
                resolve(get.result[0]?.offset ?? 0);
                db.close();
              };
            };
          }),
      ),
    )
    .toBeGreaterThan(0.3);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Reading guide.pdf', exact: true })).toBeVisible();
  await expect.poll(async () => Math.abs((await scroller.evaluate((el) => el.scrollTop)) - 350)).toBeLessThan(3);
});

test('handles corrupt files, cancellation and PDFs with no text or contents', async ({ page }) => {
  await page.goto('/read');
  await page
    .getByLabel('Open PDF from device')
    .setInputFiles({ name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') });
  await expect(page.getByRole('alert')).toContainText('not a PDF');
  await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
  await open(page, await readingPdf(12, { outline: false, scanned: true }));
  await page.getByRole('button', { name: 'Pages', exact: true }).click();
  await page.getByRole('button', { name: 'Contents', exact: true }).click();
  await expect(page.getByText('This PDF has no table of contents. Use thumbnails or jump to a page.')).toBeVisible();
  await page.getByRole('button', { name: 'Bookmarks', exact: true }).click();
  await expect(page.getByText(/Bookmark a page with the ribbon/)).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Search document' }).click();
  await page.getByRole('searchbox', { name: 'Search in PDF' }).fill('text');
  await expect(page.getByText('No matches found')).toBeVisible();
});

test('password-protected PDFs open with a retry and never save passwords', async ({ page }) => {
  const plain = await makePdf('protected.pdf', 3);
  const encrypted = await encryptRc4(new Uint8Array(plain.buffer), 'secret', 'owner');
  await page.goto('/read');
  await page.getByLabel('Open PDF from device').setInputFiles({ ...plain, buffer: Buffer.from(encrypted) });
  await expect(page.getByRole('dialog', { name: 'Password required' })).toBeVisible();
  await page.getByLabel('PDF password', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Unlock PDF' }).click();
  await expect(page.getByRole('alert')).toContainText('not correct');
  await page.getByLabel('PDF password', { exact: true }).fill('secret');
  await page.getByRole('button', { name: 'Unlock PDF' }).click();
  await expect(page.getByRole('heading', { name: 'protected.pdf', exact: true })).toBeVisible();
  await expect(page.locator('[data-page="1"] canvas')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('dialog', { name: 'Password required' })).toBeVisible();
});

test('Vietnamese library and reader fit the phone and translate controls', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('localkit:locale', 'vi'));
  await page.goto('/read');
  await expect(page.getByRole('heading', { name: 'Trình đọc PDF' })).toBeVisible();
  await page
    .getByLabel('Mở PDF từ thiết bị')
    .setInputFiles({ name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not PDF') });
  await expect(page.getByRole('alert')).toContainText('không phải PDF hợp lệ');
  await page.getByLabel('Mở PDF từ thiết bị').setInputFiles(await readingPdf());
  await expect(page.getByRole('button', { name: 'Về thư viện' })).toBeVisible();
  await page.getByRole('button', { name: 'Tùy chọn đọc', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Vừa chiều rộng' })).toBeVisible();
  await page.screenshot({ path: 'test-results/reader-vietnamese.png' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});

test('production PWA precaches PDF engine: first-ever PDF opens offline and persists after reload', async ({
  page,
  context,
}) => {
  test.skip(Boolean(process.env.E2E_DEV), 'Needs the production service worker');
  await page.goto('/');
  await waitForSW(page);
  await context.setOffline(true);
  await page.goto('/read');
  await page.getByLabel('Open PDF from device').setInputFiles(await readingPdf());
  await expect(page.getByRole('heading', { name: 'Reading guide.pdf', exact: true })).toBeVisible();
  await expect(page.locator('[data-page="1"] canvas')).toBeVisible();
  await jump(page, 8);
  await page.getByRole('button', { name: 'Back to library' }).click();
  await expect(page.getByRole('heading', { name: 'PDF Reader', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: /^PDF Reading guide\.pdf/ }).click();
  await expect(page.getByRole('button', { name: 'Jump to page', exact: true })).toHaveText('8 / 12');
  await expect(page.locator('[data-page="8"] canvas')).toBeVisible();
  await context.setOffline(false);
});

test('offline Share Target POST is intercepted locally, opens PDF and cleans the staging copy', async ({
  page,
  context,
  request,
}) => {
  test.skip(Boolean(process.env.E2E_DEV), 'Needs the production service worker');
  await page.goto('/read');
  await waitForSW(page);
  const manifest = await (await request.get('/manifest.webmanifest')).json();
  expect(manifest.start_url).toBe('/');
  expect(manifest.shortcuts[0].url).toBe('/read');
  expect(manifest.share_target.action).toBe('/read/share');
  const file = await readingPdf();
  await context.setOffline(true);
  const bytes = [...file.buffer];
  await page.evaluate((bytes) => {
    // Android's Share Target is a navigation POST, not an AJAX fetch.
    const form = document.createElement('form');
    form.action = '/read/share';
    form.method = 'POST';
    form.enctype = 'multipart/form-data';
    const input = document.createElement('input');
    input.type = 'file';
    input.name = 'pdf';
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], 'Shared.pdf', { type: 'application/pdf' }));
    input.files = transfer.files;
    form.append(input);
    document.body.append(form);
    form.submit();
  }, bytes);
  await expect(page.getByRole('heading', { name: 'Shared.pdf', exact: true })).toBeVisible();
  await expect(page.locator('[data-page="1"] canvas')).toBeVisible();
  expect(
    await page.evaluate(async () => {
      const folder = await (await navigator.storage.getDirectory()).getDirectoryHandle('reader-incoming');
      let count = 0;
      for await (const _entry of (folder as unknown as { values(): AsyncIterable<unknown> }).values()) count++;
      return count;
    }),
  ).toBe(0);
  await context.setOffline(false);
});
