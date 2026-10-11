import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// local-playlist-files.spec.ts — real file reads/IndexedDB, fixture only for the native catalog and sharing boundary.
const songs = [1, 2, 3, 4].map(n => ({ id: `song${n}`, name: `歌曲 ${n}`, artists: [{ id: '', name: '歌手' }],
  album: { id: '', name: '' }, durationMs: 120000, importedFileName: n < 3 ? `${n}.wav` : 'same.wav',
  sourceRef: { kind: 'local', mediaId: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}` } }));
const nav = (page: Page) => page.getByRole('navigation', { name: '浏览本地音乐库' }).getByRole('button', { name: '歌单', exact: true });
const importDialog = (page: Page) => page.getByRole('dialog', { name: '导入歌单', exact: true });
async function selectFile(page: Page, text: string, name = 'mix.m3u8') {
  await importDialog(page).getByLabel('选择 M3U 文件', { exact: true }).setInputFiles({ name, mimeType: 'application/octet-stream', buffer: Buffer.from(text) });
}
async function save(page: Page) {
  await importDialog(page).getByRole('button', { name: '导入匹配歌曲', exact: true }).click();
  await expect(importDialog(page).getByText('歌单已保存，跳过的条目未加入。')).toBeVisible();
  await importDialog(page).getByRole('button', { name: '关闭', exact: true }).click();
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(songs => { const w = window as any; w.fixtureNoServer = true; w.fixtureSetLocalSongs(songs); }, songs);
  await page.goto('/mobile.html'); await nav(page).click();
  await page.getByRole('button', { name: '导入歌单', exact: true }).click();
});
test('previews skips, saves in original order and restores after reload', async ({ page }) => {
  expect(await importDialog(page).getByLabel('选择 M3U 文件', { exact: true }).getAttribute('accept')).toBeNull();
  await selectFile(page, '#EXTM3U\n#PLAYLIST:通勤\n2.wav\nC:\\Music\\1.wav\n2.wav\nsame.wav\nmissing.wav\nhttps://example.com/audio.mp3');
  await expect(importDialog(page).getByRole('status')).toHaveText('匹配 2 首 · 未找到 2 条 · 同名歧义 1 条');
  await save(page); await page.reload(); await nav(page).click();
  await page.getByRole('button', { name: '打开 通勤', exact: true }).click();
  await expect(page.locator('.song-main strong')).toHaveText(['歌曲 2', '歌曲 1']);
});
test('invalid file can be replaced; cancellation preserves preview and no-match import is disabled', async ({ page }) => {
  await selectFile(page, '1.wav', 'bad.zip');
  await expect(importDialog(page).getByRole('alert')).toBeVisible();
  await selectFile(page, '1.wav');
  await expect(importDialog(page).getByRole('alert')).toHaveCount(0);
  await importDialog(page).getByLabel('选择 M3U 文件', { exact: true }).setInputFiles([]);
  await expect(importDialog(page).getByRole('status')).toHaveText('匹配 1 首 · 未找到 0 条 · 同名歧义 0 条');
  await selectFile(page, 'missing.wav');
  await expect(importDialog(page).getByRole('button', { name: '导入匹配歌曲' })).toBeDisabled();
  await importDialog(page).getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.locator('.song-main strong')).toHaveText(['我喜欢的音乐']);
});
test('exports original filenames in order through native sharing and reimports its bytes', async ({ page }) => {
  await selectFile(page, '#PLAYLIST:原歌单\n2.wav\n1.wav'); await save(page);
  await page.getByRole('button', { name: '打开 原歌单', exact: true }).click();
  await page.getByRole('button', { name: '导出 M3U8', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导出 M3U8', exact: true });
  await dialog.getByRole('button', { name: '分享 M3U8 文件' }).click();
  await expect(dialog.getByRole('status')).toHaveText('分享已完成。');
  const exported = await page.evaluate(() => (window as any).fixtureSharedPlaylists[0]);
  expect(exported.fileName).toBe('原歌单.m3u8');
  expect(exported.content).toBe('#EXTM3U\r\n#PLAYLIST:原歌单\r\n#EXTINF:120,歌手 - 歌曲 2\r\n2.wav\r\n#EXTINF:120,歌手 - 歌曲 1\r\n1.wav\r\n');
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '导入歌单', exact: true }).click();
  await selectFile(page, exported.content, exported.fileName);
  await importDialog(page).getByLabel('输入歌单名称', { exact: true }).fill('回导'); await save(page);
  await page.getByRole('button', { name: '返回集合列表' }).click();
  await page.getByRole('button', { name: '打开 回导', exact: true }).click();
  await expect(page.locator('.song-main strong')).toHaveText(['歌曲 2', '歌曲 1']);
});
test('share failure and cancellation do not claim completion and allow retry', async ({ page }) => {
  await selectFile(page, '1.wav'); await save(page);
  await page.getByRole('button', { name: '打开 mix', exact: true }).click();
  await page.getByRole('button', { name: '导出 M3U8', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导出 M3U8', exact: true });
  await page.evaluate(() => { (window as any).fixtureShareFailure = true; });
  await dialog.getByRole('button', { name: '分享 M3U8 文件' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByText('分享已完成。')).toHaveCount(0);
  await page.evaluate(() => { (window as any).fixtureShareFailure = false; (window as any).fixtureShareCancelled = true; });
  await dialog.getByRole('button', { name: '分享 M3U8 文件' }).click();
  await expect(dialog.getByRole('status')).toHaveText('已取消分享。');
  await page.evaluate(() => { (window as any).fixtureShareCancelled = false; });
  await dialog.getByRole('button', { name: '分享 M3U8 文件' }).click();
  await expect(dialog.getByRole('status')).toHaveText('分享已完成。');
});
test('write failure retains file/name and retry creates exactly one list', async ({ page }) => {
  await selectFile(page, '1.wav');
  await importDialog(page).getByLabel('输入歌单名称', { exact: true }).fill('重试导入');
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    (window as any).failM3uWrite = true;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof original>) {
      if (this.name === 'lists' && (window as any).failM3uWrite) throw new DOMException('full', 'QuotaExceededError');
      return original.apply(this, args);
    };
  });
  await importDialog(page).getByRole('button', { name: '导入匹配歌曲' }).click();
  await expect(importDialog(page).getByRole('alert')).toBeVisible();
  await expect(importDialog(page).getByLabel('输入歌单名称', { exact: true })).toHaveValue('重试导入');
  await page.evaluate(() => { (window as any).failM3uWrite = false; });
  await save(page);
  await expect(page.getByRole('button', { name: '打开 重试导入', exact: true })).toHaveCount(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
