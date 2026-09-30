import { readFile } from 'node:fs/promises';
import type { Download, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { makePng } from './files';

async function downloadBuffer(download: Download): Promise<Buffer> {
  const path = await download.path();
  if (!path) throw new Error('download failed');
  return readFile(path);
}

/** Paste a large value in one input event (typing megabytes would take minutes). */
async function pasteInto(page: Page, name: string, value: string) {
  await page.getByRole('textbox', { name, exact: true }).evaluate((el, v) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

/** Milliseconds until the page's main thread runs a trivial script. */
async function mainThreadDelay(page: Page): Promise<number> {
  const started = Date.now();
  await page.evaluate(() => 0);
  return Date.now() - started;
}

test.describe('Find & Replace', () => {
  test('stops a catastrophic regex without freezing, even after a reload, then replaces with groups', async ({ page }) => {
    await page.goto('/tools/text/find-replace');
    await page.getByRole('textbox', { name: 'Input', exact: true }).fill(`${'a'.repeat(32)}b`);
    await page.getByRole('switch', { name: 'Regex' }).click();
    await page.getByLabel('Find', { exact: true }).fill('(a+)+$');
    expect(await mainThreadDelay(page)).toBeLessThan(1000);
    await expect(page.getByText(/took longer than 3 seconds and was stopped/)).toBeVisible();

    // The pattern and text are remembered: reopening the tool must not hang either.
    await page.reload();
    expect(await mainThreadDelay(page)).toBeLessThan(1000);
    await expect(page.getByText(/took longer than 3 seconds and was stopped/)).toBeVisible();

    await page.getByRole('textbox', { name: 'Input', exact: true }).fill('Due 2024-03-15, paid 2025-12-01.');
    await page.getByLabel('Find', { exact: true }).fill('(?<y>\\d{4})-(\\d{2})-(\\d{2})');
    await page.getByLabel('Replace with').fill('$3/$2/$<y> ($&) $$');
    await expect(page.getByRole('textbox', { name: 'Result', exact: true })).toHaveValue('Due 15/03/2024 (2024-03-15) $, paid 01/12/2025 (2025-12-01) $.');
    await expect(page.getByText('2 matches')).toBeVisible();
  });
});

test.describe('Regex tester', () => {
  test('opens a reference pattern, toggles flags and previews named-group replacements', async ({ page }) => {
    await page.goto('/tools/regex/reference');
    const card = page.getByRole('heading', { name: 'Semantic version' }).locator('xpath=ancestor::section[1]');
    await card.getByRole('link', { name: 'Open in tester' }).click();
    await expect(page).toHaveURL(/\/tools\/regex$/);
    await expect(page.getByText('5 matches').first()).toBeVisible();

    await page.getByRole('button', { name: /^d indices/ }).click();
    await expect(page.getByRole('button', { name: /^d indices/ })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('radio', { name: 'Replace' }).click();
    await page.getByLabel('Replace with').fill('v$<major>.$<minor>');
    await expect(page.getByRole('textbox', { name: 'Result', exact: true })).toHaveValue(/^v1\.0\nv0\.2\nv1\.0\nv2\.3\nv1\.0\n/);
  });
});

test.describe('Word Counter', () => {
  test('counts user-perceived characters and stays responsive with a 3 MB paste', async ({ page }) => {
    await page.goto('/tools/text/word-counter');
    await page.getByRole('textbox', { name: 'Text to count', exact: true }).fill('Family 👨\u200d👩\u200d👧 and cafe\u0301.');
    // A Stat is a small box: label on top, value below.
    const stat = (label: string) => page.getByText(label, { exact: true }).locator('xpath=following-sibling::div[1]');
    await expect(stat('Characters')).toHaveText('18');
    await expect(stat('Words')).toHaveText('3');

    // Counting ~3 MB runs in a worker, so the page answers right away. (Emoji-free on purpose: laying out
    // tens of thousands of emoji in the shared monospace text area is slow in its own right.)
    await pasteInto(page, 'Text to count', 'Lorem ipsum dolor sit amet, naïve café. '.repeat(75_000));
    expect(await mainThreadDelay(page)).toBeLessThan(1500);
    await expect(stat('Words')).toHaveText('525,000', { timeout: 20_000 });
  });
});

test.describe('Text Encoding Converter', () => {
  test('detects a Shift_JIS file and saves it as UTF-8', async ({ page }) => {
    await page.goto('/tools/encoding/text-encoding');
    const sjis = Buffer.concat([
      Buffer.from('Subtitle: ', 'ascii'),
      // 日本語のテキスト in Shift_JIS
      Buffer.from([0x93, 0xfa, 0x96, 0x7b, 0x8c, 0xea, 0x82, 0xcc, 0x83, 0x65, 0x83, 0x4c, 0x83, 0x58, 0x83, 0x67]),
      Buffer.from('\r\n', 'ascii'),
    ]);
    await page.locator('main input[type=file]').setInputFiles({ name: 'subtitle.srt', mimeType: 'text/plain', buffer: sjis });
    await expect(page.locator('main li', { hasText: 'best guess' })).toContainText('Shift_JIS (Japanese)');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download converted file' }).click()]);
    expect(download.suggestedFilename()).toBe('subtitle.utf8.srt');
    expect((await downloadBuffer(download)).toString('utf8')).toBe('Subtitle: 日本語のテキスト\r\n');
  });
});

test.describe('Base64 File Encoder', () => {
  test('round-trips a PNG byte for byte', async ({ page }) => {
    const png = makePng('dot.png', 24, 16);
    await page.goto('/tools/encoding/base64-file');
    await page.locator('main input[type=file]').setInputFiles(png);
    const encoded = page.getByRole('textbox', { name: 'Encoded output' });
    await expect(encoded).toHaveValue(`data:image/png;base64,${png.buffer.toString('base64')}`);

    await page.getByRole('radio', { name: 'Base64 → File' }).click();
    await page.getByRole('textbox', { name: 'Base64 or data URL', exact: true }).fill(`data:image/png;base64,${png.buffer.toString('base64')}`);
    await expect(page.getByText('PNG image (image/png)')).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download file' }).click()]);
    expect(download.suggestedFilename()).toBe('decoded.png');
    expect(Buffer.compare(await downloadBuffer(download), png.buffer)).toBe(0);
  });
});

test.describe('Unicode Inspector', () => {
  test('strips exactly the hidden characters it reports and keeps emoji and Persian joiners', async ({ page }) => {
    await page.goto('/tools/encoding/unicode-inspector');
    const input = page.getByRole('textbox', { name: 'Text', exact: true });
    await input.fill('pay\u200bpal 👨\u200d👩\u200d👧 می\u200cخواهم \u202egnp');
    await expect(page.getByText('1 invisible character', { exact: false })).toBeVisible();
    await expect(page.getByText('1 bidirectional control', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Strip invisible characters' }).click();
    await expect(input).toHaveValue('paypal 👨\u200d👩\u200d👧 می\u200cخواهم gnp');
    // Only the mixed-script note (Latin + Arabic) remains.
    await expect(page.locator('main')).not.toContainText('invisible character');
    await expect(page.locator('main')).not.toContainText('bidirectional control');
    await expect(page.getByRole('button', { name: 'Strip invisible characters' })).toHaveCount(0);
  });
});
