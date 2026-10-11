import { test, expect, clickPlayerTool } from './fixtures';
import type { Page } from '@playwright/test';

// local-match.spec.ts — original full modal, real Omni/parsers, controlled provider and native storage responses.
async function start(page: Page) {
  await page.addInitScript(() => {
    const w = window as any; w.fixtureNoServer = true; w.fixtureLyricTools = true;
    w.fixtureMatchCover = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
    w.fixtureLocalLyric = { content: '[00:00.00]原导入歌词', fileName: 'original.lrc',
      embeddedContent: '[00:00.00]原内嵌歌词', lyricsSource: 'local' };
  });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
  await expect(page.getByRole('region', { name: '播放', exact: true }).getByRole('heading', { name: '本地测试音乐', exact: true })).toBeVisible();
    await clickPlayerTool(page, '歌词与动效');
  await page.getByLabel('歌词动画', { exact: true }).selectOption('still');
  await page.locator('.visual-settings > header').getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(() => (window as any).fixtureEmitPlayback({ playing: false, position: 1 }));
}
async function match(page: Page) {
  await clickPlayerTool(page, '歌词');
  await page.getByRole('button', { name: '在线匹配', exact: true }).click();
  return page.getByRole('dialog', { name: '匹配歌词', exact: true });
}
test('full local match saves metadata cover and lyrics without restarting playback, then restores imports', async ({ page }, info) => {
  await start(page);
  const dialog = await match(page);
  await dialog.getByRole('button', { name: '测试歌曲', exact: true }).tap();
  await dialog.getByRole('button', { name: '元数据', exact: true }).tap();
  await expect(dialog.getByRole('button', { name: '封面', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.locator('[data-local-match-preview]')).toContainText('测试歌曲');
  await page.screenshot({ path: '.mobile-test-results/local-match-' + info.project.name + '.png' });
  await dialog.getByRole('button', { name: '保存', exact: true }).tap();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: '播放 测试歌曲', exact: true })).toBeVisible();
  await expect(page.locator('.lyric-stage').getByText('测试歌词', { exact: true })).toBeVisible();
  const saved = await page.evaluate(() => ({ doc: (window as any).fixtureMatchDocument, state: (window as any).fixturePlayback,
    commands: (window as any).fixtureCommands }));
  expect(saved.doc).toMatchObject({ title: '测试歌曲', useOnlineCover: true, matchedLyricsSource: 'netease' });
  expect(saved.state.position).toBe(1); expect(saved.commands).toEqual([]);
  expect(saved.state.currentSong.name).toBe('测试歌曲');
  await match(page);
  await dialog.getByRole('button', { name: '不使用在线数据', exact: true }).tap();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: '播放 本地测试音乐', exact: true })).toBeVisible();
  await expect(page.locator('.lyric-stage').getByText('原导入歌词', { exact: true })).toBeVisible();
  await clickPlayerTool(page, '歌词');
  await page.getByRole('dialog', { name: '歌词', exact: true }).getByRole('button', { name: '网易云音乐', exact: true }).tap();
  await expect(page.locator('.lyric-stage').getByText('测试歌词', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('QQ match keeps imported metadata and save failure can retry', async ({ page }) => {
  await start(page); const dialog = await match(page);
  await dialog.getByRole('button', { name: 'QQ 音乐', exact: true }).tap();
  await dialog.getByRole('button', { name: 'QQ 匹配候选', exact: true }).tap();
  await expect(dialog.getByRole('button', { name: '元数据', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => { (window as any).fixtureLocalSaveFailure = true; });
  await dialog.getByRole('button', { name: '保存', exact: true }).tap();
  await expect(dialog.getByRole('alert')).toBeVisible();
  expect(await page.evaluate(() => (window as any).fixtureMatchWrites || 0)).toBe(0);
  await page.evaluate(() => { (window as any).fixtureLocalSaveFailure = false; });
  await dialog.getByRole('button', { name: '保存', exact: true }).tap();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => (window as any).fixtureMatchDocument)).toMatchObject({
    title: '本地测试音乐', artistNames: ['本地歌手'], matchedLyricsSource: 'qq' });
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
});
test('closing while lyrics are fetched discards the late save', async ({ page }) => {
  await start(page); const dialog = await match(page);
  await page.evaluate(() => { (window as any).fixtureLyricDelay = true; });
  await dialog.getByRole('button', { name: '测试歌曲', exact: true }).tap();
  await dialog.getByRole('button', { name: '保存', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).fixturePendingLyrics?.length || 0)).toBeGreaterThan(0);
  await dialog.getByRole('button', { name: '取消', exact: true }).last().tap();
  await expect(dialog).toBeHidden();
  await page.evaluate(async () => {
    const w = window as any; w.fixtureLyricDelay = false; w.fixturePendingLyrics.forEach((resolve: () => void) => resolve());
    await new Promise(resolve => setTimeout(resolve, 250));
  });
  expect(await page.evaluate(() => (window as any).fixtureMatchWrites || 0)).toBe(0);
});

test('QQ gateway errors remain visible and can recover after configuration', async ({ page }) => {
  await start(page);
  await page.evaluate(() => { (window as any).fixtureSearchFailure = true; });
  const dialog = await match(page);
  await dialog.getByRole('button', { name: 'QQ 音乐', exact: true }).tap();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await page.evaluate(() => { (window as any).fixtureSearchFailure = false; });
  await dialog.getByRole('button', { name: '搜索', exact: true }).tap();
  await expect(dialog.getByRole('button', { name: 'QQ 匹配候选', exact: true })).toBeVisible();
  await expect(dialog.getByRole('alert')).toBeHidden();
});
