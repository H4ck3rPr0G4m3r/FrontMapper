import { test, expect } from '@playwright/test';

const PROD = 'http://localhost:5180/';

test('after one visit the app opens and makes maps without a connection', async ({ page, context }) => {
  await page.goto(PROD);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect(page.getByText('Works offline')).toBeVisible({ timeout: 15_000 });

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText(/Offline: editing works/)).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.earth-card')).toBeDisabled();

  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await page.getByRole('button', { name: '2000 × 1500' }).click();
  await page.getByRole('button', { name: 'Generate map' }).click();
  await expect(page.locator('.ed')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('No lakes fill in')).toBeVisible({ timeout: 20_000 });
});
