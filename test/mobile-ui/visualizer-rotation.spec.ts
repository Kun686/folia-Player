import { test, expect } from './fixtures';
import { BUILTIN_VISUALIZER_MODES } from '../../src/types/visualizerModes';
import { openOnlineVisualizer } from './online-visualizer-fixture';

// visualizer-rotation.spec.ts — viewport/lifecycle evidence for every original mode; screenshots do not prove device performance.
for (const [index, mode] of BUILTIN_VISUALIZER_MODES.entries()) test(`${mode} retains the full stage and online song through rotation and foreground restoration`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await openOnlineVisualizer(page, index % 2 ? 'qq' : 'netease', mode);
  const stage = page.locator('.lyric-stage');
  const initial = page.viewportSize()!;
  const ready = async () => {
    await expect(stage.locator('.empty-lyrics')).toHaveCount(0);
    // These modes rasterize lyrics; their glyphs are not DOM text. Inspect saved pixels separately.
    if (['fume', 'lumiere', 'sonnet', 'tempera', 'diorama'].includes(mode)) {
      await expect(stage.locator('canvas').last()).toBeVisible();
    } else await expect.poll(() => stage.textContent()).toMatch(/晚|风|轻|窗|我们|星光/);
  };
  await ready();
  const state = await page.evaluate(() => (window as any).fixturePlayback);
  for (const [name, size] of [['original', initial], ['rotated', { width: initial.height, height: initial.width }]] as const) {
    await page.setViewportSize(size);
    await expect.poll(async () => {
      const r = (await stage.boundingBox())!;
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }).toEqual({ x: 0, y: 0, ...size });
    await page.waitForTimeout(1400);
    await page.screenshot({ path: test.info().outputPath(`${name}.png`) });
  }
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(stage.locator('.empty-lyrics')).toBeVisible();
  await expect(stage.locator('canvas')).toHaveCount(0);
  await page.setViewportSize(initial);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await ready();
  await page.waitForTimeout(1400);
  await page.screenshot({ path: test.info().outputPath('restored.png') });
  expect(await page.evaluate(() => (window as any).fixturePlayback)).toEqual(state);
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
  expect(errors).toEqual([]);
});
