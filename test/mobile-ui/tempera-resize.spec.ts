import { test, expect } from './fixtures';
import { openOnlineVisualizer } from './online-visualizer-fixture';

// tempera-resize.spec.ts — isolate the real paused Pixi renderer's resize path from foreground restoration.
test('Tempera resizes a paused online lyric scene without stale filter textures', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const initial = page.viewportSize()!;
  await openOnlineVisualizer(page, 'netease', 'tempera');
  await expect(page.locator('.lyric-stage [aria-hidden=true] > canvas')).toBeVisible();
  await page.waitForTimeout(500);
  await page.setViewportSize({ width: initial.height, height: initial.width });
  await page.waitForTimeout(500);
  expect(errors).toEqual([]);
});
