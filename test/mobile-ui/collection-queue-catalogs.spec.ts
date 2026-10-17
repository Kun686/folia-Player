import { revealMusicFeatures } from './music-features-navigation';
import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { catalogFixture, queueQqSong } from './online-catalog-fixture';
import { searchPlaybackFixture, seedSearchQueue } from './search-playback-fixture';
import { dailyFixture } from './daily-recommendations-fixture';
import { navidromeFixture } from './navidrome-fixture';

// collection-queue-catalogs.spec.ts — collection hosts share enqueue semantics, without real account writes.
const button = (page: Page) => page.getByRole('button', { name: '加入播放队列', exact: true });
const ids = (page: Page) => page.evaluate(() => (window as any).fixturePlayback.queue.map((s: any) => s.sourceRef.mediaId));
async function checkPlayback(page: Page) {
  expect(await page.evaluate(() => ({ position: (window as any).fixturePlayback.position, playing: (window as any).fixturePlayback.playing })))
    .toEqual({ position: 42, playing: false });
}
for (const provider of ['qq', 'netease'] as const) {
  test(provider + ' artist top songs and album enqueue use original identities and skip the current song', async ({ page }, info) => {
    await catalogFixture(page); await page.goto('/mobile.html');
    if (provider === 'qq') {
      await queueQqSong(page); await page.getByRole('button', { name: '播放队列 · 1', exact: true }).tap();
      await page.getByRole('button', { name: '歌曲操作 QQ目录歌曲', exact: true }).tap();
    } else {
      await page.getByRole('textbox', { name: '搜索歌曲', exact: true }).fill('测试');
      await page.getByRole('button', { name: '搜索歌曲', exact: true }).tap();
      await page.getByRole('button', { name: '歌曲操作 测试歌曲', exact: true }).tap();
    }
    await page.getByRole('button', { name: provider === 'qq' ? '歌手：QQ歌手' : '歌手：测试歌手', exact: true }).tap();
    const sheet = page.getByRole('dialog', { name: '在线音乐目录', exact: true });
    await expect(button(page)).toBeEnabled();
    if (provider === 'qq') {
      await button(page).tap(); await expect(sheet.getByText('没有需要加入队列的歌曲', { exact: true })).toBeVisible();
      expect(await ids(page)).toEqual(['catalogSong']);
    }
    await seedSearchQueue(page); await button(page).tap();
    await expect(sheet.getByText('已将 1 首歌曲加入播放队列', { exact: true })).toBeVisible();
    expect(await ids(page)).toEqual(['qq-101', '100', provider === 'qq' ? 'catalogSong' : '81']);
    await sheet.getByRole('button', { name: '歌曲操作 ' + (provider === 'qq' ? 'QQ目录歌曲' : '目录歌曲'), exact: true }).tap();
    await page.getByRole('dialog', { name: '歌曲操作', exact: true })
      .getByRole('button', { name: provider === 'qq' ? '专辑：QQ专辑' : '专辑：专辑', exact: true }).tap();
    await expect(sheet.getByText('当前范围 1 首', { exact: true })).toBeVisible();
    await button(page).tap(); await expect(sheet.getByText('已将 1 首歌曲加入播放队列', { exact: true })).toBeVisible();
    expect((await ids(page)).length).toBe(3); await checkPlayback(page);
    await page.screenshot({ path: info.outputPath(provider + '-collection.png') });
  });
}
test('daily and historical recommendations enqueue the displayed day without replacing playback', async ({ page }) => {
  await dailyFixture(page); await page.addInitScript(() => { (window as any).fixtureLyricTools = true; }); await page.goto('/mobile.html');
  await page.getByRole('button', { name: '扫码登录', exact: true }).tap();
  await page.getByRole('button', { name: '重新生成二维码', exact: true }).tap();
  await expect(page.getByText('已登录', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByRole('dialog', { name: '扫码登录', exact: true }).getByRole('button', { name: '关闭', exact: true }).tap();
  await seedSearchQueue(page); await revealMusicFeatures(page); await page.getByRole('button', { name: '每日推荐', exact: true }).tap();
  const sheet = page.getByRole('dialog', { name: '每日推荐', exact: true });
  await button(page).tap(); await expect(sheet.getByText('已将 2 首歌曲加入播放队列', { exact: true })).toBeVisible();
  expect(await ids(page)).toEqual(['qq-101', '100', '101', '102']);
  await sheet.getByRole('combobox', { name: '推荐日期', exact: true }).selectOption('2026-10-11');
  await expect(sheet.getByRole('button', { name: '播放 历史歌曲', exact: true })).toBeVisible();
  await button(page).tap(); await expect(sheet.getByText('已将 1 首歌曲加入播放队列', { exact: true })).toBeVisible();
  expect(await ids(page)).toEqual(['qq-101', '100', '101', '102', '201']); await checkPlayback(page);
});
async function navidrome(page: Page) {
  await searchPlaybackFixture(page); await navidromeFixture(page); await page.goto('/mobile.html');
  await seedSearchQueue(page); await page.getByRole('button', { name: 'Navidrome', exact: true }).tap();
  await page.getByRole('button', { name: '配置 Navidrome', exact: true }).tap();
  const settings = page.getByRole('dialog', { name: 'Navidrome 音乐库', exact: true });
  await settings.getByLabel('服务器地址', { exact: true }).fill('https://music.example/library');
  await settings.getByLabel('用户名', { exact: true }).fill('user');
  await settings.getByLabel('密码', { exact: true }).fill('fixture-only');
  await settings.getByLabel('启用 Navidrome', { exact: true }).check();
  await settings.getByRole('button', { name: '保存连接', exact: true }).tap();
  await expect(settings.getByRole('status')).toHaveText('连接设置已保存');
  await settings.getByRole('button', { name: '关闭', exact: true }).tap();
  await page.getByRole('button', { name: '打开 专辑甲', exact: true }).tap();
}
test('Navidrome album enqueue preserves playback and search retains single-song behavior', async ({ page }) => {
  await navidrome(page); await button(page).tap();
  await expect(page.getByText('已将 2 首歌曲加入播放队列', { exact: true })).toBeVisible();
  expect(await ids(page)).toEqual(['qq-101', '100', '一', '二']); await checkPlayback(page);
  await page.getByLabel('搜索歌曲、专辑或艺术家', { exact: true }).fill('搜索');
  await page.locator('form.search').getByRole('button', { name: '搜索歌曲', exact: true }).tap();
  await expect(page.getByRole('button', { name: '播放 歌曲 搜索', exact: true })).toBeVisible(); await expect(button(page)).toHaveCount(0);
});
test('Navidrome account change during native read cancels the old scope', async ({ page }) => {
  await navidrome(page); await page.evaluate(() => { (window as any).searchDelayState = true; }); await button(page).tap();
  await expect.poll(() => page.evaluate(() => typeof (window as any).releaseSearchState)).toBe('function');
  await page.getByRole('button', { name: '配置 Navidrome', exact: true }).tap();
  const settings = page.getByRole('dialog', { name: 'Navidrome 音乐库', exact: true });
  await settings.getByLabel('用户名', { exact: true }).fill('changed-user');
  await settings.getByRole('button', { name: '保存连接', exact: true }).tap();
  await expect(settings.getByRole('status')).toHaveText('连接设置已保存');
  await settings.getByRole('button', { name: '关闭', exact: true }).tap();
  await page.evaluate(() => { (window as any).searchDelayState = false; (window as any).releaseSearchState(); });
  await expect(page.locator('.library-panel').getByRole('alert')).toBeVisible();
  expect(await page.evaluate(() => (window as any).searchPlaybackCalls)).toEqual([]); await checkPlayback(page);
});
