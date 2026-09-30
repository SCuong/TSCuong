import { test, expect } from './fixtures';
import { readFileSync } from 'node:fs';
import vi from '../src/i18n/vi';

// Read metadata without importing the registry's lazy TSX modules into the Node test project.
const dataTools = [...readFileSync('src/tools/registry/data.ts', 'utf8').matchAll(/id:\s*'([^']+)'[\s\S]*?name:\s*'([^']+)'[\s\S]*?route:\s*'([^']+)'/g)]
  .map((match) => ({ id: match[1], name: match[2], route: match[3] }));

for (const locale of ['en', 'vi'] as const) {
  test.describe(`data tools in ${locale}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((language) => localStorage.setItem('localkit:locale', language), locale);
    });
    const text = (english: string) => locale === 'vi' ? vi[english] ?? english : english;

    for (const tool of dataTools) {
      test(`${tool.id} loads and processes its sample`, async ({ page }) => {
        await page.goto(`/tools/${tool.route}`);
        await expect(page.locator('html')).toHaveAttribute('lang', locale);
        await expect(page.getByRole('heading', { level: 1, name: text(tool.name) })).toBeVisible();
        await expect(page.getByText(text('This tool ran into a problem'), { exact: true })).toHaveCount(0);
        const sample = page.getByRole('button', { name: text('Load sample'), exact: true });
        if (tool.id === 'spreadsheet-viewer') {
          const XLSX = await import('xlsx');
          const workbook = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['name', 'score'], ['Ada', 98.5]]), 'Sample');
          await page.locator('input[type=file]').setInputFiles({
            name: 'sample.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            buffer: Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })),
          });
          await expect(page.getByRole('grid')).toContainText('Ada', { timeout: 30_000 });
        } else if (tool.id === 'markdown-table-generator' || tool.id === 'html-table-generator') {
          await expect(page.getByRole('button', { name: text('Import CSV / Markdown') })).toBeVisible();
          await expect(page.getByRole('button', { name: text('Copy'), exact: true })).toBeEnabled();
        } else {
          await sample.first().click();
          if (tool.id === 'csv-viewer') {
            await expect(page.getByRole('grid')).toContainText('Ada Lovelace');
            await page.getByRole('textbox', { name: text('Filter rows'), exact: true }).fill('Ada');
            await expect(page.getByText(text('{count} of {total}').replace('{count}', '2').replace('{total}', `10 ${text('rows')}`), { exact: false })).toBeVisible();
          } else if (tool.id === 'csv-statistics') {
            await expect(page.getByText(text('Most common')).first()).toBeVisible();
            await expect(page.getByText(text('Filled'), { exact: true }).first()).toBeVisible();
          } else {
            await expect(page.getByRole('button', { name: text('Copy'), exact: true }).last()).toBeEnabled({ timeout: 30_000 });
          }
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);
      });
    }

    test('CSV file parses in the worker with localized delimiters', async ({ page }) => {
      await page.goto('/tools/data/csv-viewer');
      await page.locator('input[type=file]').setInputFiles({
        name: 'sample.csv', mimeType: 'text/csv', buffer: Buffer.from('name;score\nAda;98.5\nGrace;100'),
      });
      await expect(page.getByRole('grid')).toContainText('Ada');
      await expect(page.getByLabel(text('Delimiter'), { exact: true })).toContainText(text('Semicolon'));
    });
  });
}
