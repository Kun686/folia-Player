import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { accountLibraryFixture } from './account-library-fixture';

// account-library.spec.ts — real resources/normalization; fixtures are not account or physical playback acceptance.
const albums = (page: Page) => page.getByRole('dialog', { name: '收藏专辑', exact: true });
const cloud = (page: Page) => page.getByRole('dialog', { name: '音乐云盘', exact: true });
const catalog = (page: Page) => page.getByRole('dialog', { name: '在线音乐目录', exact: true });
test.beforeEach(async ({ page }) => { await accountLibraryFixture(page); });
test('NetEase favorites load all original pages, rotate and open a playable album', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/mobile.html'); await page.getByRole('button', { name: '收藏专辑', exact: true }).tap();
  await expect(albums(page).getByRole('button', { name: '专辑：收藏专辑1', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).accountLibraryCalls)).toEqual([
    { provider: 'netease', path: '/album/sublist', limit: 50, offset: 0 }, { provider: 'netease', path: '/album/sublist', limit: 50, offset: 50 },
  ]);
  const initial = page.viewportSize()!;
  for (const size of [initial, { width: initial.height, height: initial.width }, initial]) {
    await page.setViewportSize(size);
    const box = (await albums(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1); expect(box.y + box.height).toBeLessThanOrEqual(size.height + 1);
    await expect(albums(page).getByRole('button', { name: '关闭', exact: true })).toBeInViewport();
  }
  await page.screenshot({ path: info.outputPath('account-library.png') });
  await albums(page).locator('.song-list').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await albums(page).getByRole('button', { name: '专辑：收藏专辑51', exact: true }).tap();
  await catalog(page).getByRole('button', { name: '播放 目录歌曲', exact: true }).tap();
  expect(await page.evaluate(() => (window as any).fixturePlayback.currentSong.sourceRef)).toMatchObject({ providerId: 'netease', mediaId: '131' });
  expect(errors).toEqual([]);
});
test('QQ favorites keep canonical album mid and never expose an unsupported cloud drive', async ({ page }) => {
  await page.goto('/mobile.html'); await page.getByRole('button', { name: 'QQ 音乐', exact: true }).tap();
  await expect(page.getByRole('button', { name: '音乐云盘', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '收藏专辑', exact: true }).tap();
  await albums(page).getByRole('button', { name: '专辑：QQ专辑', exact: true }).tap();
  await catalog(page).getByRole('button', { name: '播放 QQ目录歌曲', exact: true }).tap();
  expect(await page.evaluate(() => (window as any).catalogRequests.find((r: any) => r.path === '/getAlbumInfo'))).toMatchObject({ provider: 'qq', query: { albummid: 'catalogAlbum' } });
  expect(await page.evaluate(() => (window as any).fixturePlayback.currentSong.sourceRef)).toMatchObject({ providerId: 'qq', mediaId: 'catalogSong' });
});
test('favorite refresh errors retain previous rows and valid empty results are distinct', async ({ page }) => {
  await page.goto('/mobile.html'); await page.getByRole('button', { name: '收藏专辑', exact: true }).tap();
  await expect(albums(page).getByRole('button', { name: '专辑：收藏专辑1', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).accountLibraryMalformed = true; });
  await albums(page).getByRole('button', { name: '重新读取曲库', exact: true }).tap();
  await expect(albums(page).getByRole('alert')).toBeVisible();
  await expect(albums(page).getByRole('button', { name: '专辑：收藏专辑1', exact: true })).toBeVisible();
  await expect(albums(page).getByText('暂无结果', { exact: true })).toHaveCount(0);
  await page.evaluate(() => { (window as any).accountLibraryMalformed = false; (window as any).accountLibraryEmpty = true; });
  await albums(page).getByRole('button', { name: '重新读取曲库', exact: true }).tap();
  await expect(albums(page).getByText('暂无结果', { exact: true })).toBeVisible();
  await expect(albums(page).getByRole('alert')).toHaveCount(0);
});
test('cloud pages retain source variants, retry the failed cursor and clear on logout', async ({ page }) => {
  await page.goto('/mobile.html'); await page.getByRole('button', { name: '音乐云盘', exact: true }).tap();
  await cloud(page).getByRole('button', { name: '音乐云盘', exact: true }).tap();
  await expect(page.getByRole('heading', { name: '音乐云盘', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '播放 云盘歌曲1', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).accountCloudPageFail = true; });
  await page.getByRole('button', { name: '加载更多', exact: true }).tap();
  await expect(page.getByRole('button', { name: '重试歌曲加载', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '播放 云盘歌曲1', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).accountCloudPageFail = false; });
  await page.getByRole('button', { name: '重试歌曲加载', exact: true }).tap();
  await expect(page.getByRole('button', { name: '加载更多', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '加入队列 云盘歌曲1', exact: true }).tap();
  expect(await page.evaluate(() => (window as any).fixturePlayback.queue[0].sourceRef)).toMatchObject({ providerId: 'netease', mediaId: '800', variant: 'cloud' });
  expect(await page.evaluate(() => (window as any).accountLibraryCalls.filter((r: any) => r.path === '/user/cloud').map((r: any) => [r.limit, r.offset]))).toEqual([[1, 0], [50, 0], [50, 50], [50, 50]]);
  await page.getByRole('button', { name: '退出登录', exact: true }).tap();
  await expect(page.getByRole('button', { name: '播放 云盘歌曲1', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '音乐云盘', exact: true })).toBeDisabled();
});
test('cloud errors can retry and an empty drive remains empty', async ({ page }) => {
  await page.goto('/mobile.html'); await page.evaluate(() => { (window as any).accountLibraryFail = true; });
  await page.getByRole('button', { name: '音乐云盘', exact: true }).tap();
  await expect(cloud(page).getByRole('alert')).toBeVisible();
  await page.evaluate(() => { (window as any).accountLibraryFail = false; (window as any).accountLibraryEmpty = true; });
  await cloud(page).getByRole('button', { name: '重新读取曲库', exact: true }).tap();
  await expect(cloud(page).getByText('暂无结果', { exact: true })).toBeVisible();
});
test('closing a pending NetEase library and switching provider discards its response', async ({ page }) => {
  await page.goto('/mobile.html'); await page.evaluate(() => { (window as any).accountLibraryDelay = true; });
  await page.getByRole('button', { name: '收藏专辑', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => typeof (window as any).accountLibraryRelease)).toBe('function');
  await albums(page).getByRole('button', { name: '关闭', exact: true }).tap();
  await page.getByRole('button', { name: 'QQ 音乐', exact: true }).tap();
  await page.getByRole('button', { name: '收藏专辑', exact: true }).tap();
  await page.evaluate(() => (window as any).accountLibraryRelease());
  await expect(albums(page).getByRole('button', { name: '专辑：QQ专辑', exact: true })).toBeVisible();
  await expect(albums(page).getByRole('button', { name: '专辑：收藏专辑1', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).accountLibraryCalls.filter((r: any) => r.provider === 'netease').length)).toBe(1);
});
test('old gateways disable the entries and do not request account library routes', async ({ page }) => {
  await page.addInitScript(() => { delete (window as any).fixtureHealth.userAlbumProviders; delete (window as any).fixtureHealth.cloudProviders; });
  await page.goto('/mobile.html');
  await expect(page.getByRole('button', { name: '收藏专辑', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '音乐云盘', exact: true })).toBeDisabled();
  await expect(page.getByText('更新音乐服务器后，可浏览收藏专辑及支持的音乐云盘。', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).accountLibraryCalls)).toEqual([]);
});
