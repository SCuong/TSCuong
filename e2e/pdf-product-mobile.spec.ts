import { test, expect } from './fixtures';
import { makePdf } from './files';
import { PDFDocument } from 'pdf-lib';
import { readFile } from 'node:fs/promises';
import AxeBuilder from '@axe-core/playwright';

test('toolkit fits small phone, landscape, tablet and desktop with accessible navigation', async ({ page }) => {
  for (const viewport of [{ width: 320, height: 740 }, { width: 740, height: 360 }, { width: 768, height: 1024 }, { width: 1360, height: 900 }]) {
    await page.setViewportSize(viewport); await page.goto('/read/tools');
    await expect(page.getByRole('heading', { name: 'PDF Toolkit', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: /Annotate & sign/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `test-results/pdf-product-${viewport.width}.png` });
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations.filter((issue) => issue.impact === 'critical' || issue.impact === 'serious')).toEqual([]);
  }
});

test('Vietnamese switching updates loaded page controls, metadata and validation messages', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 }); await page.goto('/read/tools/pdf-rotate');
  await page.locator('.pdf-toolkit input[type=file]').first().setInputFiles(await makePdf('Nguyen.pdf', 3));
  await page.getByRole('button', { name: 'Tiếng Việt', exact: true }).click();
  await expect(page.getByRole('img', { name: /Trang 1/ }).first()).toBeVisible();
  await page.getByRole('link', { name: 'Tất cả công cụ PDF' }).click();
  await page.getByRole('link', { name: /Sửa siêu dữ liệu PDF/ }).click();
  await expect(page.getByLabel('Tiêu đề', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/pdf-product-vietnamese-320.png' });
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await expect(page.getByLabel('Title', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'All PDF tools' }).click(); await page.getByRole('link', { name: /PDF to images/i }).click();
  await page.getByRole('button', { name: 'Tiếng Việt', exact: true }).click(); await page.getByRole('radio', { name: 'Khoảng trang', exact: true }).click();
  await page.getByRole('textbox', { name: 'Khoảng trang', exact: true }).fill('100');
  await expect(page.getByText('Trang 100 không tồn tại: tài liệu có 3 trang.', { exact: true })).toBeVisible();
});

test('large raster pages are bounded and a long document renders only nearby reader pages', async ({ page }) => {
  const large = await PDFDocument.create(); large.addPage([8000, 8000]);
  await page.goto('/read/tools/pdf-to-images'); await page.locator('.pdf-toolkit input[type=file]').first().setInputFiles({ name: 'Large page.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await large.save()) });
  await expect(page.getByText(/Rasterized pages are limited to 12 megapixels/)).toBeVisible();
  await page.getByRole('button', { name: 'Convert 1 page', exact: true }).click();
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download', exact: true }).click();
  const png = await readFile((await (await download).path())!);
  expect(png.readUInt32BE(16) * png.readUInt32BE(20)).toBeLessThanOrEqual(12_000_000);
  await page.goto('/read'); await page.getByLabel('Open PDF from device').setInputFiles(await makePdf('Long document.pdf', 200));
  await expect(page.locator('[data-page="1"] canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Jump to page', exact: true }).click(); await page.getByRole('spinbutton', { name: 'Page number' }).fill('150'); await page.getByRole('button', { name: 'Go to page', exact: true }).click();
  await expect(page.locator('[data-page="150"] canvas')).toBeVisible();
  expect(await page.locator('[data-reader-scroller] canvas').count()).toBeLessThanOrEqual(5);
});
