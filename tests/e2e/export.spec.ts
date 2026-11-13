import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';

test('Export refuses invalid info, then downloads the map zip', async ({ page }) => {
  await page.goto('/?fixture=render&editor=1');
  await page.waitForFunction(() => (window as any).__fm?.ready, null, { timeout: 20_000 });
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Fix the map info first');
  await page.getByRole('button', { name: 'Dismiss' }).click();

  await page.getByRole('tab', { name: 'Info' }).click();
  await page.getByLabel('Map name').fill('Test Sea');
  await page.getByRole('group', { name: 'Categories' }).getByRole('button', { name: 'Fictional' }).click();
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export', exact: true }).click()]);
  expect(dl.suggestedFilename()).toBe('testsea.zip');
  const files = unzipSync(new Uint8Array(readFileSync(await dl.path())));
  expect(Object.keys(files).sort()).toEqual(['CREDITS.md.snippet', 'frontmapper.json', 'preview.png', 'testsea/image.png', 'testsea/info.json']);
});

test('Save downloads a .frontmap project', async ({ page }) => {
  await page.goto('/?fixture=render&editor=1');
  await page.waitForFunction(() => (window as any).__fm?.ready, null, { timeout: 20_000 });
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save' }).click()]);
  expect(dl.suggestedFilename()).toMatch(/\.frontmap$/);
});
