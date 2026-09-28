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

test('mobile navigation drawer opens, navigates and closes', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  const drawer = page.getByRole('dialog', { name: 'Navigation' });
  await expect(drawer).toBeVisible();
  await drawer.getByRole('link', { name: /Settings/ }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(drawer).toBeHidden();
});
