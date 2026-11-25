import { test, expect, type Page } from '@playwright/test';

async function open(page: Page, fixture: string) {
  await page.goto(`/?fixture=${fixture}&editor=1`);
  await page.waitForFunction(() => (window as any).__fm?.ready, null, { timeout: 20_000 });
  await page.evaluate(() => (window as any).__fm.idle());
}

/** Screen position of a map cell's centre. */
async function at(page: Page, x: number, y: number) {
  const box = (await page.locator('canvas[data-overlay]').boundingBox())!;
  const s = await page.evaluate(([x, y]) => (window as any).__fm.mapToScreen(x + 0.5, y + 0.5), [x, y]);
  return { x: box.x + s.x, y: box.y + s.y };
}

async function drag(page: Page, from: [number, number], to: [number, number]) {
  const a = await at(page, ...from), b = await at(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
}

const terrainAt = (page: Page, x: number, y: number) =>
  page.evaluate(([x, y]) => {
    const g = (window as any).__fm.controller.grid;
    return g.terrain[y * g.width + x];
  }, [x, y]);

test('Grow rivers previews its changes, then keeps the rivers on export', async ({ page }) => {
  await open(page, 'rivers');
  await expect(page.getByText(/lakes under 200 px fill in/)).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Grow rivers…' }).click();
  const plan = page.getByRole('region', { name: 'Grow rivers preview' });
  await expect(plan).toContainText('corner joints');
  await expect(plan).toContainText('1 round pond');
  expect(await terrainAt(page, 432, 150)).toBe(1); // still land: only a preview
  await plan.getByRole('button', { name: 'Apply' }).click();
  await expect(plan).toBeHidden();
  expect(await terrainAt(page, 432, 150)).toBe(0);
  // Left: the round pond and the short river piece.
  await expect(page.getByText('2 lakes under 200 px fill in')).toBeVisible({ timeout: 10_000 });
});

test('a selection can be moved, and undo puts it back', async ({ page }) => {
  await open(page, 'render');
  await page.keyboard.press('m');
  await drag(page, [195, 95], [210, 106]); // around the 5x2 island at (200, 100)
  await drag(page, [201, 100], [301, 150]); // move it 100 right, 50 down
  await expect(page.getByRole('button', { name: 'Place' })).toBeVisible();
  await page.keyboard.press('Enter');
  expect(await terrainAt(page, 200, 100)).toBe(0);
  expect(await terrainAt(page, 300, 150)).toBe(1);
  await page.keyboard.press('Control+z');
  expect(await terrainAt(page, 200, 100)).toBe(1);
  expect(await terrainAt(page, 300, 150)).toBe(0);
});

test('mirror painting copies strokes across the centre', async ({ page }) => {
  await open(page, 'render');
  await page.keyboard.press('b');
  await page.getByRole('button', { name: 'Half turn around the centre' }).click();
  const p = await at(page, 300, 200);
  await page.mouse.click(p.x, p.y);
  expect(await terrainAt(page, 300, 200)).toBe(1);
  expect(await terrainAt(page, 1023 - 300, 511 - 200)).toBe(1);
});

test('the river tool says whether a river stays', async ({ page }) => {
  await open(page, 'render');
  await page.keyboard.press('l');
  await drag(page, [610, 200], [650, 260]); // inside the land block, reaching nothing
  await expect(page.getByRole('status').filter({ hasText: 'fills in on export' })).toBeVisible();
  await drag(page, [620, 300], [560, 300]); // runs out into the sea
  await expect(page.getByRole('status').filter({ hasText: 'This river stays on export' })).toBeVisible();
});

test('the magic wand selects connected terrain', async ({ page }) => {
  await open(page, 'render');
  await page.keyboard.press('w');
  const p = await at(page, 650, 200);
  await page.mouse.click(p.x, p.y);
  const area = await page.evaluate(() => {
    const { selection } = (window as any).__fm;
    const s = selection();
    return s ? s.w * s.h : 0;
  });
  expect(area).toBe(401 * 400);
});
