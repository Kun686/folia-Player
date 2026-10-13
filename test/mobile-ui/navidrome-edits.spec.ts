import { test, expect, openPlayerTools } from './fixtures';
import { navidromeFixture } from './navidrome-fixture';

// navidrome-edits.spec.ts — authorized fixture writes only; covers touch actions and uncertain remote outcomes.
test.beforeEach(async ({ page }) => {
  await navidromeFixture(page); await page.goto('/mobile.html');
  await page.getByRole('button', { name: 'Navidrome', exact: true }).tap();
  await page.getByRole('button', { name: '配置 Navidrome', exact: true }).tap();
  const settings = page.getByRole('dialog', { name: 'Navidrome 音乐库' });
  await settings.getByLabel('服务器地址', { exact: true }).fill('https://music.example/library');
  await settings.getByLabel('用户名', { exact: true }).fill('user');
  await settings.getByLabel('密码', { exact: true }).fill('fixture-only');
  await settings.getByLabel('启用 Navidrome', { exact: true }).check();
  await settings.getByRole('button', { name: '保存连接', exact: true }).tap();
  await expect(settings.getByRole('status')).toHaveText('连接设置已保存');
  await settings.getByRole('button', { name: '关闭', exact: true }).tap();
  await page.getByRole('navigation', { name: 'Navidrome', exact: true }).getByRole('button', { name: '歌单', exact: true }).tap();
});
test('creates, renames and deletes playlists and adds/removes songs with explicit touch controls', async ({ page }) => {
  page.on('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '新建歌单', exact: true }).tap();
  const tools = page.getByRole('dialog', { name: '管理 Navidrome 歌单', exact: true });
  await tools.getByLabel('歌单名称', { exact: true }).fill('测试歌单');
  await tools.getByRole('button', { name: '新建歌单', exact: true }).tap();
  await expect(tools).toBeHidden();
  await page.getByRole('button', { name: '打开 测试歌单', exact: true }).tap();
  await page.getByRole('button', { name: '管理 Navidrome 歌单', exact: true }).tap();
  await tools.getByLabel('歌单名称', { exact: true }).fill('已重命名');
  await tools.getByRole('button', { name: '重命名歌单', exact: true }).tap();
  await expect(page.getByRole('heading', { name: '已重命名', exact: true })).toBeVisible();
  await page.getByRole('navigation', { name: 'Navidrome', exact: true }).getByRole('button', { name: '专辑', exact: true }).tap();
  await page.getByRole('button', { name: '打开 专辑甲', exact: true }).tap();
  await page.getByRole('button', { name: '歌曲操作 歌曲 一', exact: true }).tap();
  await page.getByRole('button', { name: '加入 Navidrome 歌单', exact: true }).tap();
  await tools.getByRole('button', { name: '已重命名', exact: true }).tap();
  await expect(tools).toBeHidden();
  await page.getByRole('navigation', { name: 'Navidrome', exact: true }).getByRole('button', { name: '歌单', exact: true }).tap();
  await page.getByRole('button', { name: '打开 已重命名', exact: true }).tap();
  await page.getByRole('button', { name: '歌曲操作 歌曲 一', exact: true }).tap();
  await page.getByRole('button', { name: '从歌单移除', exact: true }).tap();
  await expect(page.getByRole('button', { name: '播放 歌曲 一', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '管理 Navidrome 歌单', exact: true }).tap();
  await tools.getByRole('button', { name: '删除歌单', exact: true }).tap();
  await expect(tools).toBeHidden();
  await expect(page.getByRole('button', { name: '打开 已重命名', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).fixtureNavidromeMutations.map((r: any) => r.operation)))
    .toEqual(['createPlaylist', 'updatePlaylist', 'updatePlaylist', 'updatePlaylist', 'deletePlaylist']);
});
test('favorites use authoritative state and refresh the original favorites collection', async ({ page }) => {
  await page.getByRole('button', { name: '打开 收藏', exact: true }).tap();
  await page.getByRole('button', { name: '歌曲操作 歌曲 收藏', exact: true }).tap();
  await page.getByRole('button', { name: '取消收藏', exact: true }).tap();
  await expect(page.getByRole('button', { name: '播放 歌曲 收藏', exact: true })).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Navidrome', exact: true }).getByRole('button', { name: '专辑', exact: true }).tap();
  await page.getByRole('button', { name: '打开 专辑甲', exact: true }).tap();
  await page.getByRole('button', { name: '歌曲操作 歌曲 一', exact: true }).tap();
  await page.getByRole('button', { name: '收藏歌曲', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).fixtureNavidromeMutations.length)).toBe(2);
  await page.getByRole('navigation', { name: 'Navidrome', exact: true }).getByRole('button', { name: '歌单', exact: true }).tap();
  await page.getByRole('button', { name: '打开 收藏', exact: true }).tap();
  await expect(page.getByRole('button', { name: '播放 歌曲 一', exact: true })).toBeVisible();
});
test('dismissed writes survive navigation and unknown outcomes require inspection instead of repetition', async ({ page }) => {
  await page.evaluate(() => { (window as any).fixtureNavidromeWriteDelay = true; (window as any).fixtureNavidromeWriteFailure = true; });
  await page.getByRole('button', { name: '新建歌单', exact: true }).tap();
  const tools = page.getByRole('dialog', { name: '管理 Navidrome 歌单', exact: true });
  await tools.getByLabel('歌单名称', { exact: true }).fill('仅创建一次');
  await tools.getByRole('button', { name: '新建歌单', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => !!(window as any).fixtureNavidromeWriteRelease)).toBe(true);
  await tools.getByRole('button', { name: '关闭', exact: true }).tap();
  await page.getByRole('button', { name: '本地音乐', exact: true }).tap();
  await page.getByRole('button', { name: 'Navidrome', exact: true }).tap();
  await page.evaluate(() => { (window as any).fixtureNavidromeWriteRelease(); });
  await expect(page.getByRole('alert')).toContainText('本次写入结果无法确认');
  await page.getByRole('button', { name: '刷新并检查结果', exact: true }).tap();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('navigation', { name: 'Navidrome', exact: true }).getByRole('button', { name: '歌单', exact: true }).tap();
  await expect(page.getByRole('button', { name: '打开 仅创建一次', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).fixtureNavidromeMutations.length)).toBe(1);
});
test('player actions share favorites without refetching on native time snapshots', async ({ page }) => {
  await page.getByRole('navigation', { name: 'Navidrome', exact: true }).getByRole('button', { name: '专辑', exact: true }).tap();
  await page.getByRole('button', { name: '打开 专辑甲', exact: true }).tap();
  await page.getByRole('button', { name: '播放 歌曲 一', exact: true }).tap();
  await openPlayerTools(page);
  const player = page.locator('.player-panel');
  await expect(player.getByRole('button', { name: '收藏歌曲', exact: true })).toBeEnabled();
  const calls = await page.evaluate(() => (window as any).fixtureNavidromeRequests.filter((r: any) => r.operation === 'getSong').length);
  await page.evaluate(async () => {
    const win = window as any;
    for (let i = 0; i < 6; i++) { win.fixtureEmitPlayback({ position: i, currentSong: { ...win.fixturePlayback.currentSong } }); await new Promise(requestAnimationFrame); }
  });
  expect(await page.evaluate(() => (window as any).fixtureNavidromeRequests.filter((r: any) => r.operation === 'getSong').length)).toBe(calls);
  await player.getByRole('button', { name: '收藏歌曲', exact: true }).tap();
  await expect(player.getByRole('button', { name: '取消收藏', exact: true })).toBeEnabled();
  await player.getByRole('button', { name: '加入 Navidrome 歌单', exact: true }).tap();
  const sheet = page.getByRole('dialog', { name: '管理 Navidrome 歌单', exact: true });
  await sheet.getByRole('button', { name: '歌单甲', exact: true }).tap();
  await expect(sheet).toBeHidden();
  expect(await page.evaluate(() => (window as any).fixtureNavidromePlaylists[0].entry.map((s: any) => s.id))).toEqual(['歌单', '一']);
});
test('an uncertain completed deletion refreshes the playlist list without repeating the write', async ({ page }) => {
  await page.getByRole('button', { name: '打开 歌单甲', exact: true }).tap();
  await page.getByRole('button', { name: '管理 Navidrome 歌单', exact: true }).tap();
  const tools = page.getByRole('dialog', { name: '管理 Navidrome 歌单', exact: true });
  page.once('dialog', dialog => dialog.dismiss());
  await tools.getByRole('button', { name: '删除歌单', exact: true }).tap();
  expect(await page.evaluate(() => (window as any).fixtureNavidromeMutations.length)).toBe(0);
  await page.evaluate(() => { (window as any).fixtureNavidromeWriteFailure = true; });
  page.once('dialog', dialog => dialog.accept());
  await tools.getByRole('button', { name: '删除歌单', exact: true }).tap();
  await expect(tools.getByRole('alert')).toContainText('本次写入结果无法确认');
  await tools.getByRole('button', { name: '关闭', exact: true }).tap();
  await page.getByRole('button', { name: '刷新并检查结果', exact: true }).tap();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '打开 歌单甲', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).fixtureNavidromeMutations.length)).toBe(1);
});
