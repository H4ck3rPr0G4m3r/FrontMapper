import { test, expect, type Page } from '@playwright/test';

type RGB = [number, number, number];

async function pixelAt(page: Page, mx: number, my: number): Promise<RGB> {
  return page.evaluate(([x, y]) => (window as any).__fm.readMapPixel(x, y), [mx, my]);
}

function near(actual: RGB, expected: RGB) {
  for (let k = 0; k < 3; k++) expect(Math.abs(actual[k] - expected[k]), `${actual} vs ${expected}`).toBeLessThanOrEqual(2);
}

test.describe('segment renderer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?fixture=render');
    await page.waitForFunction(() => (window as any).__fm?.ready, null, { timeout: 20_000 });
    await page.evaluate(() => (window as any).__fm.idle());
  });

  test('game view uses the OpenFront terrain palette', async ({ page }) => {
    near(await pixelAt(page, 650, 250), [190, 220, 138]); // plains mag 0
    near(await pixelAt(page, 800, 250), [230, 213, 168]); // highlands mag 15
    near(await pixelAt(page, 950, 250), [240, 240, 240]); // mountains mag 25
    near(await pixelAt(page, 300, 300), [61, 123, 171]); // deep water
    near(await pixelAt(page, 599, 250), [100, 143, 255]); // shore water
  });

  test('elevation view is greyscale', async ({ page }) => {
    await page.evaluate(() => (window as any).__fm.setView('elevation'));
    await page.evaluate(() => (window as any).__fm.idle());
    near(await pixelAt(page, 650, 250), [60, 60, 60]);
    near(await pixelAt(page, 950, 250), [223, 223, 223]);
  });

  test('cells removed on export are red, and gone in the export view', async ({ page }) => {
    await page.evaluate(() => (window as any).__fm.simulate());
    await page.evaluate(() => (window as any).__fm.idle());
    near(await pixelAt(page, 201, 100), [255, 40, 40]);
    await page.evaluate(() => (window as any).__fm.setView('export'));
    await page.evaluate(() => (window as any).__fm.idle());
    near(await pixelAt(page, 201, 100), [61, 123, 171]);
  });
});

test('a 10000x5000 map uses textures no larger than 256', async ({ page }) => {
  await page.goto('/?fixture=huge');
  await page.waitForFunction(() => (window as any).__fm?.ready, null, { timeout: 20_000 });
  // The first segment uploads a frame or two after the renderer is ready.
  await page.waitForFunction(() => (window as any).__fm.maxTextureDim() > 0);
  const dim = await page.evaluate(() => (window as any).__fm.maxTextureDim());
  expect(dim).toBeLessThanOrEqual(256);
  expect(dim).toBeGreaterThan(0);
});
