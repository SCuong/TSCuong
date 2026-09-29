import { test, expect } from './fixtures';

const PAGES = ['/', '/tools', '/tools/json-formatter', '/favorites', '/settings', '/privacy'];

for (const path of PAGES) {
  test(`no horizontal overflow on ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('a tool is fully usable on a phone', async ({ page }) => {
  await page.goto('/tools/json-formatter');
  const input = page.getByRole('textbox', { name: 'Input JSON', exact: true });
  await input.click();
  await input.fill('{"phone":true,"n":[1,2]}');
  await expect(page.getByRole('textbox', { name: 'Formatted', exact: true })).toContainText('"phone": true');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('search from the header opens a tool on a phone', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Search tools' }).click();
  await page.keyboard.type('merge pdf');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/tools\/pdf\/merge$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Merge PDFs' })).toBeVisible();
});

test('mobile navigation drawer opens, navigates and closes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const drawer = page.getByRole('dialog', { name: 'Navigation' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('link', { name: /Settings/ }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(drawer).toBeHidden();
});
