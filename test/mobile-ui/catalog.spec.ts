import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// catalog.spec.ts — real Omni/NetEase adapter over controlled pages, including delayed responses.
async function login(page: Page) {
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '扫码登录', exact: true }).tap();
  await page.getByRole('button', { name: '重新生成二维码', exact: true }).tap();
  await expect(page.getByText('已登录', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByRole('dialog', { name: '扫码登录' }).getByRole('button', { name: '关闭', exact: true }).tap();
}
test('playlists after the first 100 stay reachable and a failed next page can retry', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { (window as any).fixturePlaylistCount = 101; });
  await login(page);
  await expect(page.locator('.collections button')).toHaveCount(100);
  await page.evaluate(() => { (window as any).fixturePlaylistFailure = true; });
  await page.getByRole('button', { name: '加载更多歌单', exact: true }).tap();
  await expect(page.getByRole('button', { name: '重试歌单加载', exact: true })).toBeVisible();
  await expect(page.locator('.collections button')).toHaveCount(100);
  await page.evaluate(() => { (window as any).fixturePlaylistFailure = false; });
  await page.getByRole('button', { name: '加载更多歌单', exact: true }).tap();
  await expect(page.locator('.collections button')).toHaveCount(101);
  await expect(page.getByRole('button', { name: '加载更多歌单', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).fixturePlaylistOffsets)).toEqual([0, 100, 100]);
  await page.getByRole('button', { name: '歌单100', exact: true }).tap();
  await expect(page.getByRole('button', { name: '播放 测试歌曲', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.mobile-test-results/catalog-' + info.project.name + '.png' });
  await page.getByRole('button', { name: '播放 测试歌曲', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).fixturePlayback.playing)).toBe(true);
  expect(errors).toEqual([]);
});
test('search and account paging remain independent, and logout discards a delayed playlist response', async ({ page }) => {
  await page.addInitScript(() => { (window as any).fixturePlaylistCount = 101; });
  await login(page);
  await page.evaluate(() => { (window as any).fixturePlaylistDelay = true; });
  await page.getByRole('button', { name: '加载更多歌单', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => typeof (window as any).fixtureReleasePlaylists)).toBe('function');
  await page.getByRole('textbox', { name: '搜索歌曲' }).fill('测试');
  await page.getByRole('button', { name: '搜索歌曲', exact: true }).tap();
  await expect(page.getByRole('button', { name: '播放 测试歌曲', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '退出登录', exact: true }).tap();
  await expect(page.getByRole('button', { name: '扫码登录', exact: true })).toBeEnabled();
  await page.evaluate(() => { (window as any).fixtureReleasePlaylists(); });
  await expect(page.locator('.collections button')).toHaveCount(0);
  await expect(page.locator('.library-panel').getByRole('status')).toHaveCount(0);
  await expect(page.getByText('测试用户', { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('fixture-cookie');
});
test('switching providers discards the old page and restores a fresh account view on return', async ({ page }) => {
  await page.addInitScript(() => { (window as any).fixturePlaylistCount = 101; });
  await login(page);
  await page.evaluate(() => { (window as any).fixturePlaylistDelay = true; });
  await page.getByRole('button', { name: '加载更多歌单', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => typeof (window as any).fixtureReleasePlaylists)).toBe('function');
  await page.getByRole('button', { name: '本地音乐', exact: true }).tap();
  await page.evaluate(() => { (window as any).fixturePlaylistDelay = false; (window as any).fixtureReleasePlaylists(); });
  await expect(page.locator('.collections button')).toHaveCount(0);
  await expect(page.locator('.library-panel').getByRole('status')).toHaveCount(0);
  await page.getByRole('button', { name: '网易云', exact: true }).tap();
  await expect(page.locator('.collections button')).toHaveCount(100);
  await expect(page.getByText('测试用户', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).fixturePlaylistOffsets)).toEqual([0, 100, 0]);
});
