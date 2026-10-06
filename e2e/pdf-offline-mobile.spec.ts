import { test, expect } from './fixtures';
import { makePdf } from './files';
import { PDFDocument } from 'pdf-lib';
import type { Page } from '@playwright/test';
async function installed(page: Page) {
  await page.goto('/read'); await page.evaluate(async () => { await navigator.serviceWorker.ready; }); await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
}
async function scan(page: Page) {
  const png = await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 1200; canvas.height = 320; const ctx = canvas.getContext('2d')!; ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1200, 320); ctx.fillStyle = 'black'; ctx.font = '54px Arial'; ctx.fillText('LocalKit invoice 12345', 50, 100); ctx.fillText('The quick brown fox', 50, 220); return canvas.toDataURL('image/png').split(',')[1]; });
  const doc = await PDFDocument.create(); const image = await doc.embedPng(Buffer.from(png, 'base64')); doc.addPage([600, 300]).drawImage(image, { x: 0, y: 70, width: 600, height: 160 });
  return { pdf: { name: 'Scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) }, png: { name: 'Scan.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') } };
}
test('toolkit and AES-256 engine work on their first use entirely offline', async ({ page, context }) => {
  await installed(page); await context.setOffline(true);
  await page.goto('/read/tools/pdf-organize'); await page.locator('.pdf-toolkit input[type=file]').first().setInputFiles(await makePdf('Offline.pdf', 3));
  await page.getByRole('button', { name: 'Duplicate Page 1', exact: true }).click(); await page.getByRole('button', { name: 'Save PDF', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Read exported PDF' })).toBeVisible();
  await page.getByRole('link', { name: 'All PDF tools' }).click();
  await page.getByRole('link', { name: /PDF passwords/ }).click();
  await expect(page.getByText('Offline.pdf', { exact: true })).toBeVisible();
  await page.getByLabel('New PDF password', { exact: true }).fill('Offline secret 2026'); await page.getByLabel('Confirm PDF password', { exact: true }).fill('Offline secret 2026');
  await page.getByRole('button', { name: 'Export password-protected copy' }).click();
  await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeVisible();
  await page.reload(); await page.locator('.pdf-toolkit input[type=file]').first().setInputFiles(await makePdf('Again.pdf', 1));
  await expect(page.getByText('This PDF currently has no password protection.')).toBeVisible();
});
test('prepared OCR recognizes images and creates a searchable scanned PDF offline', async ({ page, context }) => {
  test.setTimeout(150000);
  await installed(page); const fixture = await scan(page);
  await page.getByRole('link', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Prepare English OCR for offline use' }).click();
  await expect(page.getByRole('button', { name: 'English OCR is ready offline' })).toBeVisible({ timeout: 90000 });
  await page.getByRole('link', { name: 'Overview', exact: true }).click(); await context.setOffline(true);
  await page.goto('/read/tools/image-ocr'); await page.locator('.pdf-toolkit input[type=file]').first().setInputFiles(fixture.png);
  // Image OCR starts immediately after choosing an image.
  await expect(page.getByRole('textbox', { name: 'Recognized text', exact: true })).toContainText('invoice 12345', { timeout: 60000 });
  await page.goto('/read/tools/pdf-ocr'); await page.locator('.pdf-toolkit input[type=file]').first().setInputFiles(fixture.pdf);
  await page.getByRole('button', { name: 'Run OCR on 1 page', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Recognized text', exact: true })).toContainText('invoice 12345', { timeout: 60000 });
  await page.getByRole('button', { name: 'Read exported PDF' }).click();
  await expect(page.locator('.textLayer')).toContainText('invoice');
  await page.reload(); await expect(page.getByRole('heading', { name: 'Scan-searchable.pdf', exact: true })).toBeVisible();
  await expect(page.locator('.textLayer')).toContainText('invoice');
});
