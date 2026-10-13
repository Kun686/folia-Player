import type { Page } from '@playwright/test';
import { test, expect, clickPlayerTool } from './fixtures';
import { openOnlineVisualizer, rotationLyric as text } from './online-visualizer-fixture';

// tilt-rotation.spec.ts — rotation of original Tilt over cached online lyrics, without real provider requests.
async function layout(page: Page) {
  return page.locator('.lyric-stage .whitespace-nowrap').evaluateAll(nodes => nodes.map(node => ({
    text: node.textContent,
    fontSize: getComputedStyle(node).fontSize,
  })));
}
for (const providerId of ['qq', 'netease'] as const) test(`${providerId} Tilt reflows a paused line after rotation without reopening settings`, async ({ page }) => {
  const original = page.viewportSize()!;
  const landscape = { width: Math.max(original.width, original.height), height: Math.min(original.width, original.height) };
  const portrait = { width: landscape.height, height: landscape.width };
  await page.setViewportSize(landscape);
  await openOnlineVisualizer(page, providerId, 'tilt');
  await expect.poll(() => layout(page)).not.toEqual([]);
  await page.setViewportSize(portrait);
  // Let the existing resize-settle window and glyph entrance finish before comparing presentation.
  await page.waitForTimeout(1600);
  const rotated = await layout(page);
  await page.screenshot({ path: test.info().outputPath('rotated.png') });
  await clickPlayerTool(page, '歌词与动效');
  await page.locator('.visual-settings > header').getByRole('button', { name: '关闭', exact: true }).tap();
  await expect.poll(() => layout(page)).not.toEqual([]);
  const reopened = await layout(page);
  await page.waitForTimeout(1600);
  await page.screenshot({ path: test.info().outputPath('reopened.png') });
  await test.info().attach('layout', { body: JSON.stringify({ rotated, reopened }, null, 2), contentType: 'application/json' });
  expect(rotated).toEqual(reopened);
  expect(rotated.map(segment => segment.text).join('')).toBe(text);
  // A second resize while still paused must reflow again; compare against the same original renderer mounted at that size.
  await page.setViewportSize(landscape);
  await page.waitForTimeout(250);
  const restored = await layout(page);
  await clickPlayerTool(page, '歌词与动效');
  await page.locator('.visual-settings > header').getByRole('button', { name: '关闭', exact: true }).tap();
  await expect.poll(() => layout(page)).toEqual(restored);
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
});
