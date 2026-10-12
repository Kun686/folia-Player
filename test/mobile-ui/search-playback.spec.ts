import type { Page } from '@playwright/test';
import { test, expect, revealPlayerControls } from './fixtures';
import { searchPlaybackFixture, seedSearchQueue } from './search-playback-fixture';

// search-playback.spec.ts — original single-song search semantics, failure/empty distinction and race protection.
async function search(page: Page, query = '歌曲') {
  await page.getByRole('textbox', { name: '搜索歌曲' }).fill(query);
  await page.getByRole('button', { name: '搜索歌曲', exact: true }).tap();
}
async function back(page: Page) {
  await revealPlayerControls(page); await page.getByRole('button', { name: '返回音乐库', exact: true }).tap();
}
test.beforeEach(async ({ page }) => { await searchPlaybackFixture(page); await page.goto('/mobile.html'); await seedSearchQueue(page); });
test('search appends only the selected song, retains mixed identities and never replaces the queue', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await search(page); await page.getByRole('button', { name: '播放 搜索歌曲101', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).fixturePlayback.index)).toBe(2);
  expect(await page.evaluate(() => (window as any).fixturePlayback.queue.map((s: any) => s.sourceRef))).toEqual([
    { kind: 'online', providerId: 'qq', mediaId: 'qq-101' }, { kind: 'online', providerId: 'netease', mediaId: '100' },
    { kind: 'online', providerId: 'netease', mediaId: '101' },
  ]);
  await back(page); await page.getByRole('button', { name: '播放 搜索歌曲100', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).fixturePlayback.index)).toBe(1);
  await back(page); await page.getByRole('button', { name: 'QQ 音乐', exact: true }).tap(); await search(page);
  await page.getByRole('button', { name: '播放 QQ搜索歌曲101', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).fixturePlayback.index)).toBe(0);
  expect(await page.evaluate(() => (window as any).searchPlaybackCalls.map((x: any) => x.method))).toEqual(['editQueue', 'selectQueue', 'selectQueue', 'selectQueue']);
  expect(errors).toEqual([]); await back(page); await page.screenshot({ path: info.outputPath('search-playback.png') });
});
test('song paging and editing unsubmitted text keep search playback scoped to the selected result', async ({ page }) => {
  await search(page, '原查询'); await page.getByRole('button', { name: '加载更多', exact: true }).tap();
  await expect(page.getByRole('button', { name: '播放 搜索歌曲102', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '搜索歌曲' }).fill('尚未提交');
  await page.getByRole('button', { name: '播放 搜索歌曲102', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).fixturePlayback.queue.length)).toBe(3);
  expect(await page.evaluate(() => (window as any).searchCalls)).toEqual([
    { provider: 'netease', query: '原查询', offset: 0 }, { provider: 'netease', query: '原查询', offset: 2 },
  ]);
  await back(page); await page.getByRole('button', { name: '搜索回归歌单', exact: true }).tap();
  await page.getByRole('button', { name: '播放 搜索歌曲201', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).fixturePlayback.queue.map((s: any) => s.sourceRef.mediaId))).toEqual(['200', '201']);
  expect(await page.evaluate(() => (window as any).fixturePlayback.index)).toBe(1);
});
test('search errors offer retry, preserve successful pages and are distinct from confirmed empty', async ({ page }) => {
  await page.evaluate(() => { (window as any).searchFailure = true; }); await search(page);
  await expect(page.getByRole('button', { name: '重试歌曲加载', exact: true })).toBeVisible(); await expect(page.locator('.empty')).toHaveCount(0);
  await page.evaluate(() => { (window as any).searchFailure = false; }); await page.getByRole('button', { name: '重试歌曲加载', exact: true }).tap();
  await expect(page.getByRole('button', { name: '播放 搜索歌曲100', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).searchMalformed = true; }); await page.getByRole('button', { name: '加载更多', exact: true }).tap();
  await expect(page.getByRole('button', { name: '重试歌曲加载', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '播放 搜索歌曲100', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).searchMalformed = false; }); await page.getByRole('button', { name: '重试歌曲加载', exact: true }).tap();
  await expect(page.getByRole('button', { name: '播放 搜索歌曲102', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).searchCalls.map((x: any) => x.offset))).toEqual([0, 0, 2, 2]);
  await page.evaluate(() => { (window as any).searchEmpty = true; }); await search(page, '不存在');
  await expect(page.getByText('暂无结果', { exact: true })).toBeVisible(); await expect(page.locator('.library-panel').getByRole('alert')).toHaveCount(0);
});
test('restricted search songs keep their label and cannot be played or queued from either touch entry', async ({ page }) => {
  await page.evaluate(() => { (window as any).searchUnavailable = true; }); await search(page);
  await expect(page.getByRole('button', { name: '播放 搜索歌曲101', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '加入队列 搜索歌曲101', exact: true })).toBeDisabled();
  await expect(page.getByText('该歌曲暂不可播放', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '歌曲操作 搜索歌曲101', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: '歌曲操作', exact: true });
  for (const name of ['播放', '下一首播放', '移到队尾']) await expect(dialog.getByRole('button', { name, exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).searchPlaybackCalls)).toEqual([]);
});
test('a concurrent queue change leaves the newer playback intact and surfaces an actionable error', async ({ page }) => {
  await search(page); await page.evaluate(() => { (window as any).searchStaleSelect = true; });
  await page.getByRole('button', { name: '播放 搜索歌曲101', exact: true }).tap();
  await expect(page.getByText('播放队列已变化，请重新选择歌曲。', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).fixturePlayback.currentSong.sourceRef.providerId)).toBe('qq');
  expect(await page.evaluate(() => (window as any).fixturePlayback.position)).toBe(42);
  await page.evaluate(() => { (window as any).searchStaleSelect = false; }); await page.getByRole('button', { name: '播放 搜索歌曲101', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).fixturePlayback.index)).toBe(2);
  expect(await page.evaluate(() => (window as any).searchPlaybackCalls.filter((x: any) => x.method === 'editQueue').length)).toBe(1);
});
test('logging out while the native state read is pending cancels search playback', async ({ page }) => {
  await search(page); await page.evaluate(() => { (window as any).searchDelayState = true; });
  await page.getByRole('button', { name: '播放 搜索歌曲101', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => typeof (window as any).releaseSearchState)).toBe('function');
  await page.getByRole('button', { name: '退出登录', exact: true }).tap();
  await expect(page.getByRole('button', { name: '扫码登录', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).searchDelayState = false; (window as any).releaseSearchState(); });
  await expect(page.getByText('播放队列已变化，请重新选择歌曲。', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).searchPlaybackCalls)).toEqual([]);
});
