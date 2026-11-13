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

test('Accept sticks through a newer check and clears the red marks', async ({ page }) => {
  await page.goto('/?fixture=render&editor=1');
  await page.waitForFunction(() => (window as any).__fm?.ready, null, { timeout: 20_000 });
  await expect(page.getByText('3 islands under 30 px get deleted')).toBeVisible({ timeout: 10_000 });
  // Edit, then accept while the check for that edit is still running.
  await page.evaluate(() => (window as any).__fm.idle());
  const box = (await page.locator('canvas[data-overlay]').boundingBox())!;
  const s = await page.evaluate(() => (window as any).__fm.mapToScreen(300.5, 200.5));
  await page.mouse.click(box.x + s.x, box.y + s.y); // brush dab in open water
  await expect(page.locator('.pending')).toHaveCount(1);
  await page.getByRole('button', { name: 'Accept' }).first().click();
  await expect(page.getByText('3 islands under 30 px get deleted (accepted)')).toBeVisible();
  await expect(page.locator('.pending')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.getByText('3 islands under 30 px get deleted (accepted)')).toBeVisible();
  await page.evaluate(() => (window as any).__fm.idle());
  expect(await page.evaluate(() => (window as any).__fm.readMapPixel(201, 100))).not.toEqual([255, 40, 40]);

  await page.getByRole('button', { name: 'Undo accepting islands' }).click();
  await expect(page.getByRole('button', { name: 'Grow to 30' })).toBeVisible();
  await page.evaluate(() => (window as any).__fm.idle());
  expect(await page.evaluate(() => (window as any).__fm.readMapPixel(201, 100))).toEqual([255, 40, 40]);
});
