import { revealMusicFeatures } from './music-features-navigation';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { recommendedFixture } from './recommended-playlists-fixture';

// recommended-playlists.spec.ts — real WebKit, Omni and collection resources; controlled responses are not live-platform proof.
const feed = (page: Page) => page.getByRole('dialog', { name: '推荐歌单', exact: true });
const catalog = (page: Page) => page.getByRole('dialog', { name: '在线音乐目录', exact: true });
async function openFeed(page: Page) { await revealMusicFeatures(page); await page.getByRole('button', { name: '推荐歌单', exact: true }).tap(); }
async function openFirst(page: Page) { await openFeed(page); await feed(page).getByRole('button', { name: '歌单：推荐歌单1', exact: true }).tap(); }
test.beforeEach(async ({ page }) => { await recommendedFixture(page); });
test('original recommendations open paged tracks, subscribe and play the full queue', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/mobile.html'); await openFeed(page);
  await expect(feed(page).getByRole('button', { name: '歌单：推荐歌单1', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).recommendationCalls)).toEqual([{ path: '/personalized', limit: '35' }]);
  await feed(page).locator('.song-list').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(feed(page).getByRole('button', { name: '歌单：推荐歌单35', exact: true })).toBeVisible();
  await feed(page).locator('.song-list').evaluate(element => { element.scrollTop = 0; });
  const initial = page.viewportSize()!;
  for (const size of [initial, { width: initial.height, height: initial.width }, initial]) {
    await page.setViewportSize(size); await expect(feed(page).getByRole('button', { name: '关闭', exact: true })).toBeInViewport();
    const box = (await feed(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1); expect(box.y + box.height).toBeLessThanOrEqual(size.height + 1);
  }
  await page.screenshot({ path: info.outputPath('recommendations.png') });
  await feed(page).getByRole('button', { name: '歌单：推荐歌单1', exact: true }).tap();
  await catalog(page).getByRole('button', { name: '收藏', exact: true }).tap();
  await expect(catalog(page).getByRole('button', { name: '取消收藏', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).recommendationCalls.some((call: any) => call.offset === 150))).toBe(true);
  await catalog(page).getByRole('button', { name: '加入队列 推荐歌曲1', exact: true }).tap();
  expect(await page.evaluate(() => (window as any).fixturePlayback.queue[0].sourceRef)).toMatchObject({ providerId: 'netease', mediaId: '1000' });
  await catalog(page).locator('.song-list').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await catalog(page).getByRole('button', { name: '播放 推荐歌曲151', exact: true }).tap();
  await expect(catalog(page)).toHaveCount(0);
  expect(await page.evaluate(() => ({ length: (window as any).fixturePlayback.queue.length, index: (window as any).fixturePlayback.index,
    ref: (window as any).fixturePlayback.currentSong.sourceRef }))).toEqual({ length: 151, index: 150, ref: { kind: 'online', providerId: 'netease', mediaId: '1150' } });
  expect(await page.evaluate(() => (window as any).recommendedWrites)).toEqual([{ id: 200, t: '1' }]); expect(errors).toEqual([]);
});
test('failed refresh retains recommendations while valid empty remains distinct', async ({ page }) => {
  await page.goto('/mobile.html'); await openFeed(page);
  await expect(feed(page).getByRole('button', { name: '歌单：推荐歌单1', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).recommendationMalformed = true; });
  await feed(page).getByRole('button', { name: '重新读取曲库', exact: true }).tap();
  await expect(feed(page).getByRole('alert')).toBeVisible(); await expect(feed(page).getByRole('button', { name: '歌单：推荐歌单1', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).recommendationMalformed = false; (window as any).recommendationEmpty = true; });
  await feed(page).getByRole('button', { name: '重新读取曲库', exact: true }).tap();
  await expect(feed(page).getByText('暂无结果', { exact: true })).toBeVisible(); await expect(feed(page).getByRole('alert')).toHaveCount(0);
});
test('detail failure can retry, missing ownership is blocked and owned playlists have no subscribe button', async ({ page }) => {
  await page.goto('/mobile.html'); await page.evaluate(() => { (window as any).recommendationDetailFailure = true; });
  await openFirst(page); await expect(catalog(page).getByRole('alert')).toBeVisible();
  await page.evaluate(() => { (window as any).recommendationDetailFailure = false; (window as any).recommendationOwnerMissing = true; });
  await catalog(page).getByRole('button', { name: '重试', exact: true }).tap(); await expect(catalog(page).getByRole('alert')).toBeVisible();
  await page.evaluate(() => { (window as any).recommendationOwnerMissing = false; (window as any).recommendationOwned = true; });
  await catalog(page).getByRole('button', { name: '重试', exact: true }).tap();
  await expect(catalog(page).getByRole('button', { name: '播放 推荐歌曲1', exact: true })).toBeVisible();
  await expect(catalog(page).getByRole('button', { name: /^(收藏|取消收藏)$/ })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).recommendedWrites)).toEqual([]);
});
test('closing and switching provider discards late recommendations and never requests QQ recommendations', async ({ page }) => {
  await page.goto('/mobile.html'); await page.evaluate(() => { (window as any).recommendationDelay = true; }); await openFeed(page);
  await expect.poll(() => page.evaluate(() => typeof (window as any).releaseRecommendations)).toBe('function');
  await feed(page).getByRole('button', { name: '关闭', exact: true }).tap(); await page.getByRole('button', { name: 'QQ 音乐', exact: true }).tap();
  await page.evaluate(() => (window as any).releaseRecommendations()); await expect(feed(page)).toHaveCount(0);
  await revealMusicFeatures(page); await expect(page.getByRole('button', { name: '推荐歌单', exact: true })).toHaveCount(0);
});
test('late detail cannot reopen a dismissed catalog, and logout disables the recommendation entry', async ({ page }) => {
  await page.goto('/mobile.html'); await page.evaluate(() => { (window as any).recommendationDetailDelay = true; }); await openFirst(page);
  await expect.poll(() => page.evaluate(() => typeof (window as any).releaseRecommendationDetail)).toBe('function');
  await catalog(page).getByRole('button', { name: '关闭', exact: true }).tap();
  await page.getByRole('button', { name: '退出登录', exact: true }).tap(); await page.evaluate(() => (window as any).releaseRecommendationDetail());
  await expect(catalog(page)).toHaveCount(0); await revealMusicFeatures(page); await expect(page.getByRole('button', { name: '推荐歌单', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).recommendedWrites)).toEqual([]);
});
test('old gateway disables recommendations without making unsupported requests', async ({ page }) => {
  await page.addInitScript(() => { delete (window as any).fixtureHealth.recommendedCollectionProviders; });
  await page.goto('/mobile.html'); await revealMusicFeatures(page); await expect(page.getByRole('button', { name: '推荐歌单', exact: true })).toBeDisabled();
  await expect(page.getByText('更新音乐服务器后，可浏览推荐歌单。', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).recommendationCalls)).toEqual([]);
});
