import { test, expect } from '@playwright/test';

test('Checks lists islands lost on export, and Grow to 30 fixes them', async ({ page }) => {
  await page.goto('/?fixture=render&editor=1');
  await page.waitForFunction(() => (window as any).__fm?.ready, null, { timeout: 20_000 });
  await expect(page.getByText('3 islands under 30 px get deleted')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('No lakes fill in')).toBeVisible();
  await expect(page.locator('[data-tier][aria-current="true"]')).toHaveText('Small');
  await page.getByRole('button', { name: 'Grow to 30' }).click();
  await expect(page.getByText('No islands get deleted')).toBeVisible({ timeout: 10_000 });
});

test('removed cells turn red once analysis has run', async ({ page }) => {
  await page.goto('/?fixture=render&editor=1');
  await page.waitForFunction(() => (window as any).__fm?.ready, null, { timeout: 20_000 });
  await expect(page.getByText('3 islands under 30 px get deleted')).toBeVisible({ timeout: 10_000 });
  await page.evaluate(() => (window as any).__fm.idle());
  expect(await page.evaluate(() => (window as any).__fm.readMapPixel(201, 100))).toEqual([255, 40, 40]);
});
