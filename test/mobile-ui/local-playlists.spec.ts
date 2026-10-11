import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// local-playlists.spec.ts — real WebKit IndexedDB and UI, with only the existing native catalog/playback fixture.
const songs = [1, 2, 3].map(n => ({ id: 'song' + n, name: '音乐 ' + n, artists: [{ id: '', name: 'Artist' }],
  album: { id: '', name: 'Album' }, durationMs: 120000,
  sourceRef: { kind: 'local', mediaId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` } }));
const nav = (page: Page, name: string) => page.getByRole('navigation', { name: '浏览本地音乐库' }).getByRole('button', { name, exact: true });
async function create(page: Page, title: string) {
  await nav(page, '歌单').click();
  await page.getByRole('button', { name: '新建歌单', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建歌单', exact: true });
  await dialog.getByLabel('输入歌单名称').fill(title);
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toBeHidden();
}
async function add(page: Page, song: string, playlist: string) {
  await nav(page, '全部歌曲').click();
  await page.getByRole('button', { name: '歌曲操作 ' + song, exact: true }).click();
  await page.getByRole('button', { name: '添加到歌单', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加到歌单', exact: true });
  await dialog.getByRole('button', { name: new RegExp(playlist) }).click();
  await expect(dialog).toBeHidden();
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(songs => { const w = window as any; w.fixtureNoServer = true; w.fixtureSetLocalSongs(songs); }, songs);
  await page.goto('/mobile.html');
});
test('create, add, reorder, rename and remove playlist members survive reload and retain audio', async ({ page }) => {
  await create(page, '通勤');
  await add(page, '音乐 2', '通勤');
  await add(page, '音乐 1', '通勤');
  await add(page, '音乐 2', '通勤');
  await page.reload();
  await nav(page, '歌单').click();
  await page.getByRole('button', { name: '打开 通勤', exact: true }).click();
  await expect(page.locator('.song-main strong')).toHaveText(['音乐 2', '音乐 1']);
  await page.getByRole('button', { name: '歌曲操作 音乐 1', exact: true }).click();
  await page.getByRole('button', { name: '上移', exact: true }).click();
  await expect(page.locator('.song-main strong')).toHaveText(['音乐 1', '音乐 2']);
  await page.getByRole('button', { name: '播放 音乐 1', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).fixturePlayback.queue.map((song: any) => song.name))).toEqual(['音乐 1', '音乐 2']);
  await page.getByRole('button', { name: '返回音乐库', exact: true }).click();
  await page.getByRole('button', { name: '重命名歌单', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '重命名歌单', exact: true });
  await dialog.getByLabel('输入歌单名称').fill('夜晚');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('heading', { name: '夜晚', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '歌曲操作 音乐 1', exact: true }).click();
  await page.getByRole('button', { name: '从歌单移除', exact: true }).click();
  await expect(page.locator('.song-main strong')).toHaveText(['音乐 2']);
  await nav(page, '全部歌曲').click();
  await expect(page.locator('.song-main strong')).toHaveText(['音乐 1', '音乐 2', '音乐 3']);
});
test('favorites survive reload; removing an audio file cleans playlists; deleting a list retains other audio', async ({ page }) => {
  await create(page, '删除测试');
  await add(page, '音乐 1', '删除测试');
  await nav(page, '全部歌曲').click();
  await page.getByRole('button', { name: '歌曲操作 音乐 1', exact: true }).click();
  await page.getByRole('button', { name: '加入我喜欢的音乐', exact: true }).click();
  await expect(page.getByRole('button', { name: '歌曲操作 音乐 1', exact: true })).toBeEnabled();
  await page.reload();
  await nav(page, '歌单').click();
  await page.getByRole('button', { name: '打开 我喜欢的音乐', exact: true }).click();
  await expect(page.locator('.song-main strong')).toHaveText(['音乐 1']);
  await expect(page.getByRole('button', { name: '删除歌单', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '歌曲操作 音乐 1', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '移除 音乐 1', exact: true }).click();
  await expect(page.getByRole('button', { name: '播放 音乐 1', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '返回集合列表' }).click();
  await page.getByRole('button', { name: '打开 删除测试', exact: true }).click();
  await expect(page.locator('.song-main')).toHaveCount(0);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '删除歌单', exact: true }).click();
  await expect(page.getByRole('button', { name: '打开 我喜欢的音乐', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '打开 删除测试', exact: true })).toHaveCount(0);
  await nav(page, '全部歌曲').click();
  await expect(page.locator('.song-main strong')).toHaveText(['音乐 2', '音乐 3']);
});
test('saving a mixed queue reports and retains only local tracks in their queue order', async ({ page }) => {
  await page.evaluate(songs => {
    const w = window as any;
    w.fixtureEmitPlayback({ queue: [songs[2], { ...songs[0], sourceRef: { kind: 'online', providerId: 'qq', mediaId: 'remote' } }, songs[0]], index: 0, currentSong: songs[2] });
  }, songs);
  await page.getByRole('button', { name: '播放队列 · 3', exact: true }).click();
  await page.getByRole('button', { name: '保存为歌单', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建歌单', exact: true });
  await expect(dialog.getByText('保存 2 首本地歌曲', { exact: true })).toBeVisible();
  await dialog.getByLabel('输入歌单名称').fill('队列');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: '播放队列 · 3', exact: true }).click();
  await nav(page, '歌单').click();
  await page.getByRole('button', { name: '打开 队列', exact: true }).click();
  await expect(page.locator('.song-main strong')).toHaveText(['音乐 3', '音乐 1']);
});
test('failed IndexedDB save retains entered name and allows retry without duplicate lists', async ({ page }) => {
  await nav(page, '歌单').click();
  await page.getByRole('button', { name: '新建歌单', exact: true }).click();
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as any).fixturePlaylistSaveFailure = true;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (this.name === 'lists' && (window as any).fixturePlaylistSaveFailure) throw new DOMException('full', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  const dialog = page.getByRole('dialog', { name: '新建歌单', exact: true });
  await dialog.getByLabel('输入歌单名称').fill('重试');
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('输入歌单名称')).toHaveValue('重试');
  await page.evaluate(() => { (window as any).fixturePlaylistSaveFailure = false; });
  await dialog.getByRole('button', { name: '保存', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: '打开 重试', exact: true })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
