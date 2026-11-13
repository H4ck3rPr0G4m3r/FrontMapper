import { test, expect } from '@playwright/test';

test('app boots with the Graphite theme', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'FrontMapper' })).toBeVisible();
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(31, 31, 31)');
});

test('the tab has the FrontMapper icon', async ({ page, request }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="icon"]').getAttribute('href');
  expect(href).toMatch(/favicon\.svg$/);
  const res = await request.get(href!);
  expect(res.ok()).toBe(true);
  expect(res.headers()['content-type']).toContain('svg');
  expect((await request.get(await page.locator('link[rel="apple-touch-icon"]').getAttribute('href') as string)).ok()).toBe(true);
});
