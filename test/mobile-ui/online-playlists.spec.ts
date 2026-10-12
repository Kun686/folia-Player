import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { playlistFixture } from './online-playlists-fixture';

// online-playlists.spec.ts — actual Omni, native-session guards, owned-list pagination and original mutation controller.
const picker = (page: Page) => page.getByRole('dialog', { name: '加入在线歌单', exact: true });
const manager = (page: Page) => page.getByRole('dialog', { name: '编辑歌单歌曲', exact: true });
async function login(page: Page) {
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '扫码登录', exact: true }).tap();
  await page.getByRole('button', { name: '重新生成二维码', exact: true }).tap();
  await expect(page.getByText('已登录', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByRole('dialog', { name: '扫码登录' }).getByRole('button', { name: '关闭', exact: true }).tap();
}
async function search(page: Page) {
  await page.getByRole('textbox', { name: '搜索歌曲', exact: true }).fill('测试');
  await page.getByRole('button', { name: '搜索歌曲', exact: true }).tap();
  await page.getByRole('button', { name: '歌曲操作 测试歌曲', exact: true }).tap();
  await page.getByRole('button', { name: '加入在线歌单', exact: true }).tap();
  await expect(picker(page).getByRole('button', { name: '我的歌单1', exact: true })).toBeVisible();
}
async function edit(page: Page) {
  await page.getByRole('button', { name: '我的歌单1', exact: true }).tap();
  await page.getByRole('button', { name: '编辑歌单歌曲', exact: true }).tap();
  await expect(manager(page).getByRole('button', { name: '歌曲操作 原有歌曲', exact: true })).toBeVisible();
}

test('adding uses only owned playlists, pages past 100 and retains the original song identity', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await playlistFixture(page); await login(page); await search(page);
  await expect(picker(page).getByRole('button', { name: '我的歌单2', exact: true })).toHaveCount(0);
  await picker(page).getByRole('button', { name: '加载更多歌单', exact: true }).tap();
  await picker(page).getByRole('textbox', { name: '搜索歌单', exact: true }).fill('101');
  await expect(picker(page).getByRole('button', { name: '我的歌单101', exact: true })).toBeVisible();
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: size.height, height: size.width });
  await expect(picker(page).getByRole('button', { name: '我的歌单101', exact: true })).toBeVisible();
  await page.setViewportSize(size); await page.screenshot({ path: info.outputPath('online-playlist-picker.png') });
  await picker(page).getByRole('button', { name: '我的歌单101', exact: true }).tap();
  await expect(picker(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).playlistWrites)).toEqual([expect.objectContaining({ op: 'add', pid: '101', tracks: '42' })]);
  expect(errors).toEqual([]);
});

test('rejected adds require a fresh read and never close as false success', async ({ page }) => {
  await playlistFixture(page); await login(page); await search(page);
  await page.evaluate(() => { (window as any).rejectPlaylistWrite = true; });
  await picker(page).getByRole('button', { name: '我的歌单1', exact: true }).tap();
  await expect(picker(page).getByRole('alert')).toBeVisible();
  expect(await page.evaluate(() => (window as any).editTracks[1].length)).toBe(1);
  await page.evaluate(() => { (window as any).rejectPlaylistWrite = false; });
  await picker(page).getByRole('button', { name: '重新读取歌单状态', exact: true }).tap();
  await picker(page).getByRole('button', { name: '我的歌单1', exact: true }).tap();
  await expect(picker(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).playlistWrites.length)).toBe(2);
});

test('reopening during an in-flight add waits, with no duplicate write', async ({ page }) => {
  await playlistFixture(page); await login(page); await search(page);
  await page.evaluate(() => { (window as any).delayPlaylistWrite = true; });
  await picker(page).getByRole('button', { name: '我的歌单1', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).playlistWrites.length)).toBe(1);
  await picker(page).getByRole('button', { name: '关闭', exact: true }).tap();
  await page.getByRole('button', { name: '加入在线歌单', exact: true }).tap();
  await expect(picker(page).getByRole('status')).toBeVisible();
  await expect(picker(page).getByRole('button', { name: '我的歌单1', exact: true })).toHaveCount(0);
  await page.evaluate(() => { const win = window as any; win.releasePlaylistWrite(); win.delayPlaylistWrite = false; });
  await expect(picker(page).getByRole('button', { name: '我的歌单1', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).playlistWrites.length)).toBe(1);
});

test('removal retains rows until confirmed, supports reread after failure and refreshes the underlying playlist', async ({ page }, info) => {
  await playlistFixture(page); await login(page); await edit(page);
  page.on('dialog', dialog => dialog.accept());
  await page.evaluate(() => { (window as any).rejectPlaylistWrite = true; });
  await manager(page).getByRole('button', { name: '歌曲操作 原有歌曲', exact: true }).tap();
  await page.getByRole('button', { name: '从歌单移除', exact: true }).tap();
  await expect(manager(page).getByRole('alert')).toBeVisible();
  await expect(manager(page).getByRole('button', { name: '播放 原有歌曲', exact: true })).toBeVisible();
  await page.evaluate(() => { const win = window as any; win.rejectPlaylistWrite = false; win.delayPlaylistWrite = true; });
  await manager(page).getByRole('button', { name: '重新读取歌单状态', exact: true }).tap();
  await manager(page).getByRole('button', { name: '歌曲操作 原有歌曲', exact: true }).tap();
  await page.getByRole('button', { name: '从歌单移除', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).playlistWrites.length)).toBe(2);
  await expect(manager(page).getByRole('button', { name: '播放 原有歌曲', exact: true })).toBeVisible();
  await page.evaluate(() => (window as any).releasePlaylistWrite());
  await expect(manager(page).getByText('暂无结果', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('online-playlist-removed.png') });
  await manager(page).getByRole('button', { name: '关闭', exact: true }).tap();
  await expect(page.getByRole('button', { name: '播放 原有歌曲', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).playlistWrites)).toEqual([
    expect.objectContaining({ op: 'del', pid: '1', tracks: '81' }), expect.objectContaining({ op: 'del', pid: '1', tracks: '81' })]);
});

test('old gateways show an explicit unavailable action and foreign playlists cannot be managed', async ({ page }) => {
  await playlistFixture(page);
  await page.addInitScript(() => { (window as any).fixtureHealth.playlistEditProviders = []; });
  await login(page);
  await page.getByRole('textbox', { name: '搜索歌曲', exact: true }).fill('测试');
  await page.getByRole('button', { name: '搜索歌曲', exact: true }).tap();
  await page.getByRole('button', { name: '歌曲操作 测试歌曲', exact: true }).tap();
  await expect(page.getByRole('button', { name: '加入在线歌单', exact: true })).toBeDisabled();
  await expect(page.getByText('当前连接不支持在线歌单编辑，需要更新音乐服务器。', { exact: true })).toBeVisible();
  await page.getByRole('dialog', { name: '歌曲操作', exact: true }).getByRole('button', { name: '关闭', exact: true }).tap();
  await page.getByRole('button', { name: '我的歌单2', exact: true }).tap();
  await expect(page.getByRole('button', { name: '编辑歌单歌曲', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).playlistWrites)).toEqual([]);
});

test('removing during background pagination reloads shifted page boundaries without losing the last song', async ({ page }) => {
  await playlistFixture(page);
  await page.addInitScript(() => {
    const win = window as any, first = win.editTracks[1][0];
    win.editTracks[1] = [first, ...Array.from({ length: 150 }, (_, i) => ({ ...first, id: 1001 + i, name: '后续歌曲' + (i + 1) }))];
    win.delayPlaylistPage = true;
  });
  await login(page); await edit(page);
  await expect.poll(() => page.evaluate(() => typeof (window as any).releasePlaylistPage)).toBe('function');
  page.on('dialog', dialog => dialog.accept());
  await manager(page).getByRole('button', { name: '歌曲操作 原有歌曲', exact: true }).tap();
  await page.getByRole('button', { name: '从歌单移除', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).editTracks[1].length)).toBe(150);
  await page.evaluate(() => { const win = window as any; win.delayPlaylistPage = false; win.releasePlaylistPage(); });
  await expect(manager(page).getByRole('status')).toHaveCount(0);
  await manager(page).locator('.song-list').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(manager(page).getByRole('button', { name: '播放 后续歌曲150', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).playlistWrites.length)).toBe(1);
});
