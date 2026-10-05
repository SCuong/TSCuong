import { test, expect } from './fixtures';
import { makePdf, makePng, pdfPageCount } from './files';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { unzipSync } from 'fflate';
import type { Page } from '@playwright/test';

async function download(page: Page, name = 'Download') { const pending = page.waitForEvent('download'); await page.getByRole('button', { name, exact: true }).click(); return readFile((await (await pending).path())!); }
async function upload(page: Page, id: string, pages = 3) { await page.goto('/read/tools/' + id); await page.locator('.pdf-toolkit input[type=file]').first().setInputFiles(await makePdf('Toolkit.pdf', pages)); }

test('reader hands its original to the touch organizer and reads the exported copy', async ({ page }) => {
  await page.goto('/read');
  await page.getByLabel('Open PDF from device').setInputFiles(await makePdf('Original.pdf', 4));
  await expect(page.getByRole('heading', { name: 'Original.pdf', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Reading options', exact: true }).click();
  await page.getByRole('button', { name: 'Edit and export this PDF' }).click();
  await page.getByRole('link', { name: /Organize pages/i }).click();
  await expect(page.getByText('Original.pdf', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Duplicate Page 1', exact: true }).click();
  await page.getByRole('button', { name: 'Save PDF', exact: true }).click();
  await page.getByRole('button', { name: 'Read exported PDF' }).click();
  await expect(page.getByRole('heading', { name: 'Original-organized.pdf', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Jump to page', exact: true })).toHaveText('1 / 5');
  await page.getByRole('button', { name: 'Back to library' }).click();
  await expect(page.getByText('Original.pdf', { exact: true })).toBeVisible();
  await expect(page.getByText('Original-organized.pdf', { exact: true })).toBeVisible();
});

for (const operation of [
  { id: 'pdf-page-numbers', button: 'Add page numbers' },
  { id: 'pdf-watermark', button: 'Add watermark' },
  { id: 'pdf-compress', button: 'Compress PDF' },
  { id: 'pdf-crop', button: 'Crop pages' },
  { id: 'pdf-metadata', button: 'Save metadata' },
]) {
  test(`${operation.id} has a working small-phone export`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await upload(page, operation.id);
    if (operation.id === 'pdf-crop') await page.getByLabel('Top (mm)', { exact: true }).fill('10');
    if (operation.id === 'pdf-metadata') await page.getByLabel('Title', { exact: true }).fill('Updated on my phone');
    await page.getByRole('button', { name: operation.button, exact: true }).click();
    const result = await PDFDocument.load(await download(page));
    expect(result.getPageCount()).toBe(3);
    if (operation.id === 'pdf-crop') expect(result.getPage(0).getCropBox().height).toBeLessThan(842);
    if (operation.id === 'pdf-metadata') expect(result.getTitle()).toBe('Updated on my phone');
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  });
}
test('merge, split, extract and delete support real phone file/page selection', async ({ page }) => {
  await page.goto('/read/tools/pdf-merge');
  await page.locator('.pdf-toolkit input[type=file]').first().setInputFiles([await makePdf('One.pdf', 2), await makePdf('Two.pdf', 1)]);
  await page.getByRole('button', { name: 'Merge PDFs', exact: true }).click();
  expect(await pdfPageCount(await download(page))).toBe(3);
  await upload(page, 'pdf-split');
  await page.getByRole('button', { name: 'Split PDF', exact: true }).click();
  const archive = unzipSync(await download(page, 'Download all (ZIP)'));
  expect(Object.keys(archive)).toHaveLength(3);
  for (const file of Object.values(archive)) expect(await pdfPageCount(Buffer.from(file))).toBe(1);
  await upload(page, 'pdf-extract-pages');
  await page.getByRole('button', { name: 'Page 1', exact: true }).click();
  await page.getByRole('button', { name: 'Page 3', exact: true }).click();
  await page.getByRole('button', { name: 'Extract pages', exact: true }).click();
  expect(await pdfPageCount(await download(page))).toBe(2);
  await upload(page, 'pdf-delete-pages');
  await page.getByRole('button', { name: 'Page 2', exact: true }).click();
  await page.getByRole('button', { name: 'Delete 1 page', exact: true }).click();
  await page.getByRole('button', { name: 'Delete pages', exact: true }).click();
  expect(await pdfPageCount(await download(page))).toBe(2);
});
test('images become PDF pages, and PDF images/text can be exported and inspected', async ({ page }) => {
  await page.goto('/read/tools/pdf-from-images');
  await page.locator('.pdf-toolkit input[type=file]').first().setInputFiles([makePng('Photo.png'), makePng('Photo2.png')]);
  await page.getByRole('button', { name: 'Create PDF (2 pages)', exact: true }).click();
  const imagePdf = await download(page);
  expect(await pdfPageCount(imagePdf)).toBe(2);
  await page.goto('/read/tools/pdf-extract-images');
  await page.locator('.pdf-toolkit input[type=file]').first().setInputFiles({ name: 'Photos.pdf', mimeType: 'application/pdf', buffer: imagePdf });
  await page.getByRole('button', { name: 'Extract images', exact: true }).click();
  await expect(page.getByRole('list', { name: 'Extracted images' })).toBeVisible();
  expect((await download(page)).subarray(1, 4).toString()).toBe('PNG');
  await upload(page, 'pdf-to-images', 1);
  await page.getByRole('button', { name: 'Convert 1 page', exact: true }).click();
  expect((await download(page)).subarray(1, 4).toString()).toBe('PNG');
  await upload(page, 'pdf-extract-text', 2);
  await page.getByRole('button', { name: 'Extract text', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Extracted text', exact: true })).toContainText('Toolkit.pdf page 2');
  await upload(page, 'pdf-inspector', 2);
  await expect(page.getByRole('heading', { name: 'Document information' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Structure', exact: true })).toBeVisible();
});
test('native touch organizer reorders pages and accessible controls stay reachable', async ({ page, context }) => {
  await upload(page, 'pdf-organize', 4);
  const grid = page.getByRole('list', { name: 'Pages in the new document' });
  await expect(grid.locator('img').first()).toBeVisible();
  const grip = grid.locator('[data-drag-handle]').first();
  await grip.scrollIntoViewIfNeeded();
  const a = (await grip.boundingBox())!;
  const b = (await grid.locator('li').nth(1).boundingBox())!;
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const start = { x: a.x + a.width / 2, y: a.y + a.height / 2 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + 10, y: start.y + 5 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + b.width / 2 + 15, y: Math.min(600, b.y + b.height / 2) }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByText('Page 1 moved to position 2 of 4.')).toBeAttached();
  await page.getByRole('button', { name: 'Save PDF', exact: true }).click();
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(await download(page)), verbosity: 0 });
  const doc = await task.promise; const content = await (await doc.getPage(1)).getTextContent();
  expect(content.items.map((item) => 'str' in item ? item.str : '').join()).toContain('page 2'); await task.destroy();
  await page.screenshot({ path: 'test-results/pdf-organizer-touch-mobile.png' });
});

test('mobile rotate exports a valid new PDF and small-phone workspaces do not overflow', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto('/read/tools/pdf-rotate');
  await page.locator('.pdf-toolkit input[type=file]').first().setInputFiles(await makePdf('Rotate.pdf', 3));
  await page.getByRole('button', { name: /^Rotate 3 pages/ }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download', exact: true }).click();
  const result = await downloaded;
  expect(await pdfPageCount(await readFile((await result.path())!))).toBe(3);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
  await page.screenshot({ path: 'test-results/pdf-toolkit-rotate-mobile.png', fullPage: true });
});
