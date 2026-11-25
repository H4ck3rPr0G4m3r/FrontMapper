import { test, expect, type Page } from '@playwright/test';

// 1x1 dark PNG standing in for satellite and label tiles, so tests never hit the network.
const TILE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/** The test map (1024 x 512) read as plain lat/lon over central Europe: lon -5..15, lat 52..40. */
const lonOf = (x: number) => -5 + (x / 1024) * 20;
const latOf = (y: number) => 52 - (y / 512) * 12;

async function pin(page: Page, x: number, y: number) {
  const map = (await page.locator('.al-map').boundingBox())!;
  const p = await page.evaluate(([a, b]) => (window as any).__align.mapPoint(a, b), [x, y]);
  await page.mouse.click(map.x + p.x, map.y + p.y);
  const lat = latOf(y), lng = lonOf(x);
  await page.evaluate(([a, b]) => (window as any).__align.setEarthView(a, b, 6), [lat, lng]);
  const earth = (await page.locator('.al-earth').boundingBox())!;
  const q = await page.evaluate(([a, b]) => (window as any).__align.earthPoint(a, b), [lat, lng]);
  await page.mouse.click(earth.x + q.x, earth.y + q.y);
}

test('a hand-made map lined up with Earth gets nations from Earth data', async ({ page }) => {
  test.setTimeout(60_000);
  await page.route('**/arcgisonline.com/**', (r) => r.fulfill({ body: TILE, contentType: 'image/png' }));
  await page.goto('/?fixture=render&editor=1');
  await page.waitForFunction(() => (window as any).__fm?.ready, null, { timeout: 20_000 });
  await page.getByRole('tab', { name: /Nations/ }).click();
  await expect(page.getByRole('button', { name: 'Countries' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Line up with Earth' }).click();
  const screen = page.getByRole('dialog', { name: 'Line up with Earth' });
  await expect(screen).toBeVisible();
  await page.waitForFunction(() => (window as any).__align?.ready && (window as any).__align?.mapPoint, null, { timeout: 20_000 });
  await expect(screen.getByRole('button', { name: 'Save alignment' })).toBeDisabled();

  await pin(page, 100, 60);
  await expect(screen.locator('.al-pins li')).toHaveCount(1);
  await expect(screen.getByText('Add 2 more pins.')).toBeVisible();
  await pin(page, 940, 70);
  await pin(page, 120, 470);
  await expect(screen.getByText(/Three pins always fit exactly/)).toBeVisible();
  await pin(page, 900, 440);
  await expect(screen.locator('.al-pins li')).toHaveCount(4);
  await expect(screen.locator('.al-fit')).toContainText(/off by \d+\.\d px/);
  await expect(screen.locator('.al-overlay')).toBeVisible();

  await screen.getByRole('button', { name: 'Save alignment' }).click();
  await expect(screen).toBeHidden();
  await expect(page.getByText('Lined up with 4 pins')).toBeVisible();

  await page.getByRole('button', { name: 'Countries' }).click();
  await expect(page.locator('.fe-note')).toContainText(/Placed \d+ countries\./, { timeout: 30_000 });
  const names = await page.getByLabel('Nation name').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(names).toEqual(expect.arrayContaining(['Switzerland', 'Austria']));
  // Every nation sits on the map's land (x 600-1000, y 50-450 on the test map).
  const spots: { x: number; y: number }[] = await page.evaluate(() => (window as any).__fm.nations());
  expect(spots.length).toBe(names.length);
  for (const n of spots) expect(n.x >= 600 && n.x <= 1000 && n.y >= 50 && n.y <= 450).toBe(true);
});

test('backing out of the alignment keeps the map as it was', async ({ page }) => {
  await page.route('**/arcgisonline.com/**', (r) => r.fulfill({ body: TILE, contentType: 'image/png' }));
  await page.goto('/?fixture=render&editor=1');
  await page.waitForFunction(() => (window as any).__fm?.ready, null, { timeout: 20_000 });
  await page.getByRole('tab', { name: /Nations/ }).click();
  await page.getByRole('button', { name: 'Line up with Earth' }).click();
  await page.waitForFunction(() => (window as any).__align?.ready && (window as any).__align?.mapPoint, null, { timeout: 20_000 });
  await pin(page, 100, 60);
  await page.keyboard.press('Escape'); // deselects the new pin
  await page.keyboard.press('Escape'); // leaves
  await expect(page.getByRole('dialog', { name: 'Line up with Earth' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Line up with Earth' })).toBeVisible();
});
