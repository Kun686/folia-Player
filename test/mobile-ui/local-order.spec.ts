import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// local-order.spec.ts — original ordering through real WebKit, library projection and controlled native queue transport.
const songs = [10, 2, 1].map((n, i) => {
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  return { id, name: '曲目' + n, importedFileName: `Track ${n}.m4a`, fileLastModified: i * 1000,
    trackNumber: n === 10 ? 2 : 1, discNumber: n === 1 ? 2 : 1,
    artists: [{ id: '', name: '歌手' }], album: { id: '', name: '专辑 A' }, durationMs: 180000,
    sourceRef: { kind: 'local', mediaId: id } };
});
const nav = (page: Page, name: string) => page.getByRole('navigation', { name: '浏览本地音乐库' }).getByRole('button', { name, exact: true });
const names = (page: Page) => page.locator('.song-main strong');
test.beforeEach(async ({ page }) => {
  await page.addInitScript(songs => {
    const w = window as any; w.fixtureNoServer = true; w.fixtureSetLocalSongs(songs);
    w.fixtureFolders = { revision: '1', roots: [{ id: '00000000-0000-4000-8000-000000000100', name: '排序文件夹', ignoredPaths: [], directories: [],
      tracks: songs.slice(0, 2).map(s => ({ id: s.id, path: s.importedFileName })) }] };
  }, songs);
  await page.goto('/mobile.html');
});
test('filename/date/album order persists and starts exactly the visible queue without reordering active playback', async ({ page }, info) => {
  const field = page.getByRole('combobox', { name: '排序歌曲', exact: true }), direction = page.getByRole('combobox', { name: '排序方向', exact: true });
  await expect(names(page)).toHaveText(['曲目1', '曲目2', '曲目10']);
  await field.selectOption('fileLastModified'); await expect(names(page)).toHaveText(['曲目10', '曲目2', '曲目1']);
  await direction.selectOption('desc'); await expect(names(page)).toHaveText(['曲目1', '曲目2', '曲目10']);
  await page.reload(); await expect(field).toHaveValue('fileLastModified'); await expect(direction).toHaveValue('desc');
  await field.selectOption('albumTrack'); await direction.selectOption('asc');
  await expect(names(page)).toHaveText(['曲目2', '曲目10', '曲目1']);
  await page.getByRole('button', { name: '播放 曲目10', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => ({ queue: (window as any).fixturePlayback.queue.map((s: any) => s.name), index: (window as any).fixturePlayback.index })))
    .toEqual({ queue: ['曲目2', '曲目10', '曲目1'], index: 1 });
  await page.getByRole('button', { name: '返回音乐库', exact: true }).tap();
  await direction.selectOption('desc'); await expect(names(page)).toHaveText(['曲目1', '曲目10', '曲目2']);
  expect(await page.evaluate(() => (window as any).fixturePlayback.queue.map((s: any) => s.name))).toEqual(['曲目2', '曲目10', '曲目1']);
  const size = page.viewportSize()!; await page.setViewportSize({ width: size.height, height: size.width });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize(size);
  expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: test.info().outputPath('sort-' + info.project.name + '.png') });
  await page.getByRole('button', { name: '播放队列 · 3', exact: true }).tap();
  await expect(field).toHaveCount(0); await expect(names(page)).toHaveText(['曲目2', '曲目10', '曲目1']);
});
test('album disc labels and folder scope follow original order; search starts only its results', async ({ page }) => {
  await nav(page, '专辑').tap(); await page.getByRole('button', { name: '打开 专辑 A', exact: true }).tap();
  await expect(names(page)).toHaveText(['曲目2', '曲目10', '曲目1']);
  await expect(page.locator('.song-main .song-art')).toHaveText(['1', '2', '2-1']);
  await expect(page.getByRole('combobox', { name: '排序歌曲', exact: true })).toHaveCount(0);
  await nav(page, '文件夹').tap(); await page.getByRole('button', { name: '排序文件夹 2 首歌曲', exact: true }).tap();
  await expect(names(page)).toHaveText(['曲目2', '曲目10']);
  await page.getByRole('combobox', { name: '排序方向', exact: true }).selectOption('desc');
  await expect(names(page)).toHaveText(['曲目10', '曲目2']);
  await page.getByRole('textbox', { name: '搜索歌曲', exact: true }).fill('曲目2'); await expect(names(page)).toHaveText(['曲目2']);
  await page.getByRole('button', { name: '播放 曲目2', exact: true }).tap();
  expect(await page.evaluate(() => (window as any).fixturePlayback.queue.map((s: any) => s.name))).toEqual(['曲目2']);
});
test('playlist retains insertion order independently of global ordering', async ({ page }) => {
  await page.getByRole('combobox', { name: '排序方向', exact: true }).selectOption('desc');
  await nav(page, '歌单').tap(); await page.getByRole('button', { name: '新建歌单', exact: true }).tap();
  const dialog = page.getByRole('dialog', { name: '新建歌单', exact: true });
  await dialog.getByLabel('输入歌单名称').fill('测试顺序'); await dialog.getByRole('button', { name: '保存', exact: true }).tap();
  for (const name of ['曲目2', '曲目10']) {
    await nav(page, '全部歌曲').tap(); await page.getByRole('button', { name: '歌曲操作 ' + name, exact: true }).tap();
    await page.getByRole('button', { name: '添加到歌单', exact: true }).tap();
    await page.getByRole('dialog', { name: '添加到歌单', exact: true }).getByRole('button', { name: /测试顺序/ }).tap();
  }
  await nav(page, '歌单').tap(); await page.getByRole('button', { name: '打开 测试顺序', exact: true }).tap();
  await expect(names(page)).toHaveText(['曲目2', '曲目10']);
  await expect(page.getByRole('combobox', { name: '排序歌曲', exact: true })).toHaveCount(0);
});
test('failed preference save remains visible and can recover', async ({ page }) => {
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) {
      if (key === 'local_track_sort_field') throw new Error('disk-full');
      return original.call(this, key, value);
    };
    (window as any).restoreSortStorage = () => { Storage.prototype.setItem = original; };
  });
  const field = page.getByRole('combobox', { name: '排序歌曲', exact: true });
  await field.selectOption('albumTrack'); await expect(field).toHaveValue('fileName');
  await expect(page.locator('.mobile-track-sort [role="alert"]')).toBeVisible();
  await page.evaluate(() => (window as any).restoreSortStorage());
  await field.selectOption('albumTrack'); await expect(names(page)).toHaveText(['曲目2', '曲目10', '曲目1']);
  await expect(page.locator('.mobile-track-sort [role="alert"]')).toHaveCount(0);
});
