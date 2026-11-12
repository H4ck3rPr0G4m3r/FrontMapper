import { test, expect, type Page } from '@playwright/test';

// 1x1 dark PNG standing in for satellite tiles, so tests never hit the network.
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

async function open(page: Page) {
  await page.route('**/arcgisonline.com/**', (r) => r.fulfill({ body: TILE, contentType: 'image/png' }));
  await page.goto('/');
  await page.getByRole('button', { name: /From Earth/ }).click();
  await page.waitForFunction(() => (window as any).__earth?.ready, null, { timeout: 20_000 });
}

async function clickLatLng(page: Page, lat: number, lng: number, modifiers: ('Shift' | 'Alt')[] = []) {
  const box = (await page.locator('.earth-map').boundingBox())!;
  const p = await page.evaluate(([la, ln]) => (window as any).__earth.toPoint(la, ln), [lat, lng]);
  await page.mouse.move(box.x + p.x, box.y + p.y);
  for (const m of modifiers) await page.keyboard.down(m);
  await page.mouse.click(box.x + p.x, box.y + p.y);
  for (const m of modifiers) await page.keyboard.up(m);
}

test('search selects Indonesia and sizes the frame', async ({ page }) => {
  await open(page);
  await page.getByPlaceholder('Search a country or province').fill('indon');
  await page.keyboard.press('Enter');
  await expect(page.locator('.sel-tag', { hasText: 'Indonesia' })).toBeVisible();
  await expect(page.getByLabel('Width', { exact: true })).toHaveValue('4000');
  const km = await page.locator('[data-km]').textContent();
  await page.getByLabel('Height', { exact: true }).fill('2400');
  await page.getByLabel('Height', { exact: true }).press('Enter');
  await expect(page.getByLabel('Height', { exact: true })).toHaveValue('2400');
  await expect(page.locator('[data-km]')).toHaveText(km!);
  await expect(page.getByRole('button', { name: 'Convert to map' })).toBeEnabled();
});

test('shift-click adds a second country', async ({ page }) => {
  await open(page);
  await page.getByPlaceholder('Search a country or province').fill('Indonesia');
  await page.keyboard.press('Enter');
  await expect(page.locator('.sel-tag', { hasText: 'Indonesia' })).toBeVisible();
  await page.evaluate(() => (window as any).__earth.idle());
  await clickLatLng(page, 2.5, 113.2, ['Shift']); // Sarawak, Malaysia
  await expect(page.locator('.sel-tag', { hasText: 'Malaysia' })).toBeVisible();
  await expect(page.locator('.sel-tag')).toHaveCount(2);
});

test('dragging the frame edge widens the map', async ({ page }) => {
  await open(page);
  await page.getByPlaceholder('Search a country or province').fill('Indonesia');
  await page.keyboard.press('Enter');
  await page.evaluate(() => (window as any).__earth.idle());
  const before = Number(await page.getByLabel('Width', { exact: true }).inputValue());
  const handle = page.locator('.frame-handle.e');
  const b = (await handle.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 120, b.y + b.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => Number(await page.getByLabel('Width', { exact: true }).inputValue())).toBeGreaterThan(before);
});
