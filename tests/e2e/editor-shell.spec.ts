import { test, expect, type Page } from '@playwright/test';

async function toScreen(page: Page, x: number, y: number) {
  const box = (await page.locator('canvas[data-overlay]').boundingBox())!;
  const s = await page.evaluate(([mx, my]) => (window as any).__fm.mapToScreen(mx, my), [x + 0.5, y + 0.5]);
  return { x: box.x + s.x, y: box.y + s.y };
}

test.describe('editor shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/?fixture=render&editor=1');
    await page.waitForFunction(() => (window as any).__fm?.ready, null, { timeout: 20_000 });
    await page.evaluate(() => (window as any).__fm.idle());
  });

  test('brush cursor outlines exactly the painted pixels and hides the OS cursor', async ({ page }) => {
    await page.keyboard.press('b');
    await page.evaluate(() => (window as any).__fm.setBrushDiameter(5));
    const p = await toScreen(page, 300, 300);
    await page.mouse.move(p.x, p.y);
    await expect.poll(() => page.evaluate(() => (window as any).__fm.lastBrushCells?.length)).toBe(21);
    const cursor = await page.locator('canvas[data-overlay]').evaluate((el) => getComputedStyle(el).cursor);
    expect(cursor).toBe('none');
  });

  test('painting is undoable with Ctrl+Z', async ({ page }) => {
    await page.keyboard.press('b');
    await page.getByRole('button', { name: 'Plains' }).click();
    const p = await toScreen(page, 300, 300);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.evaluate(() => (window as any).__fm.idle());
    const painted = await page.evaluate(() => (window as any).__fm.readMapPixel(300, 300));
    expect(painted).toEqual([190, 210, 138]);
    await page.keyboard.press('Control+z');
    await page.evaluate(() => (window as any).__fm.idle());
    const restored = await page.evaluate(() => (window as any).__fm.readMapPixel(300, 300));
    expect(restored).toEqual([61, 123, 171]);
  });

  test('the view toggle switches views', async ({ page }) => {
    await page.getByRole('button', { name: 'Elevation' }).click();
    expect(await page.evaluate(() => (window as any).__fm.view())).toBe('elevation');
    await page.getByRole('button', { name: 'After export' }).click();
    expect(await page.evaluate(() => (window as any).__fm.view())).toBe('export');
  });
});
