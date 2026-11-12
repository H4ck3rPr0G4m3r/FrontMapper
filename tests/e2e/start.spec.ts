import { test, expect } from '@playwright/test';

test('new blank map opens the editor and is resumable from Recent', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'FrontMapper' })).toBeVisible();
  await page.getByRole('button', { name: '3000 × 2000' }).click();
  await page.getByRole('button', { name: 'Create blank map' }).click();
  await expect(page.locator('.ed-title small')).toHaveText('3000 × 2000');
  await page.getByRole('tab', { name: 'Info' }).click();
  await page.getByLabel('Map name').fill('Blank Test');
  await page.waitForTimeout(2600); // autosave debounce
  await page.reload();
  const recent = page.getByRole('button', { name: /^Blank Test/ });
  await expect(recent).toBeVisible();
  await recent.click();
  await expect(page.locator('.ed-title')).toContainText('Blank Test');
  await expect(page.locator('.ed-title small')).toHaveText('3000 × 2000');
});

test('blank map sizes snap to multiples of 4', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Width').fill('1001');
  await page.getByLabel('Height').fill('703');
  await page.getByRole('button', { name: 'Create blank map' }).click();
  await expect(page.locator('.ed-title small')).toHaveText('1000 × 700');
});
