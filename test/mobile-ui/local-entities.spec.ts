import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

// local-entities.spec.ts — real original entity rules with fixture bridge, not native persistence or platform acceptance.
const songs = [1, 2, 3].map(n => {
  const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  return { id, name: '曲目' + n, artists: [{ id: '', name: n === 3 ? '歌手 B' : '歌手 A' }],
    album: { id: '', name: n === 3 ? '专辑 B' : '专辑 A' }, durationMs: 180000, sourceRef: { kind: 'local', mediaId: id } };
});
async function open(page: Page, type: '专辑' | '艺术家', name: string) {
  await page.getByRole('navigation', { name: '浏览本地音乐库' }).getByRole('button', { name: type, exact: true }).tap();
  await page.getByRole('button', { name: '打开 ' + name, exact: true }).tap();
  await page.getByRole('button', { name: '重命名或合并' + (type === '艺术家' ? '歌手' : type), exact: true }).tap();
  return page.getByRole('dialog', { name: '重命名或合并' + (type === '艺术家' ? '歌手' : type), exact: true });
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(songs => { const w = window as any; w.fixtureNoServer = true; w.fixtureSetLocalSongs(songs); }, songs);
  await page.goto('/mobile.html');
});
test('rename and merge keep current audio identity and position; original metadata remains a suggestion', async ({ page }, info) => {
  await page.getByRole('button', { name: '播放 曲目1', exact: true }).tap();
  await page.getByRole('button', { name: '返回音乐库', exact: true }).tap();
  await page.evaluate(() => (window as any).fixtureEmitPlayback({ position: 21, playing: true }));
  const dialog = await open(page, '艺术家', '歌手 A');
  await dialog.getByLabel('展示名称', { exact: true }).fill('整理后的歌手');
  await dialog.getByRole('button', { name: '确认重命名', exact: true }).tap();
  await expect(dialog.getByRole('heading', { name: '整理后的歌手', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '歌手 A · 2', exact: true })).toBeVisible();
  const saved = await page.evaluate(() => (window as any).fixturePlayback);
  expect(saved.position).toBe(21); expect(saved.playing).toBe(true); expect(saved.currentSong.id).toBe(songs[0].id);
  expect(saved.currentSong.artists[0].name).toBe('整理后的歌手');
  await dialog.getByLabel('展示名称', { exact: true }).fill('歌手 B');
  await dialog.getByRole('button', { name: '确认合并入“歌手 B”', exact: true }).tap();
  await expect(dialog.getByRole('heading', { name: '歌手 B', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).fixturePlayback.currentSong.artists[0].name)).toBe('歌手 B');
  await page.screenshot({ path: test.info().outputPath('entities-merge-' + info.project.name + '.png') });
  await dialog.getByRole('button', { name: '关闭', exact: true }).tap();
  await expect(page.getByRole('button', { name: '播放 曲目3', exact: true })).toBeVisible();
});
test('album split works by touch, scrolls on rotation and keeps other members', async ({ page }, info) => {
  const dialog = await open(page, '专辑', '专辑 A');
  await dialog.getByRole('button', { name: '拆分成员歌曲', exact: true }).tap();
  await dialog.getByLabel('输入新名称或搜索已有专辑...', { exact: true }).fill('独立专辑');
  await dialog.getByRole('button', { name: /曲目1 歌手 A/ }).tap();
  await expect(dialog.getByText('已选择 1 首歌曲', { exact: true })).toBeVisible();
  await expect.poll(() => dialog.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: test.info().outputPath('entities-members-' + info.project.name + '.png') });
  if (info.project.name === 'phone') await page.setViewportSize({ width: 844, height: 390 });
  await dialog.getByRole('button', { name: '从 1 首歌曲创建专辑', exact: true }).tap();
  await expect(dialog.getByLabel('展示名称', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('entities-split-' + info.project.name + '.png') });
  await dialog.getByRole('button', { name: '关闭', exact: true }).tap();
  await expect(page.getByRole('button', { name: '播放 曲目2', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '播放 曲目1', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '返回集合列表', exact: true }).tap();
  await expect(page.getByRole('button', { name: '打开 独立专辑', exact: true })).toBeVisible();
});
test('failed and conflicting saves retain the form; pending save prevents dismissal', async ({ page }) => {
  const dialog = await open(page, '专辑', '专辑 A');
  const input = dialog.getByLabel('展示名称', { exact: true });
  await input.fill('保留输入');
  await page.evaluate(() => { (window as any).fixtureEntityFailure = true; });
  await dialog.getByRole('button', { name: '确认重命名', exact: true }).tap();
  await expect(dialog.getByRole('alert')).toContainText('本次输入已保留');
  await expect(input).toHaveValue('保留输入');
  await page.evaluate(() => { const w = window as any; w.fixtureEntityFailure = false; w.fixtureEntityConflict = true; });
  await dialog.getByRole('button', { name: '确认重命名', exact: true }).tap();
  await expect(dialog.getByRole('alert')).toContainText('音乐库已发生变化');
  await expect(input).toHaveValue('保留输入');
  await page.evaluate(() => { const w = window as any; w.fixtureEntityConflict = false; w.fixtureEntityPending = true; });
  await dialog.getByRole('button', { name: '重新读取音乐库', exact: true }).tap();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await input.fill('最终名称');
  await dialog.getByRole('button', { name: '确认重命名', exact: true }).tap();
  await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toBeDisabled();
  await page.evaluate(() => (window as any).fixtureFinishEntity());
  await expect(dialog.getByRole('heading', { name: '最终名称', exact: true })).toBeVisible();
});

test('multiple artist targets append while preserving original membership', async ({ page }) => {
  const dialog = await open(page, '艺术家', '歌手 A');
  await dialog.getByRole('button', { name: '拆分成员歌曲', exact: true }).tap();
  await dialog.getByRole('radio', { name: /追加歌手/ }).tap();
  const input = dialog.getByLabel('输入新名称或搜索已有歌手...', { exact: true });
  await input.fill('新歌手 C');
  await dialog.getByRole('button', { name: '添加歌手目标', exact: true }).tap();
  await input.fill('新歌手 D');
  await dialog.getByRole('button', { name: '添加歌手目标', exact: true }).tap();
  await dialog.getByRole('button', { name: /曲目1 歌手 A/ }).tap();
  await dialog.locator('footer > button').last().tap();
  await expect(dialog.getByLabel('展示名称', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: '关闭', exact: true }).tap();
  await page.getByRole('button', { name: '播放 曲目1', exact: true }).tap();
  expect(await page.evaluate(() => (window as any).fixturePlayback.currentSong.artists.map((x: any) => x.name)))
    .toEqual(['歌手 A', '新歌手 C', '新歌手 D']);
});
