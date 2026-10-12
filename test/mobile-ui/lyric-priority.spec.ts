import { test, expect, clickPlayerTool } from './fixtures';

// lyric-priority.spec.ts — original parsing/selection and settings over a controlled, persisted native fixture.
test('priority persists, changes automatic lyrics and leaves a manual selection authoritative', async ({ page }, info) => {
  await page.addInitScript(() => {
    const win = window as any;
    win.fixtureNoServer = true; win.fixtureLyricTools = true;
    win.fixtureLocalLyric = { content: '[00:00.00]同目录歌词\n[00:10.00]下一行', fileName: 'priority.lrc',
      matched: { title: 'Song', titleOrigin: 'manual-match', artistNames: [], matchedLyricsSource: 'qq',
        matchedLyrics: { lines: [{ fullText: '在线匹配歌词', startTime: 0, endTime: 10, words: [] }] } } };
  });
  await page.goto('/mobile.html');
  const settings = page.getByRole('dialog', { name: '服务器与外观', exact: true });
  await page.getByRole('button', { name: '服务器与外观' }).tap();
  const choice = settings.getByRole('combobox', { name: '本地歌曲歌词优先级' });
  await expect(choice).toHaveValue('local');
  await choice.selectOption('online');
  await expect.poll(() => page.evaluate(() => (window as any).fixtureLyricSettings.localLyricsPriority)).toBe('online');
  await page.reload();
  await page.getByRole('button', { name: '服务器与外观' }).tap();
  await expect(choice).toHaveValue('online');
  await page.evaluate(() => { (window as any).fixtureLyricSettingsFailure = true; });
  await choice.selectOption('local');
  await expect(settings.getByRole('alert')).toContainText('歌词偏好未能保存或恢复');
  await expect(choice).toHaveValue('online');
  await page.setViewportSize(info.project.name === 'phone' ? { width: 844, height: 390 } : { width: 834, height: 1194 });
  await expect(choice).toBeVisible();
  expect((await choice.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await settings.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await settings.getByRole('button', { name: '关闭', exact: true }).tap();
  await page.getByRole('button', { name: '导入音乐', exact: true }).tap();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).tap();
  await page.evaluate(() => (window as any).fixtureEmitPlayback({ playing: false, position: 1 }));
  const lyrics = page.getByRole('dialog', { name: '歌词', exact: true });
  const timeline = page.getByRole('dialog', { name: '时间线', exact: true });
  await clickPlayerTool(page, '歌词');
  await expect(lyrics.getByRole('button', { name: 'QQ 音乐', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await lyrics.getByRole('button', { name: '时间线', exact: true }).tap();
  await expect(timeline.locator('[data-lyric-start]').filter({ hasText: '在线匹配歌词' })).toBeVisible();
  await timeline.getByRole('button', { name: '关闭', exact: true }).tap();
  await lyrics.getByRole('button', { name: '本地', exact: true }).tap();
  await clickPlayerTool(page, '歌词');
  await expect(lyrics.getByRole('button', { name: '本地', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await lyrics.getByRole('button', { name: '时间线', exact: true }).tap();
  await expect(timeline.locator('[data-lyric-start]').filter({ hasText: '同目录歌词' })).toBeVisible();
});

test('failed preference restoration disables edits and can be retried', async ({ page }) => {
  await page.addInitScript(() => { const win = window as any; win.fixtureNoServer = true; win.fixtureLyricSettingsLoadFailure = true; });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '服务器与外观' }).tap();
  const region = page.getByRole('region', { name: '本地歌曲歌词优先级' });
  await expect(region.getByRole('combobox')).toBeDisabled();
  await expect(region.getByRole('alert')).toContainText('歌词偏好未能保存或恢复');
  await page.evaluate(() => { (window as any).fixtureLyricSettingsLoadFailure = false; });
  await region.getByRole('button', { name: '重试', exact: true }).tap();
  await expect(region.getByRole('combobox')).toBeEnabled();
  await expect(region.getByRole('alert')).toHaveCount(0);
});
