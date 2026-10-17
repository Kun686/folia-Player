import { readFileSync } from 'node:fs';
import { test, expect, clickPlayerTool } from './fixtures';

// tempera-dialog-viewport.spec.ts — native-observed overflow, with explicit safe-area geometry and an empty queue.
const image = { name: 'Folia-QA-Canvas.png', mimeType: 'image/png',
  buffer: readFileSync(new URL('../../ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', import.meta.url)) };

test('Tempera image editor keeps header and save inside safe area through rotation', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('visualizer_mode', 'tempera'));
  await page.goto('/mobile.html');
  // WebKit automation has no hardware cutout; model the same insets explicitly for this geometry test.
  await page.addStyleTag({ content: ':root { --safe-top: 59px; --safe-bottom: 34px; --safe-left: 0px; --safe-right: 0px; }' });
  await page.locator('.mini-title').tap();
  await clickPlayerTool(page, '歌词与动效');
  const settings = page.getByRole('dialog', { name: '歌词与动效', exact: true });
  await settings.getByRole('button', { name: '添加图片', exact: true }).tap();
  const overlay = page.locator('[data-folia-keyboard-window]').filter({ has: page.getByRole('heading', { name: '画布图片', exact: true }) });
  const header = overlay.getByRole('heading', { name: '画布图片', exact: true });
  const save = overlay.getByRole('button', { name: '保存', exact: true });
  const chooser = page.waitForEvent('filechooser');
  await overlay.getByRole('button', { name: '添加图片', exact: true }).tap();
  await (await chooser).setFiles(image);
  await expect(overlay.getByAltText(image.name, { exact: true })).toHaveCount(1);
  const assertSafe = async (top: number, bottom: number, left: number) => {
    await expect.poll(async () => {
      const h = await header.boundingBox(), s = await save.boundingBox();
      const size = page.viewportSize()!;
      return !!h && !!s && h.y >= top && s.y + s.height <= size.height - bottom
        && h.x >= left && s.x + s.width <= size.width - left;
    }).toBe(true);
    expect((await save.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  };
  await assertSafe(59, 34, 0);
  await page.screenshot({ path: info.outputPath('portrait.png') });
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: size.height, height: size.width });
  await page.addStyleTag({ content: ':root { --safe-top: 0px; --safe-bottom: 21px; --safe-left: 59px; --safe-right: 59px; }' });
  await assertSafe(12, 21, 59);
  await page.screenshot({ path: info.outputPath('rotated.png') });
  await save.tap();
  await expect(overlay).toHaveCount(0);
  await expect(settings.getByAltText(image.name, { exact: true })).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).fixturePlayback.queue)).toEqual([]);
});
