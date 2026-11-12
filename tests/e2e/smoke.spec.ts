import { test, expect } from '@playwright/test';

test('app boots with the Graphite theme', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'FrontMapper' })).toBeVisible();
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(31, 31, 31)');
});
