import { readFile } from 'node:fs/promises';
import type { Download, Locator, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { imageSize, makePdf, makePng, pdfPageCount } from './files';

async function downloadBuffer(download: Download): Promise<Buffer> {
  const path = await download.path();
  if (!path) throw new Error('download failed');
  return readFile(path);
}

async function fillEditor(page: Page, name: string, value: string) {
  const editor = page.getByRole('textbox', { name, exact: true });
  await editor.click();
  await editor.fill(value);
}

test.describe('JSON formatter', () => {
  test('formats, minifies and reports invalid JSON with its position', async ({ page }) => {
    await page.goto('/tools/json-formatter');
    await fillEditor(page, 'Input JSON', '{"b":1,"a":[1,2,{"c":null}],"s":"héllo 👋"}');
    await expect(page.getByRole('textbox', { name: 'Formatted', exact: true })).toContainText('"a": [');
    await expect(page.getByRole('textbox', { name: 'Formatted', exact: true })).toContainText('"s": "héllo 👋"');

    await page.getByRole('radio', { name: 'Minify' }).click();
    await expect(page.getByRole('textbox', { name: 'Minified', exact: true })).toHaveText(
      '{"b":1,"a":[1,2,{"c":null}],"s":"héllo 👋"}',
    );

    await fillEditor(page, 'Input JSON', '{"a": 1,}');
    await expect(page.getByRole('alert').filter({ hasText: 'Invalid JSON' })).toBeVisible();
  });
});

test.describe('File drops', () => {
  async function dropFile(page: Page, target: Locator, name: string, type: string, content: string) {
    const element = await target.elementHandle();
    return page.evaluate(
      ({ element, name, type, content }) => {
        const target = element!;
        const dt = new DataTransfer();
        dt.items.add(new File([content], name, { type }));
        const over = new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true });
        target.dispatchEvent(over);
        const drop = new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true });
        target.dispatchEvent(drop);
        return { overPrevented: over.defaultPrevented, dropPrevented: drop.defaultPrevented };
      },
      { element, name, type, content },
    );
  }

  test('a file dropped on an editor panel is opened in it', async ({ page }) => {
    await page.goto('/tools/json-formatter');
    const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Input JSON', exact: true }) });
    const result = await dropFile(page, panel, 'data.json', 'application/json', '{"dropped":true}');
    expect(result.dropPrevented).toBe(true);
    await expect(page.getByRole('textbox', { name: 'Formatted', exact: true })).toContainText('"dropped": true');
  });

  test('an unsupported file dropped on a panel is refused with a message', async ({ page }) => {
    await page.goto('/tools/json-formatter');
    const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Input JSON', exact: true }) });
    await dropFile(page, panel, 'photo.png', 'image/png', 'not json');
    await expect(page.getByText(/That file type is not supported here/)).toBeVisible();
  });

  test('a file dropped outside any drop zone never navigates away', async ({ page }) => {
    await page.goto('/tools/json-formatter');
    const result = await dropFile(page, page.locator('header').first(), 'notes.txt', 'text/plain', 'hello');
    expect(result).toEqual({ overPrevented: true, dropPrevented: true });
    await expect(page).toHaveURL(/\/tools\/json-formatter$/);
  });
});

test.describe('Base64', () => {
  test('encodes UTF-8 text and decodes it back, rejecting invalid input', async ({ page }) => {
    await page.goto('/tools/encoding/base64');
    await page.getByRole('radio', { name: 'Encode' }).click();
    await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Hello, wörld ✓');
    await expect(page.getByRole('textbox', { name: 'Base64', exact: true })).toHaveValue('SGVsbG8sIHfDtnJsZCDinJM=');

    await page.getByRole('radio', { name: 'Decode' }).click();
    await page.getByRole('textbox', { name: 'Base64', exact: true }).fill('SGVsbG8sIHfDtnJsZCDinJM=');
    await expect(page.getByRole('textbox', { name: 'Decoded text', exact: true })).toHaveValue('Hello, wörld ✓');

    await page.getByRole('textbox', { name: 'Base64', exact: true }).fill('not base64 at all!!');
    await expect(page.getByRole('alert')).toBeVisible();
  });
});

test.describe('Regex tester', () => {
  test('highlights matches and explains invalid patterns', async ({ page }) => {
    await page.goto('/tools/regex');
    await page.getByLabel('Regular expression').fill('(\\d{4})-(\\d{2})');
    await page.getByRole('textbox', { name: 'Test text' }).fill('Released 2024-05, patched 2025-11 and 2026-01.');
    await expect(page.getByText('3 matches').first()).toBeVisible();

    await page.getByLabel('Regular expression').fill('(unclosed');
    await expect(page.getByRole('alert').filter({ hasText: 'Invalid pattern' })).toBeVisible();
  });
});

test.describe('Text tools', () => {
  test('case converter produces every variant', async ({ page }) => {
    await page.goto('/tools/text/case-converter');
    await page.getByRole('textbox', { name: 'Text', exact: true }).fill('hello world from LocalKit');
    await expect(page.getByText('helloWorldFromLocalKit').first()).toBeVisible();
    await expect(page.getByText('hello_world_from_local_kit').first()).toBeVisible();
    await expect(page.getByText('hello-world-from-local-kit').first()).toBeVisible();
  });

  test('sort lines orders naturally', async ({ page }) => {
    await page.goto('/tools/text/sort-lines');
    const input = page.getByRole('textbox').first();
    await input.fill('item 10\nitem 2\nitem 1');
    await expect(page.locator('#main')).toContainText(/item 1\s+item 2\s+item 10/);
  });

  test('remove duplicate lines keeps first occurrences', async ({ page }) => {
    await page.goto('/tools/text/remove-duplicate-lines');
    await page.getByRole('textbox').first().fill('apple\nbanana\napple\ncherry\nbanana');
    await expect(page.locator('#main')).toContainText(/apple\s+banana\s+cherry/);
    await expect(page.locator('#main')).toContainText('3 kept');
    await expect(page.locator('#main')).toContainText('2 removed');
  });
});

test.describe('PDF', () => {
  test('merges two PDFs into one with every page, in order', async ({ page }) => {
    await page.goto('/tools/pdf/merge');
    await page.locator('input[type=file]').first().setInputFiles([await makePdf('a.pdf', 1), await makePdf('b.pdf', 2)]);
    await expect(page.getByText('2 files, 3 pages')).toBeVisible();
    await page.getByRole('button', { name: 'Merge PDFs' }).click();
    await expect(page.getByText('Merged 3 pages from 2 files')).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download' }).click()]);
    expect(download.suggestedFilename()).toBe('merged.pdf');
    expect(await pdfPageCount(await downloadBuffer(download))).toBe(3);
  });

  test('rejects a corrupt PDF with a readable message', async ({ page }) => {
    await page.goto('/tools/pdf/merge');
    await page.locator('input[type=file]').first().setInputFiles([
      { name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.7\nthis is not really a pdf') },
    ]);
    await expect(page.locator('#main')).toContainText(/could not|damaged|corrupt|not a valid|unreadable/i);
  });
});

test.describe('Images', () => {
  test('converts a PNG to WebP locally and keeps its dimensions', async ({ page }) => {
    await page.goto('/tools/image/convert');
    await page.getByRole('radio', { name: 'WebP' }).click();
    await page.locator('input[type=file]').first().setInputFiles([makePng('pic.png', 96, 64)]);
    const button = page.getByRole('button', { name: 'Download pic.webp' });
    await expect(button).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
    const size = imageSize(await downloadBuffer(download));
    expect(size).toEqual({ format: 'webp', width: 96, height: 64 });
  });
});

test.describe('Diagram Studio', () => {
  test('renders Mermaid and explains syntax errors with a line number', async ({ page }) => {
    await page.goto('/tools/diagrams');
    await expect(page.getByRole('img', { name: 'Diagram preview' }).locator('svg')).toBeVisible();
    const source = page.getByRole('textbox', { name: 'Mermaid source' });
    await source.click();
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('flowchart TD\n  A --> B -->');
    await expect(page.getByRole('alert')).toContainText(/Line 2(?:, column \d+)?:/);
    await expect(page.getByRole('button', { name: 'Go to line' })).toBeVisible();
    // The last valid diagram stays visible while the source is broken.
    await expect(page.getByRole('img', { name: 'Diagram preview' }).locator('svg')).toBeVisible();
  });
});

test.describe('SQLite Studio', () => {
  test('runs read queries and blocks writes in read-only mode', async ({ page }) => {
    await page.goto('/tools/sqlite');
    await page.getByRole('button', { name: 'Load sample database' }).click();
    await expect(page.getByRole('button', { name: /^customers \d+$/ })).toBeVisible();
    await page.getByRole('radio', { name: 'SQL' }).click();
    await fillEditor(page, 'SQL query', 'SELECT COUNT(*) AS n FROM customers;');
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Database contents' })).toContainText('48');

    await fillEditor(page, 'SQL query', 'DELETE FROM customers;');
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Database contents' })).toContainText(/read-only/i);
    // The data is untouched.
    await fillEditor(page, 'SQL query', 'SELECT COUNT(*) AS n FROM customers;');
    await page.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Database contents' })).toContainText('48');
  });

  test('explains that a random file is not a SQLite database', async ({ page }) => {
    await page.goto('/tools/sqlite');
    const input = page.locator('input[type=file]').first();
    await input.setInputFiles([{ name: 'tiny.db', mimeType: 'application/octet-stream', buffer: Buffer.from('not sqlite') }]);
    await expect(page.locator('#main')).toContainText('Could not open the database');
    await expect(page.locator('#main')).toContainText('too small to be a SQLite database');

    await input.setInputFiles([{ name: 'fake.db', mimeType: 'application/octet-stream', buffer: Buffer.alloc(4096, 'x') }]);
    await expect(page.locator('#main')).toContainText('Could not open the database');
    await expect(page.getByRole('button', { name: 'Run', exact: true })).toHaveCount(0);
  });
});

test.describe('Markdown Notes', () => {
  test('creates a note that survives a reload', async ({ page }) => {
    await page.goto('/tools/notes');
    await page.getByRole('region', { name: 'Notes' }).getByRole('button', { name: 'New note' }).click();
    const title = page.getByRole('textbox', { name: 'Note title' });
    await title.fill('E2E shopping list');
    await fillEditor(page, 'Note content (Markdown)', '# Groceries\n\n- [ ] oat milk\n- [x] coffee');
    await expect(page.getByRole('heading', { name: 'Groceries' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Note editor' }).getByText('Saved', { exact: true }).first()).toBeVisible();

    await page.reload();
    await page.getByRole('searchbox', { name: 'Search notes' }).fill('shopping');
    await page.getByRole('list', { name: 'Note list' }).getByRole('button', { name: /^E2E shopping list/ }).click();
    await expect(page.getByRole('textbox', { name: 'Note title' })).toHaveValue('E2E shopping list');
    await expect(page.getByRole('heading', { name: 'Groceries' })).toBeVisible();
  });
});

test.describe('Remote content in previews', () => {
  async function trackRemote(page: Page) {
    const requests: string[] = [];
    await page.route('https://remote-images.test/**', (route) => {
      requests.push(route.request().url());
      return route.fulfill({ contentType: 'image/png', body: makePng('pixel.png', 4, 4).buffer });
    });
    return requests;
  }

  test('Markdown Notes does not contact image hosts until the user loads images', async ({ page }) => {
    const requests = await trackRemote(page);
    await page.goto('/tools/notes');
    await page.getByRole('region', { name: 'Notes' }).getByRole('button', { name: 'New note' }).click();
    await fillEditor(page, 'Note content (Markdown)', '# Pics\n\n![Logo](https://remote-images.test/logo.png)');
    await expect(page.getByText('1 remote image from remote-images.test not loaded', { exact: false })).toBeVisible();
    await expect(page.getByRole('img', { name: 'Remote image not loaded: Logo' })).toBeVisible();
    expect(requests).toEqual([]);

    await page.getByRole('button', { name: 'Load images' }).click();
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    await expect(page.getByRole('img', { name: 'Logo', exact: true })).toBeVisible();
  });

  test('Markdown to HTML keeps remote images out of the preview but not out of the HTML', async ({ page }) => {
    const requests = await trackRemote(page);
    await page.goto('/tools/web/markdown-to-html');
    await fillEditor(page, 'Markdown', '![Chart](https://remote-images.test/chart.png)');
    await expect(page.getByText('1 remote image from remote-images.test not loaded', { exact: false })).toBeVisible();
    expect(requests).toEqual([]);
    await page.getByRole('radio', { name: 'HTML' }).click();
    await expect(page.getByRole('textbox', { name: 'HTML', exact: true })).toContainText('src="https://remote-images.test/chart.png"');
  });
});

test.describe('Tool state', () => {
  test('small tool settings persist between visits', async ({ page }) => {
    await page.goto('/tools/json-formatter');
    await page.getByRole('radio', { name: '4 spaces' }).click();
    await page.goto('/');
    await page.goto('/tools/json-formatter');
    await expect(page.getByRole('radio', { name: '4 spaces' })).toBeChecked();
  });
});
