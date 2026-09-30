import { readFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import exifr from 'exifr';
import { unzipSync } from 'fflate';
import type { Download, Page } from '@playwright/test';
import { test, expect } from './fixtures';

// ---------------------------------------------------------------------------
// Helpers (fixtures are built in memory; nothing is fetched)
// ---------------------------------------------------------------------------

type Rgba = [number, number, number, number];

async function downloadBuffer(download: Download): Promise<Buffer> {
  const path = await download.path();
  if (!path) throw new Error('download failed');
  return readFile(path);
}

async function saveFrom(page: Page, click: () => Promise<unknown>): Promise<{ name: string; buf: Buffer }> {
  const [download] = await Promise.all([page.waitForEvent('download'), click()]);
  return { name: download.suggestedFilename(), buf: await downloadBuffer(download) };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
/** RGBA PNG from a pixel function. */
function png(width: number, height: number, fn: (x: number, y: number) => Rgba): Buffer {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) raw.set(fn(x, y), y * (width * 4 + 1) + 1 + x * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
const RED: Rgba = [255, 0, 0, 255];
const GREEN: Rgba = [0, 255, 0, 255];
const BLUE: Rgba = [0, 0, 255, 255];
const YELLOW: Rgba = [255, 255, 0, 255];
/** 200×100: red top-left, green top-right, blue bottom-left, yellow bottom-right. */
const quad = () => png(200, 100, (x, y) => (y < 50 ? (x < 100 ? RED : GREEN) : x < 100 ? BLUE : YELLOW));

/** Decode an image with the browser and read pixels at the given points. */
async function pixels(page: Page, buf: Buffer, points: Array<[number, number]>) {
  return page.evaluate(
    async ({ b64, points }) => {
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const bmp = await createImageBitmap(new Blob([bytes]));
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bmp, 0, 0);
      return { width: bmp.width, height: bmp.height, at: points.map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data)) };
    },
    { b64: buf.toString('base64'), points },
  );
}
const near = (actual: number[], expected: number[], tolerance = 6) => actual.every((v, i) => Math.abs(v - expected[i]!) <= tolerance);

/** A JPEG made by the browser (so it is a real, decodable photo). */
async function browserJpeg(page: Page, width = 320, height = 240): Promise<Buffer> {
  const bytes = await page.evaluate(
    async ({ width, height }) => {
      const c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      const ctx = c.getContext('2d')!;
      const g = ctx.createLinearGradient(0, 0, width, height);
      g.addColorStop(0, '#1d4ed8');
      g.addColorStop(1, '#f59e0b');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
      const blob = await new Promise<Blob>((resolve) => c.toBlob((b) => resolve(b!), 'image/jpeg', 0.9));
      return Array.from(new Uint8Array(await blob.arrayBuffer()));
    },
    { width, height },
  );
  return Buffer.from(bytes);
}

/** Big-endian TIFF with Make + a GPS IFD at 48°51'29.4"N 2°17'40"E. */
function gpsTiff(): Buffer {
  const b = Buffer.alloc(152);
  b.write('MM', 0, 'latin1');
  b.writeUInt16BE(42, 2);
  b.writeUInt32BE(8, 4);
  // IFD0 @8: Make, GPS pointer
  b.writeUInt16BE(2, 8);
  const entry = (o: number, tag: number, type: number, count: number, value: number) => {
    b.writeUInt16BE(tag, o);
    b.writeUInt16BE(type, o + 2);
    b.writeUInt32BE(count, o + 4);
    b.writeUInt32BE(value, o + 8);
  };
  entry(10, 0x010f, 2, 4, 0);
  b.write('Cam\0', 18, 'latin1');
  entry(22, 0x8825, 4, 1, 38);
  b.writeUInt32BE(0, 34);
  // GPS IFD @38: 4 entries → rationals @ 38+2+48+4 = 92
  b.writeUInt16BE(4, 38);
  entry(40, 1, 2, 2, 0);
  b.write('N\0', 48, 'latin1');
  entry(52, 2, 5, 3, 92);
  entry(64, 3, 2, 2, 0);
  b.write('E\0', 72, 'latin1');
  entry(76, 4, 5, 3, 116);
  b.writeUInt32BE(0, 88);
  [48, 1, 51, 1, 294, 10, 2, 1, 17, 1, 40, 1].forEach((v, i) => b.writeUInt32BE(v, 92 + i * 4));
  return b;
}

function withExif(jpeg: Buffer): Buffer {
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), gpsTiff()]);
  const seg = Buffer.concat([Buffer.from([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 255]), payload]);
  return Buffer.concat([jpeg.subarray(0, 2), seg, jpeg.subarray(2)]);
}

// ---------------------------------------------------------------------------

test.describe('Image tools (audit)', () => {
  test('converter fills transparency with the chosen color; a batch keeps going past a corrupt file and zips unique names', async ({ page }) => {
    await page.goto('/tools/image/convert');
    await page.getByRole('radio', { name: 'JPG' }).click();
    await page.getByLabel('Background', { exact: true }).fill('#ff00ff');
    const alpha = png(120, 80, (x) => (x < 40 ? [0, 0, 0, 0] : x < 80 ? [0, 0, 255, 128] : RED));
    await page.locator('input[type=file]').first().setInputFiles([
      { name: 'logo.png', mimeType: 'image/png', buffer: alpha },
      { name: 'logo.png', mimeType: 'image/png', buffer: quad() },
      { name: 'broken.png', mimeType: 'image/png', buffer: quad().subarray(0, 120) },
    ]);
    await expect(page.getByText('This file is an unsupported or corrupt image.')).toBeVisible();
    const first = page.getByRole('button', { name: 'Download logo.jpg' }).first();
    await expect(first).toBeVisible();
    const { buf } = await saveFrom(page, () => first.click());
    const img = await pixels(page, buf, [[10, 40], [60, 40], [100, 40]]);
    expect(img).toMatchObject({ width: 120, height: 80 });
    expect(near(img.at[0]!, [255, 0, 255, 255])).toBe(true); // transparent → background
    expect(near(img.at[1]!, [128, 0, 255, 255])).toBe(true); // half-transparent blue over magenta
    expect(near(img.at[2]!, [255, 0, 0, 255])).toBe(true);

    const { buf: zip } = await saveFrom(page, () => page.getByRole('button', { name: 'Download all as ZIP' }).click());
    expect(Object.keys(unzipSync(new Uint8Array(zip))).sort()).toEqual(['logo (2).jpg', 'logo.jpg']);
  });

  test('rotating right then flipping horizontally mirrors the rotated image on screen', async ({ page }) => {
    await page.goto('/tools/image/rotate');
    await page.getByLabel('Output format').selectOption('png');
    await page.getByLabel('Degrees').fill('90');
    await page.getByRole('button', { name: 'Horizontal' }).click();
    await page.locator('input[type=file]').first().setInputFiles([{ name: 'quad.png', mimeType: 'image/png', buffer: quad() }]);
    const { buf } = await saveFrom(page, () => page.getByRole('button', { name: 'Download quad.png' }).click());
    const img = await pixels(page, buf, [[10, 10], [90, 10], [10, 190], [90, 190]]);
    expect(img).toMatchObject({ width: 100, height: 200 });
    // Rotated: blue | red over yellow | green. Mirrored left↔right: red | blue over green | yellow.
    expect(img.at).toEqual([RED, BLUE, GREEN, YELLOW]);
  });

  test('lossy PNG keeps distinct colors and SVGs are pointed to the SVG optimizer', async ({ page }) => {
    await page.goto('/tools/image/compress');
    await page.getByRole('radio', { name: 'PNG (lossy)' }).click();
    await page.getByLabel('Keep original when the result is larger').uncheck();
    await page.locator('input[type=file]').first().setInputFiles([
      { name: 'quad.png', mimeType: 'image/png', buffer: quad() },
      { name: 'icon.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>') },
    ]);
    await expect(page.getByText(/SVG is a vector format.*SVG Optimizer/)).toBeVisible();
    const { buf } = await saveFrom(page, () => page.getByRole('button', { name: 'Download quad.png' }).click());
    expect(buf[25]).toBe(3); // indexed PNG
    const img = await pixels(page, buf, [[10, 10], [190, 10], [10, 90], [190, 90]]);
    expect(img.at).toEqual([RED, GREEN, BLUE, YELLOW]);
  });

  test('remove metadata strips GPS from a JPEG without re-encoding and verifies it', async ({ page }) => {
    await page.goto('/tools/image/remove-metadata');
    const jpeg = await browserJpeg(page);
    const photo = withExif(jpeg);
    expect((await exifr.gps(photo))?.latitude).toBeCloseTo(48.858167, 5);
    await page.locator('input[type=file]').first().setInputFiles([{ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: photo }]);
    const row = page.locator('li', { hasText: 'photo.jpg' });
    await expect(row).toContainText('GPS location');
    await expect(row).toContainText('Location was 48.858167° N, 2.294444° E');
    await expect(row).toContainText('Verified: no EXIF, GPS, XMP, IPTC or text comments left');
    const { buf } = await saveFrom(page, () => page.getByRole('button', { name: 'Download photo.jpg' }).click());
    expect(await exifr.gps(buf).catch(() => undefined)).toBeFalsy();
    expect(buf.includes(Buffer.from('Exif'))).toBe(false);
    // Lossless: the image data after the removed segment is byte-identical.
    expect(buf.equals(jpeg)).toBe(true);
  });

  test('image to data URL keeps SVGs with apostrophes renderable in every snippet', async ({ page }) => {
    await page.goto('/tools/image/to-data-url');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" viewBox="0 0 40 20"><rect width="40" height="20" fill="#f00"/><text font-family="'Open Sans', Arial" y="15">Tom &amp; "Jerry"</text></svg>`;
    await page.locator('input[type=file]').first().setInputFiles([{ name: 'label.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(svg) }]);
    const output = page.locator('textarea').first();
    await expect(output).toHaveValue(/^data:image\/svg\+xml,/);
    const sizeOf = (html: string) =>
      page.evaluate(async (h) => {
        const d = document.createElement('div');
        d.innerHTML = h;
        const img = d.querySelector('img')!;
        await img.decode();
        return `${img.naturalWidth}x${img.naturalHeight}`;
      }, html);
    expect(await sizeOf(`<img src="${(await output.inputValue()).replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">`)).toBe('40x20');
    await page.getByRole('radio', { name: 'HTML <img>' }).click();
    expect(await sizeOf(await output.inputValue())).toBe('40x20');
    await page.getByRole('radio', { name: 'Markdown' }).click();
    await expect(output).toHaveValue(/^!\[label\]\(data:image\/svg\+xml,[^ ()]+\)$/);
  });
});

test.describe('QR and barcodes (audit)', () => {
  test('a Wi-Fi QR code with special characters scans back to the same network and password', async ({ page }) => {
    await page.goto('/tools/qr/generator');
    await page.getByRole('radio', { name: 'Wi-Fi', exact: true }).click();
    await page.getByLabel('Network name (SSID)', { exact: true }).fill('Café;Net,"5G":\\');
    await page.getByLabel('Password', { exact: true }).fill('p@ss;wo,rd:"x"\\');
    await expect(page.getByRole('img', { name: 'Generated QR code' })).toBeVisible();
    const { buf } = await saveFrom(page, () => page.getByRole('button', { name: 'PNG', exact: true }).click());

    await page.goto('/tools/qr/scanner');
    await page.locator('input[type=file]').first().setInputFiles([{ name: 'wifi.png', mimeType: 'image/png', buffer: buf }]);
    const card = page.locator('li').filter({ hasText: 'Wi-Fi network' });
    await expect(card).toContainText('Café;Net,"5G":\\');
    await card.getByRole('button', { name: 'Show password' }).click();
    await expect(card).toContainText('p@ss;wo,rd:"x"\\');
  });

  test('the scanner explains unreadable files and a blocked camera', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: { getUserMedia: () => Promise.reject(new DOMException('denied', 'NotAllowedError')), enumerateDevices: async () => [] },
      });
    });
    await page.goto('/tools/qr/scanner');
    await page.locator('input[type=file]').first().setInputFiles([{ name: 'notes.png', mimeType: 'image/png', buffer: Buffer.from('just text') }]);
    await expect(page.getByText('This file is an unsupported or corrupt image.')).toBeVisible();
    await expect(page.getByText('No code found')).toHaveCount(0);

    await page.getByRole('radio', { name: 'Camera' }).click();
    await page.getByRole('button', { name: 'Start camera' }).click();
    await expect(page.getByText(/Camera access was denied/)).toBeVisible();
  });

  test('EAN-13 check digits are validated and the SVG export is a standalone image', async ({ page }) => {
    await page.goto('/tools/qr/barcode');
    await page.getByLabel('Format').selectOption('EAN13');
    await page.getByLabel('Value').fill('5901234123458');
    await expect(page.getByRole('alert')).toContainText('the last digit should be 7, not 8');
    await expect(page.getByRole('button', { name: 'SVG' })).toBeDisabled();
    await page.getByLabel('Value').fill('590123412345');
    await expect(page.getByText('Check digit 7 added.')).toBeVisible();
    const { name, buf } = await saveFrom(page, () => page.getByRole('button', { name: 'SVG' }).click());
    expect(name).toBe('barcode-ean13.svg');
    const svg = buf.toString();
    expect(svg).toMatch(/^<svg[^>]+xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    expect(svg).toContain('5901234123457'.slice(1, 7));
  });
});
