import { test as base, expect, type Page } from '@playwright/test';

/** Fails a test when the page logs console errors or throws uncaught errors. */
export const test = base.extend<{ consoleErrors: string[] }>({
  consoleErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') errors.push(msg.text());
      });
      page.on('pageerror', (err) => errors.push(err.message));
      await use(errors);
      expect(errors, 'console errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export async function openPalette(page: Page) {
  // Wait for the app shell to mount before using the global shortcut.
  await expect(page.getByRole('button', { name: 'Search tools' })).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('combobox', { name: 'Search tools and actions' })).toBeFocused();
}
