import { test, expect, type Page } from '@playwright/test';

async function clickMap(page: Page, x: number, y: number) {
  const box = (await page.locator('canvas[data-overlay]').boundingBox())!;
  const s = await page.evaluate(([mx, my]) => (window as any).__fm.mapToScreen(mx, my), [x + 0.5, y + 0.5]);
  await page.mouse.click(box.x + s.x, box.y + s.y);
}

test('the spawn tool places nations and Checks flags one in water', async ({ page }) => {
  await page.goto('/?fixture=render&editor=1');
  await page.waitForFunction(() => (window as any).__fm?.ready, null, { timeout: 20_000 });
  await page.keyboard.press('n');
  await clickMap(page, 650, 250);
  await expect(page.getByRole('textbox', { name: 'Nation name' })).toHaveValue('Nation 1');
  await clickMap(page, 300, 300);
  await expect(page.getByRole('textbox', { name: 'Nation name' })).toHaveCount(2);
  await page.getByRole('tab', { name: 'Checks' }).click();
  await expect(page.getByText('Spawns in water (1)')).toBeVisible({ timeout: 10_000 });
});
