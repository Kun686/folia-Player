import { test, expect, clickPlayerTool } from './fixtures';

// font-size-touch.spec.ts — exercise the real range control rather than assigning its value in JavaScript.
for (const mode of ['classic', 'cadenza']) test(`${mode} lyric size responds to touch and drag`, async ({ page }) => {
  await page.addInitScript(() => {
    const win = window as any;
    win.fixtureNoServer = true;
    win.fixtureLocalLyric = { embeddedContent: '[00:00.00]字号测试\n[00:10.00]第二句', lyricsSource: 'embedded' };
  });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
  await page.evaluate(() => (window as any).fixtureEmitPlayback({ playing: false, position: 1 }));
  await clickPlayerTool(page, '歌词与动效');
  await page.getByLabel('歌词动画', { exact: true }).selectOption(mode);
  const dialog = page.getByRole('dialog', { name: '歌词与动效', exact: true });
  const common = dialog.locator('.typography-controls > details').nth(0);
  await common.locator('summary').click();
  const slider = common.getByRole('slider', { name: /^字号/ });
  await slider.scrollIntoViewIfNeeded();
  await expect(slider).toBeEnabled();
  const bounds = (await slider.boundingBox())!;
  await page.screenshot({ path: test.info().outputPath('font-size-before-touch.png') });
  await page.touchscreen.tap(bounds.x + bounds.width - 10, bounds.y + bounds.height / 2);
  await expect(slider).toHaveValue('1.4');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('lyrics_font_scale'))).toBe('1.4');
  await page.touchscreen.tap(bounds.x + 10, bounds.y + bounds.height / 2);
  await expect(slider).toHaveValue('0.85');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('lyrics_font_scale'))).toBe('0.85');
  await page.mouse.move(bounds.x + 10, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width - 10, bounds.y + bounds.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(slider).toHaveValue('1.4');
});
