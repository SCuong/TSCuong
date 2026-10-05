import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import type { Download, Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { makePng } from './files';

async function fillEditor(page: Page, name: string, value: string) {
  const editor = page.getByRole('textbox', { name, exact: true });
  await editor.click();
  await editor.fill(value);
}

async function downloadText(download: Download): Promise<string> {
  const path = await download.path();
  if (!path) throw new Error('download failed');
  return readFile(path, 'utf8');
}

/** Runs a classic script in a fresh Node context and returns what it defines and computes. */
function runScript(code: string) {
  const sandbox: Record<string, unknown> = {};
  vm.runInNewContext(code, sandbox, { timeout: 2000 });
  return { globals: Object.keys(sandbox).sort(), result: JSON.stringify(sandbox.result) };
}

/** Drops console messages a test expects (e.g. the browser reporting that a sandbox blocked something). */
function allow(errors: string[], pattern: RegExp) {
  const kept = errors.filter((e) => !pattern.test(e));
  errors.splice(0, errors.length, ...kept);
}

test.describe('Code minifiers', () => {
  test('JavaScript minifier keeps the globals of a classic script and behaves the same', async ({ page }) => {
    await page.goto('/tools/web/js-minifier');
    const source = "function greet(name) {\n  return 'Hi ' + name;\n}\nvar counter = 0;\nfunction bump() { counter++; return counter; }\nresult = [greet('a'), bump(), bump()];\n";
    await fillEditor(page, 'JavaScript', source);
    await expect(page.getByText('Minified as a classic script: top-level names are kept')).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save' }).click();
    const minified = await downloadText(await download);
    expect(minified.length).toBeLessThan(source.length);
    expect(runScript(minified)).toEqual(runScript(source));

    await fillEditor(page, 'JavaScript', 'const a = 1;\nconst b = ;\n');
    await expect(page.getByRole('alert')).toContainText('Line 2, column 11');
  });

  test('HTML minifier keeps significant whitespace and keeps a broken inline script as written', async ({ page }) => {
    await page.goto('/tools/web/html-minifier');
    await fillEditor(
      page,
      'HTML',
      '<p>Hello   <b>big</b>   <i>world</i></p>\n<div style="white-space: pre-wrap">  keep\n    this  </div>\n<script>\n  var x = {{ value }};\n</script>',
    );
    const output = page.getByRole('textbox', { name: 'Minified', exact: true });
    await expect(output).toContainText('<p>Hello <b>big</b> <i>world</i></p>');
    await expect(output).toContainText('var x = {{ value }};');
    await expect(page.getByRole('status').filter({ hasText: 'could not be minified' })).toContainText('Line 5, column 12 (<script>)');
  });

  test('CSS minifier keeps nested rules', async ({ page }) => {
    await page.goto('/tools/web/css-minifier');
    await fillEditor(page, 'CSS', '.card {\n  color: red;\n  &:hover { color: blue; }\n  .title { font-weight: bold; }\n}\n');
    await expect(page.getByRole('textbox', { name: 'Minified', exact: true })).toHaveText('.card{color:red;&:hover{color:blue}.title{font-weight:bold}}');
    await expect(page.getByText('CSS nesting detected')).toBeVisible();
  });

  test('formatting runs in the background and can be cancelled', async ({ page }) => {
    await page.goto('/tools/web/js-formatter');
    const big = Array.from({ length: 12_000 }, (_, i) => `function f${i}(a,b){const t=a*b+${i};return {ok:t>1,v:[a,b].map(x=>x*2)}}`).join('\n');
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Open file' }).click();
    await (await chooser).setFiles({ name: 'big.js', mimeType: 'text/javascript', buffer: Buffer.from(big) });
    const cancel = page.getByRole('button', { name: 'Cancel' });
    await expect(cancel).toBeVisible();
    // The page stays interactive while Prettier works in the worker.
    await page.getByRole('radio', { name: '4 spaces' }).click();
    await expect(page.getByRole('radio', { name: '4 spaces' })).toBeChecked();
    await cancel.click();
    await expect(page.getByText('Stopped. Edit the input or change an option to run it again.')).toBeVisible();
    await page.getByRole('radio', { name: '2 spaces' }).click();
    await expect(page.getByText('Formatted with Prettier')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole('textbox', { name: 'Formatted', exact: true })).toContainText('function f0(a, b) {');
  });
});

test.describe('Previews of untrusted content', () => {
  test('HTML Live Preview applies the script setting to the very next document', async ({ page, consoleErrors }) => {
    await page.goto('/tools/web/html-preview');
    // Keeps the sample's #count button so the sample JavaScript runs without errors.
    await fillEditor(page, 'HTML (body)', '<p>Probe</p><button id="count">Clicked 0 times</button><img src="data:," alt="" onerror="document.body.dataset.ran = \'yes\'">');
    const frameEl = page.locator('iframe[title="Live preview"]');
    const ran = async () => {
      const frame = await (await frameEl.elementHandle())!.contentFrame();
      await expect(frame!.locator('p')).toHaveText('Probe');
      return frame!.evaluate(() => document.body.dataset.ran ?? 'no');
    };
    await expect(frameEl).toHaveAttribute('sandbox', '');
    await expect.poll(ran).toBe('no');

    const toggle = page.getByRole('switch', { name: 'Run JavaScript' });
    await toggle.click();
    await expect(frameEl).toHaveAttribute('sandbox', 'allow-scripts');
    await expect.poll(ran).toBe('yes');

    // Regression: the document loaded right after switching off used to keep running scripts.
    await toggle.click();
    await expect(frameEl).toHaveAttribute('sandbox', '');
    await page.waitForTimeout(500);
    await expect.poll(ran).toBe('no');

    // With scripts on, the preview still cannot reach LocalKit's storage, and console output is shown.
    await toggle.click();
    await page.getByRole('radio', { name: 'JavaScript' }).click();
    await fillEditor(page, 'JavaScript', "try { localStorage.getItem('x'); console.log('storage: readable'); } catch (e) { console.log('storage: ' + e.name); }\nconsole.log({ nested: [1, { b: 2 }] }, undefined);");
    const log = page.getByRole('log', { name: 'Console output' });
    await expect(log).toContainText('storage: SecurityError');
    await expect(log).toContainText('"b": 2');
    await expect(log).toContainText('undefined');
    allow(consoleErrors, /Blocked script execution in 'about:srcdoc'/);
  });

  test('Markdown preview cannot restyle or cover the page and makes no requests until images are allowed', async ({ page, consoleErrors }) => {
    const requests: string[] = [];
    await page.route('https://remote-images.test/**', (route) => {
      requests.push(route.request().url());
      return route.fulfill({ contentType: 'image/png', body: makePng('pixel.png', 4, 4).buffer });
    });
    await page.goto('/tools/web/markdown-to-html');
    await fillEditor(
      page,
      'Markdown',
      [
        '# Title',
        '',
        'Text before the style.',
        '',
        '<style>main { outline: 5px solid rgb(255, 0, 0) !important; } @import url(https://remote-images.test/evil.css);</style>',
        '',
        '<div style="position:fixed;inset:0;z-index:9999;background:rgb(255 0 0 / 0.3)">overlay</div>',
        '',
        '<div style="background-image:image-set(\'https://remote-images.test/set.png\' 1x);width:10px;height:10px"></div>',
        '',
        '![Chart](https://remote-images.test/chart.png)',
      ].join('\n'),
    );
    // The remote-content scanner also counts the two URLs in the CSS input.
    await expect(page.getByText('3 remote images from remote-images.test not loaded', { exact: false })).toBeVisible();
    const preview = page.frameLocator('iframe[title="Rendered Markdown preview"]');
    await expect(preview.getByRole('heading', { name: 'Title' })).toBeVisible();
    expect(await page.locator('main').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('none');
    // The fixed-position element stays inside the preview frame: the page can still be used.
    await page.getByRole('radio', { name: 'HTML' }).click({ timeout: 5000 });
    await page.getByRole('radio', { name: 'Preview' }).click({ timeout: 5000 });
    expect(requests).toEqual([]);

    await page.getByRole('button', { name: 'Load images' }).click();
    await expect.poll(() => requests.some((u) => u.endsWith('/chart.png'))).toBe(true);
    // Only images: the remote stylesheet stays blocked.
    expect(requests.some((u) => u.endsWith('/evil.css'))).toBe(false);
    allow(consoleErrors, /Content Security Policy/);
  });
});

test.describe('Web generators', () => {
  test('robots.txt tester follows RFC 9309 and survives pathological patterns', async ({ page }) => {
    await page.goto('/tools/web/robots-txt');
    await page.getByRole('radio', { name: 'Paste your own' }).click();
    await page.locator('#rt-custom').fill(`User-agent: *\nDisallow: /${'*a'.repeat(30)}b\nDisallow: /foo/bar/baz\n`);
    const url = page.getByLabel('URL or path');
    await url.fill(`/${'a'.repeat(3000)}`);
    await expect(page.getByRole('status').filter({ hasText: 'No rule matches' })).toContainText('Allowed', { timeout: 3000 });
    await url.fill('/foo/bar/%62%61%7A');
    await expect(page.getByRole('status').filter({ hasText: 'most specific' })).toContainText('Blocked');
  });

  test('sitemap escapes XML and rejects lines that would silently change', async ({ page }) => {
    await page.goto('/tools/web/sitemap-xml');
    await page.getByRole('textbox', { name: 'URLs (one per line)' }).fill("https://example.com/?a=1&b=2\nhttps://example.com/page\t2026-01-01\nhttps://example.com/x'y");
    await expect(page.getByRole('region', { name: 'Problems by line' })).toContainText('Contains spaces or tabs');
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save' }).click();
    const xml = await downloadText(await download);
    expect(xml).toContain('<loc>https://example.com/?a=1&amp;b=2</loc>');
    expect(xml).toContain('<loc>https://example.com/x&apos;y</loc>');
    expect(xml).not.toContain('2026-01-01</loc>');
  });

  test('gradient stops can be added and moved with the keyboard only', async ({ page }) => {
    await page.goto('/tools/web/css-gradient');
    const stops = page.getByRole('slider', { name: /^Stop / });
    await expect(stops).toHaveCount(3);
    await page.getByRole('button', { name: 'Add stop' }).focus();
    await page.keyboard.press('Enter');
    await expect(stops).toHaveCount(4);
    const typed = page.getByRole('spinbutton', { name: 'Angle' });
    await typed.fill('');
    await typed.pressSequentially('-30');
    await expect(page.locator('pre').last()).toContainText('linear-gradient(330deg');
  });

  test('HTML to Markdown keeps tables intact', async ({ page }) => {
    await page.goto('/tools/web/html-to-markdown');
    await fillEditor(page, 'HTML', '<table><thead><tr><th>a|b</th><th>c</th></tr></thead><tbody><tr><td>x</td><td><p>one</p><p>two</p></td></tr></tbody></table><p>Use &lt;div&gt; and <del>old</del></p>');
    const md = page.getByRole('textbox', { name: 'Markdown', exact: true });
    await expect(md).toContainText('| a\\|b | c |');
    await expect(md).toContainText('| x | one<br><br>two |');
    await expect(md).toContainText('Use \\<div> and ~~old~~');
  });
});

test.describe('Color tools', () => {
  test('contrast ratios match reference checkers', async ({ page }) => {
    await page.goto('/tools/color/contrast-checker');
    await page.getByLabel('Text color', { exact: true }).fill('#777');
    await page.getByLabel('Background', { exact: true }).fill('#fff');
    await expect(page.getByText('4.48:1', { exact: true })).toBeVisible();
    await page.getByLabel('Text color', { exact: true }).fill('rgb(300 0 0)');
    await expect(page.getByText('4.00:1', { exact: true })).toBeVisible();
  });

  test('color blindness simulator accepts bare hex codes and images', async ({ page }) => {
    await page.goto('/tools/color/blindness-simulator');
    await page.getByLabel('Colors').fill('ff0000 00ff00 nonsense');
    await expect(page.getByText('Ignored a value that is not a color: nonsense')).toBeVisible();
    await expect(page.locator('[title="ff0000 → #a39000"]')).toBeVisible();

    await page.getByRole('radio', { name: 'Image' }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'browse' }).click();
    await (await chooser).setFiles(makePng('chart.png', 64, 48));
    await expect(page.getByRole('img', { name: 'Deuteranopia simulation of chart.png' })).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save PNG' }).click();
    expect((await download).suggestedFilename()).toBe('chart-deuteranopia.png');
  });
});
