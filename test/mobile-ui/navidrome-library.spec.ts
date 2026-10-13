import { test, expect } from './fixtures';
import { navidromeFixture } from './navidrome-fixture';
import type { Page } from '@playwright/test';

// navidrome-library.spec.ts — touch layouts and original queue behavior with explicit fixtures, not server acceptance.
test.beforeEach(async ({ page }) => {
  await navidromeFixture(page); await page.goto('/mobile.html');
  await page.getByRole('button', { name: 'Navidrome', exact: true }).tap();
  await page.getByRole('button', { name: '配置 Navidrome', exact: true }).tap();
});
async function configure(page: Page) {
  const sheet = page.getByRole('dialog', { name: 'Navidrome 音乐库', exact: true });
  await sheet.getByLabel('服务器地址', { exact: true }).fill('https://music.example/library');
  await sheet.getByLabel('用户名', { exact: true }).fill('user');
  await sheet.getByLabel('密码', { exact: true }).fill('fixture-write-only');
  await sheet.getByLabel('启用 Navidrome', { exact: true }).check();
  await sheet.getByRole('button', { name: '保存连接', exact: true }).tap();
  await expect(sheet.getByRole('status')).toHaveText('连接设置已保存');
  return sheet;
}
test('saves write-only settings, recovers failed saves, tests connection and clears credentials', async ({ page }) => {
  const sheet = await configure(page);
  await expect(sheet.getByLabel('密码', { exact: true })).toHaveValue('');
  await sheet.getByRole('button', { name: '测试连接', exact: true }).tap();
  await expect(sheet.getByRole('status')).toHaveText('连接成功');
  await sheet.getByRole('button', { name: '关闭', exact: true }).tap();
  await page.getByRole('button', { name: '配置 Navidrome', exact: true }).tap();
  await expect(sheet.getByLabel('密码', { exact: true })).toHaveValue('');
  await expect(sheet.getByLabel('服务器地址', { exact: true })).toHaveValue('https://music.example/library');
  await sheet.getByLabel('用户名', { exact: true }).fill('next-user');
  await sheet.getByLabel('密码', { exact: true }).fill('replacement');
  await page.evaluate(() => { (window as any).fixtureNavidromeSaveFailure = true; });
  await sheet.getByRole('button', { name: '保存连接', exact: true }).tap();
  await expect(sheet.getByRole('alert')).toBeVisible();
  await expect(sheet.getByLabel('用户名', { exact: true })).toHaveValue('next-user');
  await page.evaluate(() => { (window as any).fixtureNavidromeSaveFailure = false; });
  await sheet.getByRole('button', { name: '保存连接', exact: true }).tap();
  await expect(sheet.getByRole('status')).toHaveText('连接设置已保存');
  await sheet.getByLabel('清除密码并停用', { exact: true }).check();
  await sheet.getByRole('button', { name: '保存连接', exact: true }).tap();
  await expect(sheet.getByText('尚未保存密码', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toMatch(/fixture-write-only|replacement|music.example/);
  const bounds = await sheet.evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
  expect(bounds.scroll).toBeLessThanOrEqual(bounds.client);
});
test('browses collections and search without a music gateway and preserves the search queue', async ({ page }, info) => {
  const sheet = await configure(page); await sheet.getByRole('button', { name: '关闭', exact: true }).tap();
  const nav = page.getByRole('navigation', { name: 'Navidrome', exact: true });
  await expect(page.getByRole('button', { name: '打开 专辑甲', exact: true })).toBeVisible();
  await expect.poll(() => page.locator('.local-collections img').count()).toBeGreaterThan(0);
  for (const label of ['最近加入', '最近播放', '专辑']) {
    await nav.getByRole('button', { name: label, exact: true }).tap();
    await expect(page.getByRole('button', { name: '打开 专辑甲', exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: '打开 专辑甲', exact: true }).tap();
  await page.getByRole('button', { name: '播放 歌曲 一', exact: true }).tap();
  await expect(page.locator('.player-panel')).toBeVisible();
  await page.getByRole('button', { name: '返回音乐库', exact: true }).tap();
  const search = page.getByLabel('搜索歌曲、专辑或艺术家', { exact: true });
  await search.fill('搜索'); await page.locator('form.search').getByRole('button', { name: '搜索歌曲', exact: true }).tap();
  await page.getByRole('button', { name: '播放 歌曲 搜索', exact: true }).tap();
  expect(await page.evaluate(() => (window as any).fixturePlayback.queue.map((s: any) => s.name))).toEqual(['歌曲 一', '歌曲 二', '歌曲 搜索']);
  await page.getByRole('button', { name: '返回音乐库', exact: true }).tap();
  await page.getByRole('button', { name: '返回集合列表', exact: true }).tap();
  await nav.getByRole('button', { name: '艺术家', exact: true }).tap();
  await page.getByRole('button', { name: '打开 艺术家甲', exact: true }).tap();
  await expect(page.getByRole('button', { name: '播放 歌曲 二', exact: true })).toBeVisible();
  await nav.getByRole('button', { name: '歌单', exact: true }).tap();
  for (const [name, track] of [['歌单甲', '歌单'], ['随机音乐', '随机'], ['收藏', '收藏']]) {
    await page.getByRole('button', { name: '打开 ' + name, exact: true }).tap();
    await expect(page.getByRole('button', { name: '播放 歌曲 ' + track, exact: true })).toBeVisible();
    if (track === '收藏') await page.getByRole('button', { name: '加入队列 歌曲 收藏', exact: true }).tap();
    await page.getByRole('button', { name: '返回集合列表', exact: true }).tap();
  }
  expect(await page.evaluate(() => (window as any).fixtureNavidromeRequests.some((r: any) => /password|token|https/.test(JSON.stringify(r))))).toBe(false);
  const bounds = await page.locator('.library-panel').evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
  expect(bounds.scroll).toBeLessThanOrEqual(bounds.client);
  await page.screenshot({ path: info.outputPath('navidrome-library.png') });
  await page.getByRole('button', { name: /播放队列 · 4/ }).tap();
  await expect(page.getByRole('button', { name: '播放 歌曲 收藏', exact: true })).toBeVisible();
});
test('cancels late navigation and recovers visible network errors', async ({ page }) => {
  const sheet = await configure(page); await sheet.getByRole('button', { name: '关闭', exact: true }).tap();
  await expect(page.getByRole('button', { name: '打开 专辑甲', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).fixtureNavidromeDelay = true; });
  await page.getByLabel('搜索歌曲、专辑或艺术家', { exact: true }).fill('迟到');
  await page.locator('form.search').getByRole('button', { name: '搜索歌曲', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => !!(window as any).fixtureNavidromeRelease)).toBe(true);
  await page.getByRole('navigation', { name: 'Navidrome', exact: true }).getByRole('button', { name: '艺术家', exact: true }).tap();
  await page.evaluate(() => { (window as any).fixtureNavidromeRelease(); });
  await expect(page.getByRole('button', { name: '打开 艺术家甲', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '播放 歌曲 迟到', exact: true })).toHaveCount(0);
  await page.evaluate(() => { (window as any).fixtureNavidromeError = 'navidrome-auth-required'; });
  await page.getByRole('button', { name: '刷新', exact: true }).tap();
  await expect(page.getByRole('alert')).toContainText('认证失败');
  await page.evaluate(() => { (window as any).fixtureNavidromeError = ''; });
  await page.getByRole('button', { name: '重试', exact: true }).tap();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '打开 艺术家甲', exact: true })).toBeVisible();
});
