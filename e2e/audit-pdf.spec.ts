import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import type { Download, Page } from '@playwright/test';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFString,
  StandardFonts,
  decodePDFRawStream,
  type PDFObject,
} from 'pdf-lib';
import { test, expect } from './fixtures';
import { makePdf, type FilePayload } from './files';

// ---------------------------------------------------------------------------
// Helpers

async function downloadBuffer(download: Download): Promise<Buffer> {
  const path = await download.path();
  if (!path) throw new Error('download failed');
  return readFile(path);
}

async function downloadResult(page: Page): Promise<Buffer> {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download', exact: true }).click()]);
  return downloadBuffer(download);
}

/** Text of each page, read back with pdf.js (the same engine the app uses). */
async function pageTexts(buffer: Buffer, password?: string): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer), password, verbosity: 0 });
  const doc = await task.promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    out.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' ').replace(/\s+/g, ' ').trim());
  }
  await task.destroy();
  return out;
}

/** Every object in the file, reachable or not, as text (streams decoded). */
async function everyObjectText(buffer: Buffer): Promise<string> {
  const doc = await PDFDocument.load(buffer, { updateMetadata: false, ignoreEncryption: true });
  const parts: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream) {
      parts.push(obj.dict.toString());
      try {
        parts.push(Buffer.from(decodePDFRawStream(obj).decode()).toString('latin1'));
      } catch {
        parts.push(Buffer.from(obj.contents).toString('latin1'));
      }
    } else {
      parts.push(obj.toString());
    }
  }
  return parts.join('\n');
}

const md5 = (...parts: Uint8Array[]) => {
  const h = createHash('md5');
  for (const p of parts) h.update(p);
  return h.digest();
};
function rc4(key: Uint8Array, data: Uint8Array): Buffer {
  const s = Uint8Array.from({ length: 256 }, (_, i) => i);
  for (let i = 0, j = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
  }
  const out = Buffer.alloc(data.length);
  for (let k = 0, i = 0, j = 0; k < data.length; k++) {
    i = (i + 1) & 255;
    j = (j + s[i]) & 255;
    [s[i], s[j]] = [s[j], s[i]];
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255];
  }
  return out;
}
const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex');
const padPassword = (pw: string) => Buffer.concat([Buffer.from(pw, 'latin1').subarray(0, 32), PAD]).subarray(0, 32);

/** A PDF protected with the standard security handler (RC4 128-bit, revision 3). */
async function encryptedPdf(name: string, userPassword: string, ownerPassword: string): Promise<FilePayload> {
  const plain = await makePdf('plain.pdf', 3, 'Protected');
  const doc = await PDFDocument.load(plain.buffer, { updateMetadata: false });
  const ctx = doc.context;
  const id = md5(Buffer.from(name));
  let h = md5(padPassword(ownerPassword || userPassword));
  for (let i = 0; i < 50; i++) h = md5(h.subarray(0, 16));
  const ownerKey = h.subarray(0, 16);
  let o = rc4(ownerKey, padPassword(userPassword));
  for (let i = 1; i <= 19; i++) o = rc4(ownerKey.map((b) => b ^ i), o);
  const perms = -3904;
  const p = Buffer.alloc(4);
  p.writeInt32LE(perms);
  let k = md5(padPassword(userPassword), o, p, id);
  for (let i = 0; i < 50; i++) k = md5(k.subarray(0, 16));
  const key = k.subarray(0, 16);
  let u = rc4(key, md5(PAD, id));
  for (let i = 1; i <= 19; i++) u = rc4(key.map((b) => b ^ i), u);
  const encrypt = (value: PDFObject, okey: Uint8Array): PDFObject => {
    if (value instanceof PDFString || value instanceof PDFHexString) return PDFHexString.of(rc4(okey, value.asBytes()).toString('hex'));
    if (value instanceof PDFDict) for (const [n, v] of value.entries()) value.set(n, encrypt(v, okey));
    if (value instanceof PDFArray) for (let i = 0; i < value.size(); i++) value.set(i, encrypt(value.get(i), okey));
    return value;
  };
  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    const n = Buffer.alloc(5);
    n.writeUIntLE(ref.objectNumber, 0, 3);
    n.writeUIntLE(ref.generationNumber, 3, 2);
    const okey = md5(key, n).subarray(0, 16);
    if (obj instanceof PDFRawStream) {
      encrypt(obj.dict, okey);
      ctx.assign(ref, PDFRawStream.of(obj.dict, rc4(okey, obj.contents)));
    } else {
      encrypt(obj, okey);
    }
  }
  const dict = ctx.obj({ Filter: 'Standard', V: 2, R: 3, Length: 128, P: PDFNumber.of(perms) });
  dict.set(PDFName.of('O'), PDFHexString.of(o.toString('hex')));
  dict.set(PDFName.of('U'), PDFHexString.of(Buffer.concat([u, Buffer.alloc(16)]).toString('hex')));
  ctx.trailerInfo.Encrypt = ctx.register(dict);
  ctx.trailerInfo.ID = ctx.obj([PDFHexString.of(id.toString('hex')), PDFHexString.of(id.toString('hex'))]);
  return { name, mimeType: 'application/pdf', buffer: Buffer.from(await doc.save({ useObjectStreams: false })) };
}

/** Pages that contain only an image of text (no text layer), rendered by the browser. */
async function scannedPdf(page: Page, pages: number): Promise<FilePayload> {
  const png = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1400;
    c.height = 500;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#000';
    g.font = '52px Arial';
    g.fillText('The quick brown fox jumps over', 60, 120);
    g.fillText('the lazy dog. Invoice 12345 total', 60, 220);
    return c.toDataURL('image/png').split(',')[1];
  });
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(Buffer.from(png, 'base64'));
  for (let i = 0; i < pages; i++) doc.addPage([700, 450]).drawImage(img, { x: 0, y: 100, width: 700, height: 250 });
  return { name: 'scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) };
}

// ---------------------------------------------------------------------------

test.describe('PDF tools (audit)', () => {
  test('extract pages keeps a reversed range order and never offers a stale result', async ({ page }) => {
    await page.goto('/tools/pdf/extract-pages');
    await page.locator('input[type=file]').first().setInputFiles([await makePdf('doc.pdf', 5)]);
    await page.getByRole('radio', { name: 'Page range' }).click();
    const range = page.getByLabel('Page range');
    await range.fill('1-3,5,7-');
    await expect(page.getByText('Page 7 does not exist: the document has 5 pages.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Extract pages' })).toBeDisabled();

    await range.fill('last-2, 1');
    await page.getByRole('button', { name: 'Extract pages' }).click();
    await expect(page.getByText('Extracted 5 pages')).toBeVisible();
    expect(await pageTexts(await downloadResult(page))).toEqual([5, 4, 3, 2, 1].map((n) => `doc.pdf page ${n}`));

    // Changing the selection hides the old file instead of relabelling it.
    await range.fill('odd');
    await expect(page.getByRole('button', { name: 'Download', exact: true })).toHaveCount(0);
    await expect(page.getByText(/Extracted \d+ pages?/)).toHaveCount(0);
  });

  test('organize: keyboard moves are announced, undo hides the saved file, output order is right', async ({ page }) => {
    await page.goto('/tools/pdf/organize');
    await page.locator('input[type=file]').first().setInputFiles([await makePdf('doc.pdf', 4)]);
    const grid = page.getByRole('list', { name: 'Pages in the new document' });
    await grid.getByRole('button', { name: 'Page 1', exact: true }).focus();
    await page.keyboard.press('Alt+ArrowRight');
    await expect(page.getByText('Page 1 moved to position 2 of 4.')).toBeAttached();
    await expect(grid.getByRole('button', { name: 'Page 1', exact: true })).toBeFocused();

    await page.getByRole('button', { name: 'Blank page' }).click();
    await page.getByRole('button', { name: 'Save PDF' }).click();
    await expect(page.getByText('Organized PDF with 5 pages')).toBeVisible();
    const saved = await downloadResult(page);
    expect(await pageTexts(saved)).toEqual(['doc.pdf page 2', 'doc.pdf page 1', 'doc.pdf page 3', 'doc.pdf page 4', '']);

    // Undo changes the grid: the file saved before must not be offered as the current document.
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByText(/Organized PDF with/)).toHaveCount(0);
  });

  test('metadata: custom properties are listed and "remove all" leaves no old values in the file', async ({ page }) => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 300]).drawText('x', { font: await doc.embedFont(StandardFonts.Helvetica) });
    doc.setTitle('Quarterly report');
    doc.setAuthor('Jane Secret');
    const info = doc.context.lookup(doc.context.trailerInfo.Info) as PDFDict;
    info.set(PDFName.of('Company'), PDFString.of('Secret Corp'));
    const xmp = doc.context.stream('<x:xmpmeta><dc:creator>Jane Secret (XMP)</dc:creator></x:xmpmeta>', { Type: 'Metadata', Subtype: 'XML' });
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(xmp));
    const file = { name: 'report.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await doc.save()) };

    await page.goto('/tools/pdf/metadata');
    await page.locator('input[type=file]').first().setInputFiles([file]);
    await expect(page.getByLabel('Author')).toHaveValue('Jane Secret');
    await expect(page.getByText('Custom properties (kept as they are)')).toBeVisible();
    await expect(page.getByText('Secret Corp')).toBeVisible();

    await page.getByRole('button', { name: 'Remove all metadata' }).click();
    await page.getByRole('button', { name: 'Remove metadata' }).click();
    await expect(page.getByText('PDF saved without metadata')).toBeVisible();
    const text = await everyObjectText(await downloadResult(page));
    for (const old of ['Quarterly report', 'Jane Secret', 'Secret Corp']) expect(text).not.toContain(old);
  });

  test('encrypted PDFs: rotation keeps the file readable with its password; copy tools warn; inspector works', async ({ page }) => {
    const protectedPdf = await encryptedPdf('locked.pdf', 'secret', 'owner');
    const openWithPassword = async () => {
      await page.locator('input[type=file]').first().setInputFiles([protectedPdf]);
      await page.getByLabel('Password', { exact: true }).fill('secret');
      await page.getByRole('button', { name: 'Open PDF' }).click();
    };

    await page.goto('/tools/pdf/rotate');
    await openWithPassword();
    await expect(page.getByText('The edited copy keeps the same protection, so it opens with the same password.')).toBeVisible();
    await page.getByRole('button', { name: 'Rotate 3 pages' }).click();
    const rotated = await downloadResult(page);
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = pdfjs.getDocument({ data: new Uint8Array(rotated), password: 'secret', verbosity: 0 });
    const out = await task.promise;
    expect(out.numPages).toBe(3);
    expect((await out.getPage(1)).rotate).toBe(90);
    await task.destroy();
    expect(await pageTexts(rotated, 'secret')).toEqual([1, 2, 3].map((n) => `Protected page ${n}`));

    await page.goto('/tools/pdf/split');
    await openWithPassword();
    await expect(page.getByText(/Pages copied out of an encrypted PDF come out blank or unreadable/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Split PDF' })).toBeDisabled();

    await page.goto('/tools/pdf/inspector');
    await openWithPassword();
    await expect(page.getByText('Standard · open password')).toBeVisible();
    await expect(page.getByText('Allowed')).toBeVisible();
  });

  test('viewer: full-text search over a 300-page document finishes promptly', async ({ page }) => {
    await page.goto('/tools/pdf/viewer');
    await page.locator('input[type=file]').first().setInputFiles([await makePdf('long.pdf', 300)]);
    await page.getByLabel('Search in document').fill('long.pdf page 297');
    // The index used to restart every 20 pages (quadratic); it must now finish well within this timeout.
    await expect(page.getByText('1 / 1', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('Page number')).toHaveValue('297');
  });

  test('OCR PDF: recognizes text from local engine files and cancel returns to idle mid-recognition', async ({ page }) => {
    test.setTimeout(150_000);
    const external: string[] = [];
    page.on('request', (r) => {
      const url = r.url();
      if (!/^(http:\/\/localhost|blob:|data:)/.test(url)) external.push(url);
    });
    await page.goto('/tools/pdf/ocr');
    // Enough pages that recognition is certainly still running when Cancel is clicked.
    const scan = await scannedPdf(page, 40);
    await page.locator('input[type=file]').first().setInputFiles([scan]);

    await page.getByRole('button', { name: 'Run OCR on 40 pages' }).click();
    await expect(page.getByRole('progressbar', { name: /Recognizing page/ })).toBeVisible({ timeout: 90_000 });
    await page.getByRole('button', { name: 'Cancel' }).click();
    // Cancelling used to leave the job hanging forever (tesseract.js never settles jobs of a terminated worker).
    await expect(page.getByRole('progressbar')).toHaveCount(0, { timeout: 5_000 });
    await expect(page.getByRole('button', { name: 'Run OCR on 40 pages' })).toBeEnabled();
    await expect(page.getByText('Searchable PDF ready')).toHaveCount(0);

    await page.getByRole('radio', { name: 'Page range' }).click();
    await page.getByLabel('Page range').fill('1');
    await page.getByRole('button', { name: 'Run OCR on 1 page' }).click();
    await expect(page.getByRole('textbox', { name: 'Recognized text' })).toHaveValue(/quick brown fox/i, { timeout: 90_000 });
    const searchable = await pageTexts(await downloadResult(page));
    expect(searchable[0]).toMatch(/quick brown fox/i);
    expect(external).toEqual([]);
  });
});
