import { test, expect } from './fixtures';

// local-collections.spec.ts — browse and mutate fixture metadata while asserting the real queue bridge inputs.
const song = (number: number, name: string, album: string, artist: string) => {
  const id = `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
  return { id, name, artists: [{ id: '', name: artist }], album: { id: '', name: album }, durationMs: 180000,
    sourceRef: { kind: 'local', mediaId: id } };
};
const songs = [song(1, 'Track 10', '专辑 A', 'Alice / Bob'), song(2, 'Track 2', '专辑 A', 'Alice'),
  song(3, 'Other', '专辑 B', 'Bob'), song(4, 'Unknown', '', '')];
test.beforeEach(async ({ page }) => {
  await page.addInitScript(songs => { const win = window as any; win.fixtureNoServer = true; win.fixtureSetLocalSongs(songs); }, songs);
  await page.goto('/mobile.html');
});
test('album and artist selection plays only that group in displayed order', async ({ page }) => {
  const nav = page.getByRole('navigation', { name: '浏览本地音乐库' });
  await nav.getByRole('button', { name: '专辑', exact: true }).click();
  await page.getByRole('button', { name: '打开 专辑 A', exact: true }).click();
  await expect(page.getByRole('button', { name: '播放 Other', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '播放 Track 2', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).fixturePlayback.queue.map((x: any) => x.name))).toEqual(['Track 2', 'Track 10']);
  await expect.poll(() => page.evaluate(() => (window as any).fixturePlayback.index)).toBe(0);
  await page.getByRole('button', { name: '返回音乐库', exact: true }).click();
  await page.getByRole('button', { name: '返回集合列表' }).click();
  await nav.getByRole('button', { name: '艺术家', exact: true }).click();
  await page.getByRole('button', { name: '打开 Bob', exact: true }).click();
  await expect(page.getByRole('button', { name: '播放 Track 10', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '播放 Other', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '播放 Track 2', exact: true })).toHaveCount(0);
  await page.getByLabel('搜索歌曲', { exact: true }).fill('other');
  await page.getByRole('button', { name: '播放 Other', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).fixturePlayback.queue.map((x: any) => x.name))).toEqual(['Other']);
});
test('search finds albums and live catalog edits cannot leave a stale selected track list', async ({ page }) => {
  await page.getByRole('navigation', { name: '浏览本地音乐库' }).getByRole('button', { name: '专辑', exact: true }).click();
  await page.getByLabel('搜索歌曲', { exact: true }).fill('other');
  await expect(page.getByRole('button', { name: '打开 专辑 B', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '打开 专辑 A', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '打开 专辑 B', exact: true }).click();
  await expect(page.getByLabel('搜索歌曲', { exact: true })).toHaveValue('');
  await page.evaluate(next => (window as any).fixtureSetLocalSongs(next), [songs[0], songs[1], { ...songs[2], album: { id: '', name: '专辑 C' } }]);
  await expect(page.getByRole('button', { name: '打开 专辑 C', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '播放 Other', exact: true })).toHaveCount(0);
  await page.evaluate(next => (window as any).fixtureSetLocalSongs(next), [songs[0], songs[1],
    { ...songs[2], album: { id: '', name: '专辑 C' } }, song(5, 'New', '专辑 B', 'Bob')]);
  await expect(page.getByRole('button', { name: '打开 专辑 B', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '打开 专辑 C', exact: true }).click();
  await page.getByRole('button', { name: '歌曲操作 Other', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '移除 Other', exact: true }).click();
  await expect(page.getByRole('button', { name: '打开 专辑 A', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '打开 专辑 C', exact: true })).toHaveCount(0);
  await page.getByLabel('搜索歌曲', { exact: true }).fill('not found');
  await expect(page.getByText('暂无结果', { exact: true })).toBeVisible();
});
test('long collection names fit narrow windows and collection lists stay virtualized', async ({ page }) => {
  const many = Array.from({ length: 400 }, (_, index) => song(index + 1, '曲目' + index, '很长的专辑名称'.repeat(8) + index, '歌手' + index));
  await page.evaluate(next => (window as any).fixtureSetLocalSongs(next), many);
  await page.getByRole('navigation', { name: '浏览本地音乐库' }).getByRole('button', { name: '专辑', exact: true }).click();
  const list = page.locator('.local-collections');
  await expect(list).toBeVisible();
  expect(await list.getByRole('button').count()).toBeLessThan(35);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('local-collections.png') });
  await list.getByRole('button').first().click();
  await expect(page.getByRole('button', { name: '返回集合列表' })).toBeVisible();
  await expect(page.getByRole('button', { name: '播放 曲目0', exact: true })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
