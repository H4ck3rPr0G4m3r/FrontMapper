import { test, expect, type Page } from '@playwright/test';
import { encode } from 'fast-png';

async function openFixture(page: Page, fixture: string) {
  await page.goto(`/?fixture=${fixture}&editor=1`);
  await page.waitForFunction(() => (window as any).__fm?.ready, null, { timeout: 20_000 });
  await page.evaluate(() => (window as any).__fm.idle());
}

async function clickMap(page: Page, x: number, y: number) {
  const box = (await page.locator('canvas[data-overlay]').boundingBox())!;
  const s = await page.evaluate(([x, y]) => (window as any).__fm.mapToScreen(x + 0.5, y + 0.5), [x, y]);
  await page.mouse.click(box.x + s.x, box.y + s.y);
}

const terrainAt = (page: Page, x: number, y: number) =>
  page.evaluate(([x, y]) => {
    const g = (window as any).__fm.controller.grid;
    return g.terrain[y * g.width + x];
  }, [x, y]);

/** A 64x32 greyscale ramp: black on the left, white on the right. */
function rampPng() {
  const w = 64, h = 32, data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([x * 4, x * 4, x * 4, 255], (y * w + x) * 4);
  return Buffer.from(encode({ width: w, height: h, data, channels: 4 }));
}

test('a generated map opens with nothing lost on export, and shows its terrain mix', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await page.getByRole('button', { name: '2000 × 1500' }).click();
  await page.getByRole('button', { name: 'Generate map' }).click();
  await expect(page.locator('.ed')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('No islands get deleted')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('No lakes fill in')).toBeVisible();
  await expect(page.getByRole('img', { name: /Water \d+%, Plains/ })).toBeVisible();
});

test('a heightmap becomes water below the chosen level and land above it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Heightmap', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Choose a heightmap/ }).click();
  await (await chooser).setFiles({ name: 'ramp.png', mimeType: 'image/png', buffer: rampPng() });
  await expect(page.getByRole('img', { name: 'Preview of the map from the heightmap' })).toBeVisible();
  await page.getByRole('button', { name: 'Create map' }).click();
  await page.waitForFunction(() => (window as any).__fm?.ready, null, { timeout: 20_000 });
  expect(await terrainAt(page, 1, 10)).toBe(0);
  expect(await terrainAt(page, 60, 10)).toBe(1);
});

test('a checkpoint brings the map back', async ({ page }) => {
  await openFixture(page, 'render');
  await page.getByRole('button', { name: 'Checkpoints' }).click();
  await page.getByRole('textbox', { name: 'Checkpoint name' }).fill('before land');
  await page.getByRole('dialog', { name: 'Checkpoints' }).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('before land')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('b');
  await clickMap(page, 300, 200);
  expect(await terrainAt(page, 300, 200)).toBe(1);
  await page.getByRole('button', { name: 'Checkpoints' }).click();
  const row = page.locator('.cp-list li', { hasText: 'before land' });
  await row.getByRole('button', { name: 'Restore' }).click();
  await row.getByRole('button', { name: 'Restore' }).click();
  await page.waitForFunction(() => (window as any).__fm?.controller.grid.terrain[200 * 1024 + 300] === 0, null, { timeout: 10_000 });
  // The map before restoring was kept as a checkpoint too.
  await page.getByRole('button', { name: 'Checkpoints' }).click();
  await expect(page.getByText('Before restoring "before land"')).toBeVisible();
});

test('the shortcut sheet opens with ? and closes with Esc', async ({ page }) => {
  await openFixture(page, 'render');
  await page.keyboard.press('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeHidden();
});

test('a reference image can be loaded and its opacity changed', async ({ page }) => {
  await openFixture(page, 'render');
  await page.getByRole('button', { name: 'Reference image' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose image…' }).click();
  await (await chooser).setFiles({ name: 'sketch.png', mimeType: 'image/png', buffer: rampPng() });
  await expect(page.getByText('sketch.png')).toBeVisible();
  await expect(page.getByText('50%')).toBeVisible();
  await page.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Show', exact: true })).toBeVisible();
});

test('nations on a hand-made map show their starting room', async ({ page }) => {
  await openFixture(page, 'render');
  await page.keyboard.press('n');
  await clickMap(page, 620, 100);
  await clickMap(page, 980, 400);
  await clickMap(page, 101, 301); // the 3x3 island
  await page.getByRole('tab', { name: /Nations/ }).click();
  await expect(page.getByText('Starting room')).toBeVisible();
  await expect(page.locator('.room-row')).toHaveCount(3, { timeout: 10_000 });
  await expect(page.locator('.room-row.tight')).toHaveCount(1);
});

test('the nation guide shows the typical range and lobby sizes for the land', async ({ page }) => {
  await openFixture(page, 'render');
  await page.getByRole('tab', { name: /Nations/ }).click();
  await expect(page.getByRole('heading', { name: /How many nations/ })).toBeVisible({ timeout: 10_000 });
  // 160,800 land tiles: about 8 large-lobby players, 1 to 3 nations typical.
  await expect(page.getByRole('img', { name: /Most maps with this much land have 1 to 3 nations/ })).toBeVisible();
  await expect(page.locator('.guide-kv')).toContainText('8 players');
  await page.getByRole('tab', { name: /Checks/ }).click();
  await expect(page.getByText('Maps with this much land usually have 1 to 3 nations.')).toBeVisible();
});
