import { revealMusicFeatures } from './music-features-navigation';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { subscriptionFixture } from './subscriptions-fixture';

// subscriptions.spec.ts — touch, session and failure coverage through real Omni; fixture results are not platform acceptance.
const catalog = (page: Page) => page.getByRole('dialog', { name: '在线音乐目录', exact: true });
const albums = (page: Page) => page.getByRole('dialog', { name: '收藏专辑', exact: true });
async function openAlbum(page: Page) {
  await revealMusicFeatures(page); await page.getByRole('button', { name: '收藏专辑', exact: true }).tap();
  await albums(page).getByRole('button', { name: '专辑：收藏专辑1', exact: true }).tap();
}
test.beforeEach(async ({ page }) => { await subscriptionFixture(page); });
test('album toggle keeps confirmed state, survives rotation and refreshes favorites', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/mobile.html'); await openAlbum(page);
  await expect(catalog(page).getByRole('button', { name: '取消收藏', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const initial = page.viewportSize()!;
  for (const size of [initial, { width: initial.height, height: initial.width }, initial]) {
    await page.setViewportSize(size); await expect(catalog(page).getByRole('button', { name: '取消收藏', exact: true })).toBeInViewport();
    const box = (await catalog(page).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1); expect(box.y + box.height).toBeLessThanOrEqual(size.height + 1);
  }
  await page.screenshot({ path: info.outputPath('subscriptions.png') });
  await catalog(page).getByRole('button', { name: '取消收藏', exact: true }).tap();
  await expect(catalog(page).getByRole('button', { name: '收藏', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await catalog(page).getByRole('button', { name: '收藏', exact: true }).tap();
  await expect(catalog(page).getByRole('button', { name: '取消收藏', exact: true })).toBeVisible();
  await catalog(page).getByRole('button', { name: '取消收藏', exact: true }).tap();
  await expect(catalog(page).getByRole('button', { name: '收藏', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).subscriptionWrites)).toEqual([
    { type: 'album', t: '2', id: '1' }, { type: 'album', t: '1', id: '1' }, { type: 'album', t: '2', id: '1' },
  ]);
  await catalog(page).getByRole('button', { name: '关闭', exact: true }).tap();
  await revealMusicFeatures(page); await page.getByRole('button', { name: '收藏专辑', exact: true }).tap();
  await expect(albums(page).getByText('暂无结果', { exact: true })).toBeVisible(); expect(errors).toEqual([]);
});
test('only other users playlists allow subscriptions, and changes refresh the account list', async ({ page }) => {
  await page.goto('/mobile.html'); await page.getByRole('button', { name: '我的歌单', exact: true }).tap();
  await expect(page.getByRole('button', { name: '取消收藏', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '收藏歌单', exact: true }).tap();
  await page.getByRole('button', { name: '取消收藏', exact: true }).tap();
  await expect(page.getByRole('button', { name: '收藏歌单', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '收藏', exact: true }).tap();
  await expect(page.getByRole('button', { name: '收藏歌单', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).subscriptionWrites)).toEqual([
    { type: 'playlist', t: '2', id: '9' }, { type: 'playlist', t: '1', id: '9' },
  ]);
});
test('unknown reads and ambiguous writes require rereading instead of guessing or resubmitting', async ({ page }) => {
  await page.goto('/mobile.html'); await page.evaluate(() => { (window as any).subscriptionReadFailure = true; });
  await openAlbum(page);
  await expect(catalog(page).getByRole('alert')).toContainText('无法确认收藏状态');
  await expect(catalog(page).getByRole('button', { name: '收藏', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).subscriptionWrites)).toEqual([]);
  await page.evaluate(() => { (window as any).subscriptionReadFailure = false; });
  await catalog(page).getByRole('button', { name: '重新读取收藏状态', exact: true }).tap();
  await page.evaluate(() => { (window as any).subscriptionWriteFailure = true; (window as any).subscriptionAmbiguous = true; });
  await catalog(page).getByRole('button', { name: '取消收藏', exact: true }).tap();
  await expect(catalog(page).getByRole('alert')).toBeVisible();
  expect(await page.evaluate(() => (window as any).subscriptionWrites.length)).toBe(1);
  await catalog(page).getByRole('button', { name: '重新读取收藏状态', exact: true }).tap();
  await expect(catalog(page).getByRole('button', { name: '收藏', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).subscriptionWrites.length)).toBe(1);
});
test('dismissing and reopening waits for the single pending write', async ({ page }) => {
  await page.goto('/mobile.html'); await openAlbum(page);
  await page.evaluate(() => { (window as any).subscriptionWriteDelay = true; });
  await catalog(page).getByRole('button', { name: '取消收藏', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => typeof (window as any).releaseSubscriptionWrite)).toBe('function');
  await expect(catalog(page).getByRole('button', { name: '正在加载…', exact: true })).toBeDisabled();
  await catalog(page).getByRole('button', { name: '关闭', exact: true }).tap(); await openAlbum(page);
  await expect(catalog(page).getByRole('button', { name: '取消收藏', exact: true })).toHaveCount(0);
  await page.evaluate(() => (window as any).releaseSubscriptionWrite());
  await expect(catalog(page).getByRole('button', { name: '收藏', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).subscriptionWrites.length)).toBe(1);
});
test('late status after closing and switching to QQ cannot expose QQ writes', async ({ page }) => {
  await page.goto('/mobile.html'); await page.evaluate(() => { (window as any).subscriptionReadDelay = true; });
  await openAlbum(page); await expect.poll(() => page.evaluate(() => typeof (window as any).releaseSubscriptionRead)).toBe('function');
  await catalog(page).getByRole('button', { name: '关闭', exact: true }).tap();
  await page.getByRole('button', { name: 'QQ 音乐', exact: true }).tap();
  await revealMusicFeatures(page); await page.getByRole('button', { name: '收藏专辑', exact: true }).tap();
  await albums(page).getByRole('button', { name: '专辑：QQ专辑', exact: true }).tap();
  await page.evaluate(() => (window as any).releaseSubscriptionRead());
  await expect(catalog(page).getByRole('button', { name: '播放 QQ目录歌曲', exact: true })).toBeVisible();
  await expect(catalog(page).getByRole('button', { name: /^(收藏|取消收藏)$/ })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).subscriptionWrites)).toEqual([]);
});
test('logout during a sent playlist write does not restore account state', async ({ page }) => {
  await page.goto('/mobile.html'); await page.getByRole('button', { name: '收藏歌单', exact: true }).tap();
  await page.evaluate(() => { (window as any).subscriptionWriteDelay = true; });
  await page.getByRole('button', { name: '取消收藏', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => typeof (window as any).releaseSubscriptionWrite)).toBe('function');
  await page.getByRole('button', { name: '退出登录', exact: true }).tap();
  await page.evaluate(() => (window as any).releaseSubscriptionWrite());
  await expect(page.getByRole('button', { name: '我的歌单', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^(收藏|取消收藏)$/ })).toHaveCount(0);
});
test('older gateways keep the directory playable without requesting unsupported writes or reads', async ({ page }) => {
  await page.addInitScript(() => { delete (window as any).fixtureHealth.subscriptionProviders; });
  await page.goto('/mobile.html'); await openAlbum(page);
  await expect(catalog(page).getByText('更新音乐服务器后，可收藏或取消收藏。', { exact: true })).toBeVisible();
  await expect(catalog(page).getByRole('button', { name: '播放 目录歌曲', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).subscriptionReads)).toEqual([]);
  expect(await page.evaluate(() => (window as any).subscriptionWrites)).toEqual([]);
});
