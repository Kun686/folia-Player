import { test, expect } from './fixtures';

// layout.spec.ts — window resizing uses the same native state; safe insets are simulated, not device acceptance.
const frames = [
  { width: 414, height: 896, top: 44, bottom: 34, side: 0 },
  { width: 896, height: 414, top: 0, bottom: 21, side: 44 },
  { width: 932, height: 430, top: 0, bottom: 21, side: 59 },
  { width: 375, height: 667, top: 20, bottom: 0, side: 0 },
  { width: 1194, height: 834, top: 24, bottom: 20, side: 0 },
  { width: 834, height: 1194, top: 24, bottom: 20, side: 0 },
  { width: 600, height: 834, top: 24, bottom: 20, side: 0 },
  { width: 320, height: 667, top: 20, bottom: 0, side: 0 },
];
for (const light of [false, true]) test(`rotation keeps playback, safe controls and dialogs in view (${light ? 'light' : 'dark'})`, async ({ page }, info) => {
  test.skip(info.project.name !== 'phone');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    (window as any).fixtureNoServer = true; (window as any).fixtureMany = true;
    (window as any).fixtureLyricTools = true;
    (window as any).fixtureLocalLyric = { content: '[2000,8000](2000,8000,0)第一句歌词\n[10000,10000](10000,10000,0)第二句歌词', fileName: 'layout.yrc' };
    localStorage.setItem('folia_transition_animation', 'false');
    localStorage.setItem('folia_transition_animation_card', 'false');
  });
  await page.goto('/mobile.html');
  await expect(page).toHaveTitle('Folia');
  if (light) {
    await page.getByRole('button', { name: '服务器与外观', exact: true }).click();
    await page.getByRole('dialog').locator('select').selectOption('light');
    await page.getByRole('button', { name: '关闭', exact: true }).click();
  }
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.screenshot({ path: `/tmp/folia-after-library-${light ? 'light' : 'dark'}.png` });
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
  await expect(page.locator('.player-controls').getByText('暂无歌词', { exact: true })).toHaveCount(0);
  await page.evaluate(() => {
    const win = window as any;
    win.fixtureEmitPlayback({ position: 5, currentSong: { ...win.fixturePlayback.currentSong,
      name: '测试歌曲 · 很长的歌名也不应该挤走控制按钮', artists: [{ id: 1, name: '测试歌手 / 合作歌手 / Artist' }] } });
  });
  const commands = await page.evaluate(() => (window as any).fixtureCommands.length);
  for (const frame of frames) {
    await page.setViewportSize({ width: frame.width, height: frame.height });
    await page.locator('.mobile-app').evaluate((element, frame) => {
      const style = (element as HTMLElement).style;
      style.setProperty('--safe-top', `${frame.top}px`); style.setProperty('--safe-bottom', `${frame.bottom}px`);
      style.setProperty('--safe-left', `${frame.side}px`); style.setProperty('--safe-right', `${frame.side}px`);
    }, frame);
    const split = frame.width >= 850 && frame.height >= 600;
    await expect(page.locator('.mobile-app')).toHaveAttribute('data-layout', split ? 'split' : 'compact');
    await expect(page.locator('.library-panel')).toHaveJSProperty('inert', !split);
    // Hit-test the actual button center: visibility alone does not catch clipped or covered targets.
    for (const label of ['暂停', '上一首', '下一首']) {
      const button = page.locator('.player-panel').getByRole('button', { name: label, exact: true });
      await expect.poll(async () => button.evaluate((el, frame) => {
        const r = el.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return r.width >= 44 && r.height >= 44 && r.x >= frame.side && r.right <= innerWidth - frame.side
          && r.y >= frame.top && r.bottom <= innerHeight - frame.bottom && (hit === el || el.contains(hit));
      }, frame)).toBe(true);
    }
    const stage = (await page.locator('.lyric-stage').boundingBox())!;
    expect(stage.width).toBeGreaterThan(175); expect(stage.height).toBeGreaterThanOrEqual(180);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('.player-controls').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: `/tmp/folia-after-${frame.width}-${light ? 'light' : 'dark'}.png` });
  }
  expect(await page.evaluate(() => (window as any).fixtureCommands.length)).toBe(commands);
  await page.locator('.player-panel').getByRole('button', { name: '暂停', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).fixturePlayback.playing)).toBe(false);
  await page.getByRole('button', { name: '返回音乐库' }).tap();
  await expect(page.locator('.library-panel')).toHaveJSProperty('inert', false);
  await page.getByRole('textbox', { name: '搜索歌曲' }).fill('音乐3');
  await expect(page.locator('.song-main')).toHaveCount(1);
  await page.getByRole('button', { name: '服务器与外观', exact: true }).tap();
  await page.setViewportSize({ width: 896, height: 414 });
  const dialog = page.getByRole('dialog', { name: '服务器与外观', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeInViewport();
  await dialog.getByRole('button', { name: '关闭', exact: true }).tap();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(errors).toEqual([]);
});
