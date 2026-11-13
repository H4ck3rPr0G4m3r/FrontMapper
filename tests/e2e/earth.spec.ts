import { test, expect, type Page } from '@playwright/test';
import { terrariumPng } from '../fixtures/tiles/make';

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

const HILLS = Buffer.from(terrariumPng(() => 600));

/** Stub the live tile services: no water anywhere (all land), 600 m everywhere. */
async function stubTiles(page: Page, elevation: { fail: boolean }) {
  await page.route('https://tiles.openfreemap.org/planet', (r) => r.fulfill({ json: { tiles: ['https://tiles.openfreemap.org/test/{z}/{x}/{y}.pbf'], maxzoom: 14 } }));
  await page.route('https://tiles.openfreemap.org/test/**', (r) => r.fulfill({ body: Buffer.alloc(0), contentType: 'application/vnd.mapbox-vector-tile' }));
  await page.route('**/terrarium/**', (r) => (elevation.fail ? r.fulfill({ status: 503, body: '' }) : r.fulfill({ body: HILLS, contentType: 'image/png' })));
}

async function selectSmallIndonesia(page: Page) {
  await page.getByPlaceholder('Search a country or province').fill('Indonesia');
  await page.keyboard.press('Enter');
  await expect(page.locator('.sel-tag', { hasText: 'Indonesia' })).toBeVisible();
  await page.getByRole('button', { name: 'Link width and height' }).click(); // scale the whole country down
  await page.getByLabel('Width', { exact: true }).fill('400');
  await page.getByLabel('Width', { exact: true }).press('Enter');
  await expect(page.getByLabel('Width', { exact: true })).toHaveValue('400');
}

test('convert builds the map and opens it in the editor', async ({ page }) => {
  await open(page);
  await stubTiles(page, { fail: false });
  await selectSmallIndonesia(page);
  const height = await page.getByLabel('Height', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Convert to map' }).click();
  await expect(page.locator('.ed-title')).toContainText('Indonesia', { timeout: 30_000 });
  await expect(page.locator('.ed-title small')).toHaveText(`400 × ${height}`);
});

test('a failed download stops with Retry and keeps the selection', async ({ page }) => {
  test.setTimeout(60_000);
  const elevation = { fail: true };
  await open(page);
  await stubTiles(page, elevation);
  await selectSmallIndonesia(page);
  await page.getByRole('button', { name: 'Convert to map' }).click();
  const dialog = page.getByRole('dialog', { name: "Couldn't convert Indonesia" });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  await expect(dialog.getByRole('alert')).toContainText(/elevation tiles didn't download/);
  await dialog.getByRole('button', { name: 'Back to picker' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.sel-tag', { hasText: 'Indonesia' })).toBeVisible();
  await expect(page.getByLabel('Width', { exact: true })).toHaveValue('400');

  await page.getByRole('button', { name: 'Convert to map' }).click();
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  elevation.fail = false;
  await dialog.getByRole('button', { name: 'Retry' }).click();
  await expect(page.locator('.ed-title')).toContainText('Indonesia', { timeout: 30_000 });
});

test('nations come from cities and countries, and survive a re-convert', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page);
  await stubTiles(page, { fail: false });
  await selectSmallIndonesia(page);
  await page.getByRole('button', { name: 'Convert to map' }).click();
  await expect(page.locator('.ed-title')).toContainText('Indonesia', { timeout: 30_000 });

  await page.getByRole('tab', { name: /Nations/ }).click();
  await page.getByRole('button', { name: 'Countries' }).click();
  await expect(page.getByRole('status')).toHaveText('Placed 1 country.');
  await expect(page.getByLabel('Nation name')).toHaveValue('Indonesia');

  await page.getByLabel('Minimum city population').fill('2000000');
  await page.getByRole('button', { name: 'Place cities' }).click();
  await expect(page.getByRole('status')).toContainText(/Placed \d+ cities\./);
  const names = await page.getByLabel('Nation name').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(names).toEqual(expect.arrayContaining(['Indonesia', 'Jakarta', 'Surabaya', 'Medan']));
  expect(names).not.toContain('Palembang'); // 1.7M, under the threshold
  const count = names.length;

  await page.getByRole('button', { name: 'Earth', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Back to editor' })).toBeVisible();
  await expect(page.locator('.reconvert-note')).toContainText('Indonesia');
  await expect(page.getByLabel('Width', { exact: true })).toHaveValue('400');
  await page.getByRole('button', { name: 'Convert to map' }).click();
  await expect(page.locator('.ed-title')).toContainText('Indonesia', { timeout: 30_000 });
  await page.getByRole('tab', { name: /Nations/ }).click();
  await expect(page.getByLabel('Nation name')).toHaveCount(count);
});

test('one click removes auto-placed nations that crowd each other, with undo', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page);
  await stubTiles(page, { fail: false });
  await selectSmallIndonesia(page);
  await page.getByRole('button', { name: 'Convert to map' }).click();
  await expect(page.locator('.ed-title')).toContainText('Indonesia', { timeout: 30_000 });
  await page.getByRole('tab', { name: /Nations/ }).click();
  await page.getByLabel('Minimum city population').fill('300000');
  await page.getByRole('button', { name: 'Place cities' }).click();
  await expect(page.getByRole('status')).toContainText(/Placed \d+ cities\./);
  const before = await page.getByLabel('Nation name').count();

  const fix = page.getByRole('button', { name: /^Remove \d+ crowded$/ });
  await expect(fix).toBeVisible();
  const n = Number((await fix.textContent())!.match(/\d+/)![0]);
  await fix.click();
  await expect(page.getByLabel('Nation name')).toHaveCount(before - n);
  await expect(page.getByText(`Removed ${n} crowded nations.`)).toBeVisible();
  await page.getByRole('tab', { name: /Checks/ }).click();
  await expect(page.getByText(/Too close to another nation/)).toHaveCount(0);

  await page.getByRole('tab', { name: /Nations/ }).click();
  await page.getByRole('button', { name: 'Undo removing crowded nations' }).click();
  await expect(page.getByLabel('Nation name')).toHaveCount(before);
});
