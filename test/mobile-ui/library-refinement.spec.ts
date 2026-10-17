import { readFileSync } from 'node:fs';
import { test, expect } from './fixtures';
import { revealMusicFeatures } from './music-features-navigation';

// library-refinement.spec.ts — captured QQ metadata, controlled transport; never real account/audio acceptance.
const songs = JSON.parse(readFileSync(new URL('./realLibrarySample.json', import.meta.url), 'utf8'));
const lyricSample = JSON.parse(readFileSync(new URL('./realPreviewSample.json', import.meta.url), 'utf8'));
const collectionName = '亦辰-z喜欢的音乐'; // Captured long collection label; transport below is controlled.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ songs, collectionName }) => {
    const w = window as any;
    localStorage.setItem('playback_entry_view', 'player');
    localStorage.setItem('playback_entry_view_chosen', 'true');
    localStorage.setItem('visualizer_mode', 'classic');
    w.fixtureSessions = { qq: { cookie: 'qqmusic_session=layout-fixture' } };
    w.fixtureOnlineRequest = async (payload: any) => {
      const path = new URL(payload.path, 'https://fixture.invalid').pathname;
      const reply = (body: unknown) => ({ status: 200, body: JSON.stringify(body), headers: {} });
      if (payload.provider !== 'qq') return reply({ code: 200, data: { profile: null }, profile: null });
      if (path === '/login/status') return reply({ code: 0, data: { profile: { uin: '77', nick: '布局验证' } } });
      if (path === '/user/playlist') return reply({ code: 200, playlist: [{ dirId: 201, dirName: collectionName, songNum: songs.length }], total: 1, more: false });
      if (path === '/user/liked-songs') return reply({ code: 200, songs, total: songs.length, more: false });
      return reply({ code: 200 });
    };
  }, { songs, collectionName });
  await page.goto('/mobile.html');
  await page.evaluate(async ({ songs, sample }) => {
    const w = window as any;
    await w.Capacitor.nativePromise('FoliaNative', 'writeLyricCache', { song: songs[5], token: 'initial', field: 'state',
      value: { lyricsSource: 'online', hasOnlineOverride: true, onlineOverrideLyrics: sample.lyrics } });
    w.fixtureEmitPlayback({ queue: songs, index: 5, currentSong: songs[5], position: sample.position, playing: false });
  }, { songs, sample: lyricSample });
});

test('library gives songs space, keeps collection actions and contains the features menu after rotation', async ({ page }, info) => {
  await page.getByRole('button', { name: 'QQ 音乐', exact: true }).tap();
  const collection = page.locator('.online-collections').getByRole('button', { name: collectionName, exact: true });
  await expect(collection).toBeVisible();
  const overviewHeading = (await page.locator('.library-section-heading').boundingBox())!;
  expect((await collection.boundingBox())!.y).toBeGreaterThanOrEqual(overviewHeading.y + overviewHeading.height);
  await expect(page.locator('.library-panel > .empty')).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('playlist-overview.png') });
  await collection.tap();
  const list = page.locator('.library-panel > .song-list');
  await expect(list).toBeVisible();
  const initial = page.viewportSize()!;
  if (initial.height > 600) expect((await list.boundingBox())!.height).toBeGreaterThanOrEqual(288);
  await expect(page.getByRole('button', { name: '加入播放队列', exact: true })).toBeEnabled();
  const title = page.locator('.library-section-title h2');
  await expect(title).toHaveText(collectionName);
  await expect(page.locator('.online-collections')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '返回歌单', exact: true })).toBeInViewport();
  expect(await title.evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
  const titleBox = (await title.boundingBox())!, actions = (await page.locator('.library-section-heading .collection-queue-actions').boundingBox())!;
  expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(actions.x);
  await page.screenshot({ path: info.outputPath('library.png') });
  await revealMusicFeatures(page);
  await expect(page.locator('.online-library-extras-body')).toBeInViewport();
  const before = (await list.boundingBox())!;
  await page.locator('.online-library-extras summary').tap();
  expect((await list.boundingBox())!.y).toBeCloseTo(before.y, 0);
  await page.setViewportSize({ width: initial.height, height: initial.width });
  await expect(page.getByRole('button', { name: '加入播放队列', exact: true })).toBeInViewport();
  await expect(page.getByRole('button', { name: '播放 ' + songs[0].name, exact: true })).toBeInViewport();
  await page.screenshot({ path: info.outputPath('library-rotated.png') });
  await page.getByRole('button', { name: '加入播放队列', exact: true }).tap();
  await expect(page.locator('.collection-queue-actions [role=status]')).toBeVisible();
  expect(await page.evaluate(() => (window as any).fixturePlayback.position)).toBe(lyricSample.position);
  const queueBeforeBack = await page.evaluate(() => (window as any).fixturePlayback.queue);
  await page.getByRole('button', { name: '返回歌单', exact: true }).tap();
  await expect(collection).toBeVisible();
  await expect(page.locator('.library-section-title h2')).toHaveText('我的歌单');
  expect(await page.evaluate(() => (window as any).fixturePlayback.queue)).toEqual(queueBeforeBack);
  expect(await page.evaluate(() => (window as any).fixturePlayback.position)).toBe(lyricSample.position);
});

test('library queue shares secondary actions and canceling clear preserves tracks', async ({ page }, info) => {
  await page.locator('.library-queue-toggle').tap();
  const library = page.locator('.library-panel');
  await expect(library.getByRole('heading', { name: '播放队列', exact: true })).toHaveCount(1);
  await expect(library.getByRole('button', { name: '音乐库', exact: true })).toBeVisible();
  await expect(library.getByRole('button', { name: '清空队列', exact: true })).not.toBeVisible();
  await library.locator('summary[aria-label="队列操作"]').tap();
  await expect(library.getByRole('button', { name: '保存为歌单', exact: true })).toHaveCount(0);
  await expect(library.locator('.queue-action-menu')).toBeInViewport();
  await page.screenshot({ path: info.outputPath('queue-actions.png') });
  page.once('dialog', dialog => dialog.dismiss());
  await library.getByRole('button', { name: '清空队列', exact: true }).tap();
  await expect(library.locator('.queue-menu')).not.toHaveAttribute('open', '');
  expect(await page.evaluate(() => (window as any).fixturePlayback.queue)).toEqual(songs);
  expect(await page.evaluate(() => (window as any).fixturePlayback.position)).toBe(lyricSample.position);
});

test('settings use consistent controls and persist language, insertion and wake preference without changing playback', async ({ page }, info) => {
  await page.locator('.brand').getByRole('button', { name: '设置', exact: true }).tap();
  const panel = page.locator('.settings-sheet');
  const autoLyrics = panel.getByRole('switch', { name: '自动使用最佳歌词', exact: true });
  const autoLyricsBefore = await autoLyrics.isChecked();
  await autoLyrics.setChecked(!autoLyricsBefore);
  await expect.poll(() => page.evaluate(() => (window as any).fixtureLyricSettings.autoUseBestLyric)).toBe(!autoLyricsBefore);
  const choices = panel.locator('.playback-view-options');
  await expect(choices.locator('[aria-pressed=true] .playback-view-check')).toBeVisible();
  await expect(choices.locator('[aria-pressed=false] .playback-view-check')).toBeHidden();
  for (const label of await choices.locator('button > span').all()) {
    expect(await label.evaluate(el => el.clientHeight <= parseFloat(getComputedStyle(el).lineHeight) + 1)).toBe(true);
  }
  await panel.getByRole('combobox', { name: '加入队列的位置', exact: true }).selectOption('next');
  const wake = panel.getByRole('switch', { name: '播放时保持亮屏', exact: true });
  await expect(wake).toBeEnabled(); await wake.check();
  await panel.getByRole('combobox', { name: '界面语言', exact: true }).selectOption('en');
  await expect(panel.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await panel.getByRole('combobox', { name: 'Interface language', exact: true }).selectOption('zh-CN');
  for (const row of await panel.locator('.preference-row').all()) {
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(row).toHaveCSS('flex-direction', 'row');
  }
  await expect(panel).toHaveJSProperty('scrollWidth', await panel.evaluate(el => el.clientWidth));
  await page.screenshot({ path: info.outputPath('settings.png') });
  await page.reload();
  await page.locator('.brand').getByRole('button', { name: '设置', exact: true }).tap();
  await expect(panel.getByRole('combobox', { name: '加入队列的位置', exact: true })).toHaveValue('next');
  await expect(wake).toBeChecked();
  await expect(autoLyrics).toBeChecked({ checked: !autoLyricsBefore });
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
});

test('queue starts at the current track and subsequent state updates preserve user scroll', async ({ page }, info) => {
  await page.locator('.mini-title').tap();
  await page.locator('.player-controls').getByRole('button', { name: '播放队列', exact: true }).tap();
  const panel = page.locator('.player-queue-host'), list = panel.locator('.song-list');
  await expect(panel.locator('.song-main[aria-current=true]')).toBeInViewport();
  await page.screenshot({ path: info.outputPath('queue-current.png') });
  await list.evaluate(el => { el.scrollTop = 0; });
  await page.evaluate(() => (window as any).fixtureEmitPlayback({ position: 166 }));
  await expect.poll(() => list.evaluate(el => el.scrollTop)).toBe(0);
  await expect(panel.getByRole('button', { name: '播放 ' + songs[0].name, exact: true })).toBeInViewport();
});
