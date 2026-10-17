import { revealMusicFeatures } from './music-features-navigation';
import type { Page } from '@playwright/test';
import { test, expect, revealPlayerControls } from './fixtures';
import { replacementFixture } from './song-replacement-fixture';
import { seedSearchQueue } from './search-playback-fixture';

// song-replacement.spec.ts — explicit consent, same-provider replacement and native-intent isolation on touch layouts.
const prompt = (page: Page) => page.getByRole('dialog', { name: '播放其他版本', exact: true });
async function openPlaylist(page: Page) {
  await page.getByRole('button', { name: '搜索回归歌单', exact: true }).tap();
  await expect(page.getByRole('button', { name: '播放 歌单歌曲200', exact: true })).toBeEnabled();
}
async function offer(page: Page) { await page.getByRole('button', { name: '播放 歌单歌曲200', exact: true }).tap(); }
const playback = (page: Page) => page.evaluate(() => structuredClone((window as any).fixturePlayback));
test.beforeEach(async ({ page }) => { await replacementFixture(page); });

test('lookup and cancel leave audio intact; confirmation uses the original queue transform once', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/mobile.html'); await seedSearchQueue(page); await openPlaylist(page);
  const before = await playback(page); await offer(page);
  await expect(prompt(page)).toBeVisible(); await expect(prompt(page).getByText('其他版本900', { exact: true })).toBeVisible();
  expect(await playback(page)).toEqual(before);
  await prompt(page).getByRole('button', { name: '取消', exact: true }).tap();
  await expect(prompt(page)).toHaveCount(0); expect(await playback(page)).toEqual(before);
  await offer(page); await prompt(page).getByRole('button', { name: '播放其他版本', exact: true }).tap();
  await expect.poll(async () => (await playback(page)).currentSong?.sourceRef).toEqual({ kind: 'online', providerId: 'netease', mediaId: '900' });
  const after = await playback(page); expect(after.queue.map((s: any) => s.sourceRef.mediaId)).toEqual(['900', '201']);
  expect(after.index).toBe(0); expect(after.playing).toBe(true);
  expect(await page.evaluate(() => (window as any).searchPlaybackCalls.map((v: any) => v.method))).toEqual(['editQueue', 'selectQueue']);
  expect(await page.evaluate(() => (window as any).replacementCalls)).toEqual(Array(2).fill({ provider: 'netease', path: '/song/copyright/rcmd', id: '200' }));
  expect(errors).toEqual([]);
});
test('the original legacy song-id route also requires confirmation', async ({ page }) => {
  await page.addInitScript(() => { (window as any).replacementLegacy = true; });
  await page.goto('/mobile.html'); await seedSearchQueue(page); await openPlaylist(page); await offer(page);
  await expect(prompt(page)).toBeVisible();
  expect(await page.evaluate(() => (window as any).replacementCalls)).toEqual([{ provider: 'netease', path: '/song/detail', id: '900' }]);
  expect(await page.evaluate(() => (window as any).searchPlaybackCalls)).toEqual([]);
  await prompt(page).getByRole('button', { name: '取消', exact: true }).tap();
});
test('an older gateway shows a clear message without lookup or playback', async ({ page }) => {
  await page.addInitScript(() => { delete (window as any).fixtureHealth.replacementProviders; });
  await page.goto('/mobile.html'); await seedSearchQueue(page); await openPlaylist(page); await offer(page);
  await expect(page.getByText('此音乐来源或服务器暂不支持查询其他版本。', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).replacementCalls)).toEqual([]);
  expect(await page.evaluate(() => (window as any).searchPlaybackCalls)).toEqual([]);
});
test('no replacement leaves playback intact and reports the result', async ({ page }) => {
  await page.addInitScript(() => { (window as any).replacementMissing = true; });
  await page.goto('/mobile.html'); await seedSearchQueue(page); await openPlaylist(page); const before = await playback(page); await offer(page);
  await expect(page.getByText('未找到可播放的其他版本。', { exact: true })).toBeVisible();
  await expect(prompt(page)).toHaveCount(0); expect(await playback(page)).toEqual(before);
});
for (const action of ['logout', 'navigation'] as const) test(`a late replacement after ${action} cannot open or play`, async ({ page }) => {
  await page.goto('/mobile.html'); await seedSearchQueue(page); await openPlaylist(page);
  await page.evaluate(() => { (window as any).replacementDelay = true; }); await offer(page);
  await expect.poll(() => page.evaluate(() => typeof (window as any).releaseReplacement)).toBe('function');
  await expect(page.getByRole('button', { name: '播放 歌单歌曲200', exact: true })).toBeDisabled();
  if (action === 'logout') await page.getByRole('button', { name: '退出登录', exact: true }).tap();
  else await page.getByRole('button', { name: 'QQ 音乐', exact: true }).tap();
  await page.evaluate(() => { (window as any).releaseReplacement(); });
  await expect(page.getByText('播放队列已变化，请重新选择歌曲。', { exact: true })).toBeVisible();
  await expect(prompt(page)).toHaveCount(0); expect(await page.evaluate(() => (window as any).searchPlaybackCalls)).toEqual([]);
});
test('remote queue advance while the prompt is open wins over confirmation', async ({ page }) => {
  await page.goto('/mobile.html'); await seedSearchQueue(page); await openPlaylist(page); await offer(page); await expect(prompt(page)).toBeVisible();
  await page.evaluate(() => { const w = window as any, s = w.fixturePlayback;
    w.fixtureEmitPlayback({ index: 1, currentSong: s.queue[1], queueRevision: s.queueRevision + 1, position: 15 }); });
  const remote = await playback(page); await prompt(page).getByRole('button', { name: '播放其他版本', exact: true }).tap();
  await expect(page.getByText('播放队列已变化，请重新选择歌曲。', { exact: true })).toBeVisible();
  expect(await playback(page)).toEqual(remote); expect(await page.evaluate(() => (window as any).searchPlaybackCalls)).toEqual([]);
});
test('daily recommendations remain open after cancel and close only after confirmed playback', async ({ page }) => {
  await page.goto('/mobile.html'); await seedSearchQueue(page);
  await revealMusicFeatures(page); await page.getByRole('button', { name: '每日推荐', exact: true }).tap();
  const daily = page.getByRole('dialog', { name: '每日推荐', exact: true });
  await daily.getByRole('button', { name: '播放 歌单歌曲200', exact: true }).tap(); await expect(prompt(page)).toBeVisible();
  await prompt(page).getByRole('button', { name: '取消', exact: true }).tap(); await expect(daily).toBeVisible();
  expect(await page.evaluate(() => (window as any).searchPlaybackCalls)).toEqual([]);
  await daily.getByRole('button', { name: '播放 歌单歌曲200', exact: true }).tap();
  await prompt(page).getByRole('button', { name: '播放其他版本', exact: true }).tap(); await expect(daily).toHaveCount(0);
  await expect.poll(async () => (await playback(page)).currentSong?.sourceRef.mediaId).toBe('900');
});
test('closing daily recommendations retires its pending lookup', async ({ page }) => {
  await page.goto('/mobile.html'); await seedSearchQueue(page);
  await revealMusicFeatures(page); await page.getByRole('button', { name: '每日推荐', exact: true }).tap();
  const daily = page.getByRole('dialog', { name: '每日推荐', exact: true });
  await page.evaluate(() => { (window as any).replacementDelay = true; });
  await daily.getByRole('button', { name: '播放 歌单歌曲200', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => typeof (window as any).releaseReplacement)).toBe('function');
  await daily.getByRole('button', { name: '关闭', exact: true }).tap();
  await page.evaluate(() => { (window as any).releaseReplacement(); });
  await expect(page.getByText('播放队列已变化，请重新选择歌曲。', { exact: true })).toBeVisible();
  await expect(prompt(page)).toHaveCount(0); expect(await page.evaluate(() => (window as any).searchPlaybackCalls)).toEqual([]);
});
test('a late selection receipt cannot reopen playback after navigation', async ({ page }) => {
  await page.goto('/mobile.html'); await seedSearchQueue(page); await openPlaylist(page); await offer(page);
  await page.evaluate(() => { (window as any).replacementDelaySelectionReply = true; });
  await prompt(page).getByRole('button', { name: '播放其他版本', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => typeof (window as any).releaseSelectionReply)).toBe('function');
  await page.getByRole('button', { name: 'QQ 音乐', exact: true }).tap();
  await page.evaluate(() => { (window as any).releaseSelectionReply(); });
  await page.getByRole('button', { name: '播放队列 · 2', exact: true }).tap();
  await expect(page.getByRole('button', { name: '播放 其他版本900', exact: true })).toBeEnabled();
  await expect(page.locator('.library-panel')).not.toHaveAttribute('inert', '');
  await expect(page.getByRole('button', { name: '返回音乐库', exact: true })).not.toBeVisible();
  expect(await page.evaluate(() => (window as any).searchPlaybackCalls.map((v: any) => v.method))).toEqual(['editQueue', 'selectQueue']);
});
test('the original modal stays touchable with long metadata and rotation over an album sheet', async ({ page }, info) => {
  await page.addInitScript(() => { (window as any).replacementLong = true; });
  await page.goto('/mobile.html'); await seedSearchQueue(page); await openPlaylist(page);
  await page.getByRole('button', { name: '歌曲操作 歌单歌曲200', exact: true }).tap();
  await page.getByRole('button', { name: '专辑：专辑', exact: true }).tap();
  const album = page.getByRole('dialog', { name: '在线音乐目录', exact: true });
  await album.getByRole('button', { name: '播放 歌单歌曲200', exact: true }).tap(); await expect(prompt(page)).toBeVisible();
  const viewport = page.viewportSize()!;
  for (const size of [viewport, { width: viewport.height, height: viewport.width }, viewport]) {
    await page.setViewportSize(size);
    const confirm = prompt(page).getByRole('button', { name: '播放其他版本', exact: true }); await confirm.scrollIntoViewIfNeeded();
    await expect(confirm).toBeInViewport();
    const box = (await confirm.boundingBox())!; expect(box.height).toBeGreaterThanOrEqual(44); expect(box.width).toBeGreaterThanOrEqual(44);
    expect(await prompt(page).evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  }
  await page.screenshot({ path: info.outputPath('replacement-dialog.png') });
  await prompt(page).getByRole('button', { name: '取消', exact: true }).tap();
  await expect(album).toBeVisible(); await album.getByRole('button', { name: '播放 歌单歌曲200', exact: true }).tap();
  await prompt(page).getByRole('button', { name: '播放其他版本', exact: true }).tap();
  await expect(album).toHaveCount(0); await revealPlayerControls(page);
  await expect(page.getByRole('button', { name: '返回音乐库', exact: true })).toBeVisible();
});
