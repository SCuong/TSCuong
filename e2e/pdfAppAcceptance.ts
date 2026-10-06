import { test, expect } from './fixtures';
import { makePdf } from './files';
import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function add(page: Page, name: string, pages = 2) {
  // Distinct names need distinct bytes: the library correctly deduplicates by SHA-256.
  // URI encoding keeps real Unicode filenames while the fixture's Helvetica text stays WinAnsi-safe.
  await page.getByLabel('Open PDF from device').setInputFiles(await makePdf(name, pages, `Document ${encodeURIComponent(name)}`));
  await expect(page.locator('[data-page="1"] canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Back to library', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Open ' + name, exact: true })).toBeVisible();
}
async function records(page: Page, store: string) {
  return page.evaluate(async (name) => {
    const db = await new Promise<IDBDatabase>((resolve) => { const request = indexedDB.open('localkit-reader'); request.onsuccess = () => resolve(request.result); });
    try { return await new Promise<string[]>((resolve) => { const request = db.transaction(name).objectStore(name).getAllKeys(); request.onsuccess = () => resolve(request.result as string[]); }); }
    finally { db.close(); }
  }, store);
}
export function pdfAppAcceptance() {
  test('PDF-only root, unrelated routes, four destinations and deep links survive refresh', async ({ page, request }) => {
    for (const path of ['/', '/tools/json-formatter', '/category/pdf', '/privacy', '/read/unknown']) {
      await page.goto(path); await expect(page).toHaveURL(/\/read$/);
      await expect(page.getByRole('heading', { name: 'LocalKit PDF', exact: true })).toBeVisible();
      await expect(page.locator('.pdf-bottom-nav a')).toHaveCount(4);
      await expect(page.getByRole('link', { name: 'Back to LocalKit' })).toHaveCount(0);
      await expect(page.locator('.reader-hero, .reader-product-nav, .reader-tabs')).toHaveCount(0);
      await expect(page.getByText('Ready for offline reading', { exact: true })).toHaveCount(0);
    }
    const manifest = await (await request.get('/manifest.webmanifest')).json();
    expect(manifest.name).toBe('LocalKit PDF');
    await page.goto('/read/doc'); await expect(page).toHaveURL(/\/read\/library$/);
    for (const section of ['Library', 'Tools', 'Settings', 'Overview']) {
      await page.getByRole('link', { name: section, exact: true }).click();
      await expect(page.getByRole('link', { name: section, exact: true })).toHaveAttribute('aria-current', 'page');
      await page.reload(); await expect(page.getByRole('link', { name: section, exact: true })).toHaveAttribute('aria-current', 'page');
      if (section === 'Settings') expect((await page.locator('progress').boundingBox())!.height).toBe(6);
    }
    await page.goto('/read/tools/pdf-merge'); await page.reload();
    await expect(page.getByRole('heading', { name: 'Merge PDFs', exact: true }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: 'Tools', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await expect(page.getByText('Ready for offline reading', { exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Overview', exact: true }).click();
    await expect(page.getByText('LocalKit is ready to work offline.', { exact: true })).toHaveCount(0);
  });

  test('recent files, search, favorites, sorting and action sheets operate on real PDFs', async ({ page }) => {
    await page.goto('/'); await add(page, 'Beta.pdf'); await add(page, 'Alpha.pdf', 3);
    await page.getByRole('link', { name: 'Overview', exact: true }).click();
    await expect(page.locator('.pdf-file-title').first()).toHaveText('Alpha.pdf');
    await expect(page.getByRole('button', { name: 'Open Alpha.pdf', exact: true })).toContainText('3 pages');
    await page.getByRole('button', { name: 'Search PDFs', exact: true }).click();
    await expect(page.getByRole('searchbox', { name: 'Find a document' })).toBeFocused();
    await page.getByRole('searchbox', { name: 'Find a document' }).fill('BETA');
    await expect(page.locator('.pdf-file-row')).toHaveCount(1);
    await page.getByRole('button', { name: 'File actions for Beta.pdf' }).click();
    await page.getByRole('dialog').evaluate(async (dialog) => {
      await Promise.all(dialog.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => {})));
    });
    const close = (await page.getByRole('button', { name: 'Close dialog' }).boundingBox())!;
    expect(close.width).toBeGreaterThanOrEqual(44); expect(close.height).toBeGreaterThanOrEqual(44);
    await page.getByRole('button', { name: 'Add favorite', exact: true }).click();
    await page.getByRole('searchbox', { name: 'Find a document' }).fill('');
    await page.getByLabel('Filter files').selectOption('favorites');
    await expect(page.locator('.pdf-file-title')).toHaveText('Beta.pdf');
    await page.reload(); await page.getByLabel('Filter files').selectOption('favorites');
    await expect(page.locator('.pdf-file-title')).toHaveText('Beta.pdf');
    await page.getByLabel('Filter files').selectOption('all'); await page.getByLabel('Sort files').selectOption('name');
    await expect(page.locator('.pdf-file-title')).toHaveText(['Alpha.pdf', 'Beta.pdf']);
    await page.getByRole('button', { name: 'Open Beta.pdf', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Beta.pdf', exact: true })).toBeVisible();
  });

  test('first-page previews persist offline without rendering again and deletion clears their cache', async ({ page, context }) => {
    await page.goto('/'); await add(page, 'Preview.pdf');
    await expect(page.locator('.pdf-file-preview img')).toBeVisible();
    const keys = await records(page, 'thumbnails'); expect(keys).toHaveLength(1);
    const details = await page.locator('.pdf-file-preview img').evaluate((image: HTMLImageElement) => ({ width: image.naturalWidth, height: image.naturalHeight }));
    expect(details.width * details.height).toBeLessThanOrEqual(43_200);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    let workers = 0; page.on('worker', (worker) => { if (/pdf\.worker/.test(worker.url())) workers++; });
    await context.setOffline(true); await page.reload();
    await expect(page.locator('.pdf-file-preview img')).toBeVisible(); expect(workers).toBe(0);
    expect(await records(page, 'thumbnails')).toEqual(keys);
    await page.getByRole('button', { name: 'File actions for Preview.pdf' }).click();
    await page.getByRole('button', { name: 'Remove Preview.pdf', exact: true }).click();
    await page.getByRole('button', { name: 'Remove document', exact: true }).click();
    await expect(page.locator('.pdf-file-row')).toHaveCount(0);
    expect(await records(page, 'thumbnails')).toEqual([]); expect(await records(page, 'documents')).toEqual([]);
    const exists = await page.evaluate(async (id) => { try { await (await (await navigator.storage.getDirectory()).getDirectoryHandle('reader-files')).getFileHandle(id + '.pdf'); return true; } catch { return false; } }, keys[0]);
    expect(exists).toBe(false);
    await context.setOffline(false);
  });

  test('reader hides app navigation and scroll chrome, while controls and deep-link reopening remain available', async ({ page, context }) => {
    await page.goto('/'); await page.getByLabel('Open PDF from device').setInputFiles(await makePdf('Immersive.pdf', 8));
    await expect(page.locator('[data-page="1"] canvas')).toBeVisible();
    await expect(page.locator('.pdf-bottom-nav')).toHaveCount(0);
    if (test.info().project.name === 'mobile') {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 160, y: 440 }] });
      for (const y of [390, 330, 270, 200]) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 160, y }] }); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else { await page.mouse.move(160, 300); await page.mouse.wheel(0, 220); }
    await expect(page.locator('.reader-viewer')).toHaveClass(/reader-immersive/);
    await expect(page.getByRole('button', { name: 'Show reader controls' })).toBeVisible();
    await page.getByRole('button', { name: 'Show reader controls' }).click();
    await expect(page.getByRole('button', { name: 'Back to library' })).toBeVisible();
    await page.reload(); await expect(page.getByRole('heading', { name: 'Immersive.pdf', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back to library' }).click();
    await expect(page.getByRole('link', { name: 'Library', exact: true })).toHaveAttribute('aria-current', 'page');
  });

  test('cache clearing retains favorite previews and removes other thumbnails without losing positions', async ({ page }) => {
    await page.goto('/'); await add(page, 'Favorite.pdf'); await add(page, 'Other.pdf');
    await expect(page.locator('.pdf-file-row')).toHaveCount(2);
    await expect(page.locator('.pdf-file-preview img')).toHaveCount(2);
    await page.getByRole('button', { name: 'File actions for Favorite.pdf' }).click(); await page.getByRole('button', { name: 'Add favorite', exact: true }).click();
    await page.getByRole('link', { name: 'Settings', exact: true }).click(); await page.getByRole('button', { name: 'Clear saved copies except favorites' }).click();
    await page.getByRole('link', { name: 'Library', exact: true }).click();
    await expect(page.locator('.pdf-file-preview img')).toHaveCount(1);
    expect(await records(page, 'thumbnails')).toHaveLength(1); expect(await records(page, 'documents')).toHaveLength(2);
    await expect(page.getByRole('button', { name: 'Open Other.pdf', exact: true })).toContainText('Pick file to reopen');
  });

  test('an existing version-two library upgrades with PDFs, bookmarks and form drafts preserved', async ({ page }) => {
    const fixture = await makePdf('Legacy.pdf', 4);
    await page.addInitScript(async (bytes: number[]) => {
      const source = new Uint8Array(bytes);
      const hash = await crypto.subtle.digest('SHA-256', source);
      const id = Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
      const request = indexedDB.open('localkit-reader', 2);
      request.onupgradeneeded = () => { request.result.createObjectStore('documents', { keyPath: 'id' }); request.result.createObjectStore('edits', { keyPath: 'id' }); };
      request.onsuccess = async () => {
        const db = request.result;
        const directory = await (await navigator.storage.getDirectory()).getDirectoryHandle('reader-files', { create: true });
        const stream = await (await directory.getFileHandle(id + '.pdf', { create: true })).createWritable(); await stream.write(source); await stream.close();
        const tx = db.transaction(['documents', 'edits'], 'readwrite');
        tx.objectStore('documents').put({ id, name: 'Legacy.pdf', size: source.length, pages: 4, page: 3, offset: 0, bookmarks: [2], favorite: true, cached: true, lastOpened: Date.now() });
        tx.objectStore('edits').put({ id, marks: [], forms: { Name: 'Saved draft' }, updated: Date.now() });
        tx.oncomplete = () => db.close();
      };
    }, [...fixture.buffer]);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Open Legacy.pdf', exact: true })).toBeVisible();
    await expect(page.locator('.pdf-file-preview img')).toBeVisible();
    expect(await records(page, 'edits')).toHaveLength(1);
    await page.getByRole('button', { name: 'Open Legacy.pdf', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Jump to page', exact: true })).toHaveText('3 / 4');
    await page.getByRole('button', { name: 'Pages', exact: true }).click(); await page.getByRole('button', { name: 'Bookmarks', exact: true }).click();
    await expect(page.locator('.reader-bookmarks')).toContainText('Page 2');
  });

  test('compact populated app fits phone, landscape and tablet widths with accessible navigation', async ({ page }) => {
    await page.goto('/'); await add(page, 'Daily notes.pdf');
    for (const viewport of [{ width: 320, height: 740 }, { width: 360, height: 780 }, { width: 390, height: 844 }, { width: 412, height: 915 }, { width: 740, height: 360 }, { width: 768, height: 1024 }]) {
      await page.setViewportSize(viewport);
      for (const section of ['Overview', 'Library', 'Tools', 'Settings']) {
        await page.getByRole('link', { name: section, exact: true }).click();
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
        const bounds = (await page.getByRole('link', { name: section, exact: true }).boundingBox())!;
        expect(bounds.width).toBeGreaterThanOrEqual(44); expect(bounds.height).toBeGreaterThanOrEqual(46);
        if (viewport.width === 320) {
          const a11y = await new AxeBuilder({ page }).analyze();
          expect(a11y.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
        }
      }
      await page.getByRole('link', { name: 'Overview', exact: true }).click();
      await page.screenshot({ path: `test-results/pdf-standalone-${viewport.width}.png` });
      expect((await page.getByRole('button', { name: 'Open Daily notes.pdf' }).boundingBox())!.y).toBeLessThan(280);
    }
  });

  test('Vietnamese app navigation, file information and appearance persist without a reload', async ({ page }) => {
    await page.goto('/'); await add(page, 'Tài liệu.pdf');
    await page.getByRole('link', { name: 'Settings', exact: true }).click();
    await page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('dark');
    await page.getByRole('combobox', { name: 'Reading paper', exact: true }).selectOption('sepia');
    await page.getByRole('button', { name: 'Tiếng Việt', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Cài đặt', exact: true })).toBeVisible();
    await page.getByRole('link', { name: 'Tổng quan', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Thêm gần đây', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mở Tài liệu.pdf', exact: true })).toContainText('2 trang');
    await page.getByRole('button', { name: 'Mở Tài liệu.pdf', exact: true }).click();
    await expect(page.locator('.reader-viewer')).toHaveClass(/reader-mode-sepia/);
    expect(await page.locator('html').getAttribute('data-theme')).toBe('dark');
  });
}
