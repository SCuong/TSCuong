import { test, expect } from './fixtures';
import { makePdf, type FilePayload } from './files';
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { PDFDocument, PDFDict, PDFName, PDFNumber } from 'pdf-lib';

async function download(page: Page) { const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download', exact: true }).click(); return readFile((await (await pending).path())!); }
test('AES-256 protects a PDF, wrong passwords fail, and unlocking preserves selectable content', async ({ page }) => {
  const original = await makePdf('Private.pdf', 2, 'Private meeting');
  await page.goto('/read/tools/pdf-protection');
  await page.locator('.pdf-toolkit input[type=file]').first().setInputFiles(original);
  await page.getByLabel('New PDF password', { exact: true }).fill('Strong password 2026');
  await page.getByLabel('Confirm PDF password', { exact: true }).fill('Strong password 2026');
  await page.getByRole('button', { name: 'Export password-protected copy' }).click();
  await expect(page.getByRole('button', { name: 'Download', exact: true })).toBeVisible();
  const protectedBytes = await download(page);
  const raw = await PDFDocument.load(protectedBytes, { ignoreEncryption: true });
  const encryption = raw.context.lookup(raw.context.trailerInfo.Encrypt!, PDFDict);
  expect(encryption.lookup(PDFName.of('V'), PDFNumber).asNumber()).toBe(5);
  expect(encryption.lookup(PDFName.of('R'), PDFNumber).asNumber()).toBe(6);
  expect(encryption.lookup(PDFName.of('Length'), PDFNumber).asNumber()).toBe(256);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const bad = pdfjs.getDocument({ data: new Uint8Array(protectedBytes), password: 'wrong', verbosity: 0 });
  await expect(bad.promise).rejects.toThrow(); await bad.destroy();
  const correct = pdfjs.getDocument({ data: new Uint8Array(protectedBytes), password: 'Strong password 2026', verbosity: 0 }); const doc = await correct.promise;
  expect(doc.numPages).toBe(2); expect(((await doc.getMetadata()).info as Record<string, unknown>).EncryptFilterName).toBe('Standard'); await correct.destroy();
  await expect(page.getByLabel('New PDF password', { exact: true })).toHaveValue('');
  const protectedFile: FilePayload = { name: 'Protected.pdf', mimeType: 'application/pdf', buffer: protectedBytes };
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await page.locator('.pdf-toolkit input[type=file]').first().setInputFiles(protectedFile);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('Strong password 2026');
  await page.getByRole('button', { name: 'Open PDF', exact: true }).click();
  await page.getByRole('button', { name: 'Export unlocked copy' }).click();
  const plain = await download(page);
  const opened = pdfjs.getDocument({ data: new Uint8Array(plain), verbosity: 0 }); const unlocked = await opened.promise;
  const text = await (await unlocked.getPage(1)).getTextContent();
  expect(text.items.map((item) => 'str' in item ? item.str : '').join(' ')).toContain('Private meeting page 1');
  expect(((await unlocked.getMetadata()).info as Record<string, unknown>).EncryptFilterName).toBeFalsy(); await opened.destroy();
  await page.screenshot({ path: 'test-results/pdf-protection-mobile.png' });
});

test('changing AES passwords preserves forms and encrypted form filling saves real values', async ({ page }) => {
  const source = await PDFDocument.create(); const paper = source.addPage([595, 842]);
  source.getForm().createTextField('Your name').addToPage(paper, { x: 50, y: 700, width: 300, height: 30 });
  const file = { name: 'Private form.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await source.save()) };
  await page.goto('/read/tools/pdf-protection'); await page.locator('.pdf-toolkit input[type=file]').first().setInputFiles(file);
  const protect = async (password: string) => { await page.getByLabel('New PDF password', { exact: true }).fill(password); await page.getByLabel('Confirm PDF password', { exact: true }).fill(password); await page.getByRole('button', { name: 'Export password-protected copy' }).click(); return download(page); };
  const first = await protect('First secret 2026');
  await page.getByRole('button', { name: 'Change', exact: true }).click(); await page.locator('.pdf-toolkit input[type=file]').first().setInputFiles({ ...file, buffer: first });
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('First secret 2026'); await page.getByRole('button', { name: 'Open PDF', exact: true }).click();
  const second = await protect('Second secret 2026');
  await page.goto('/read/tools/pdf-forms'); await page.locator('.pdf-toolkit input[type=file]').first().setInputFiles({ ...file, buffer: second });
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill('Second secret 2026'); await page.getByRole('button', { name: 'Open PDF', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your name', exact: true }).fill('Daily use'); await page.getByRole('button', { name: 'Export filled copy' }).click();
  const filled = await download(page); const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const wrong = pdfjs.getDocument({ data: new Uint8Array(filled), password: 'First secret 2026', verbosity: 0 }); await expect(wrong.promise).rejects.toThrow(); await wrong.destroy();
  const task = pdfjs.getDocument({ data: new Uint8Array(filled), password: 'Second secret 2026', verbosity: 0 }); const pdf = await task.promise;
  expect((await (await pdf.getPage(1)).getAnnotations()).find((widget) => widget.fieldName === 'Your name')?.fieldValue).toBe('Daily use'); await task.destroy();
});
