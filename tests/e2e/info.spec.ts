import { test, expect, type Page } from '@playwright/test';

async function dragMap(page: Page, a: [number, number], b: [number, number]) {
  const box = (await page.locator('canvas[data-overlay]').boundingBox())!;
  const s = await page.evaluate(([x, y]) => (window as any).__fm.mapToScreen(x, y), a);
  const e = await page.evaluate(([x, y]) => (window as any).__fm.mapToScreen(x, y), b);
  await page.mouse.move(box.x + s.x, box.y + s.y);
  await page.mouse.down();
  await page.mouse.move(box.x + e.x, box.y + e.y, { steps: 5 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await page.goto('/?fixture=render&editor=1');
  await page.waitForFunction(() => (window as any).__fm?.ready, null, { timeout: 20_000 });
});

test('info.json becomes valid once a name and category are set', async ({ page }) => {
  await expect(page.getByText('Categories: pick at least one')).toBeVisible();
  await page.getByRole('tab', { name: 'Info' }).click();
  await page.getByLabel('Map name').fill('Kökar');
  await expect(page.getByText('folder kokar')).toBeVisible();
  await page.getByRole('group', { name: 'Categories' }).getByRole('button', { name: 'Europe' }).click();
  await page.getByRole('tab', { name: 'Checks' }).click();
  await expect(page.getByText('info.json is valid')).toBeVisible();
});

test('crop to selection shrinks the map', async ({ page }) => {
  await page.keyboard.press('m');
  await dragMap(page, [100, 100], [499, 299]);
  await page.getByRole('tab', { name: 'Info' }).click();
  await page.getByRole('button', { name: /Crop to selection/ }).click();
  await expect(page.locator('.ed-title small')).toHaveText('400 × 200');
});
