import { test, expect, openPalette } from './fixtures';

test('home loads with search and categories', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Search tools' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /JSON/ }).first()).toBeVisible();
});

test('home search finds tools and Enter opens the top result', async ({ page }) => {
  await page.goto('/');
  const search = page.getByRole('searchbox', { name: 'Search tools' });
  await search.fill('format json');
  await expect(page.getByRole('link', { name: /JSON Formatter/ }).first()).toBeVisible();
  await search.press('Enter');
  await expect(page).toHaveURL(/\/tools\/json-formatter$/);
  await expect(page.getByRole('heading', { level: 1, name: 'JSON Formatter' })).toBeVisible();
});

test('Ctrl+K palette supports keyboard-only navigation', async ({ page }) => {
  await page.goto('/tools');
  await openPalette(page);
  await page.keyboard.type('json formatter');
  await expect(page.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/json-formatter/);
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeHidden();
});

test('Escape closes the palette and returns focus', async ({ page }) => {
  await page.goto('/tools');
  const filter = page.getByRole('searchbox', { name: 'Filter tools' });
  await filter.click();
  await filter.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeHidden();
  await expect(filter).toBeFocused();
});

test('palette quick actions copy generated values without opening a tool', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/');
  await openPalette(page);
  await page.keyboard.type('copy uuid');
  await expect(page.getByRole('option', { name: /Copy a new UUID/ })).toBeVisible();
  await page.keyboard.press('Enter');
  const uuid = await page.evaluate(() => navigator.clipboard.readText());
  expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  await expect(page.getByText(`Copied ${uuid}`)).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test('palette shows a helpful empty state', async ({ page }) => {
  await page.goto('/');
  await openPalette(page);
  await page.keyboard.type('zzzzqqqq');
  await expect(page.getByText(/No tools match/)).toBeVisible();
});

test('theme switching persists across reloads without flashing', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('radio', { name: 'Light theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.reload({ waitUntil: 'commit' });
  // The pre-paint script sets the theme before the app bundle runs.
  await page.waitForSelector('html[data-theme]');
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('light');
  await page.getByRole('radio', { name: 'Dark theme' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('system theme follows prefers-color-scheme', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('favorites, pins and recent tools persist', async ({ page }) => {
  await page.goto('/tools/json-formatter');
  await page.getByRole('button', { name: 'Add to favorites' }).click();
  await page.getByRole('button', { name: 'Pin to sidebar' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Remove from favorites' })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav.getByRole('link', { name: 'JSON Formatter' })).toBeVisible();
  await page.goto('/favorites');
  await expect(page.getByText('Most used')).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your tools' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recently used' })).toBeVisible();
});

test('alias tool paths redirect to the canonical route without a history entry', async ({ page }) => {
  await page.goto('/');
  await page.goto('/tools/mermaid?from=docs');
  await expect(page).toHaveURL(/\/tools\/diagrams\?from=docs$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Diagram Studio' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
});

test('unknown routes show a not-found page', async ({ page }) => {
  await page.goto('/tools/does-not-exist');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await page.goto('/category/nope');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
});

test('settings exports a backup', async ({ page }) => {
  await page.goto('/settings');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^localkit-backup-\d{4}-\d{2}-\d{2}\.json$/);
});
