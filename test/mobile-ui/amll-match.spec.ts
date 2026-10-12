import { test, expect, clickPlayerTool } from './fixtures';
import type { Page, Route } from '@playwright/test';

// amll-match.spec.ts — original search, TTML parser, dialogs and storage; only network/native I/O use fixtures.
const item = (platform: 'ncm' | 'qq') => ({
  id: platform === 'ncm' ? 1 : 2, filename: 'fixture.ttml', createdAt: 1,
  musicNames: [platform === 'ncm' ? 'AMLL 网易候选' : 'AMLL QQ候选'],
  artistNames: ['Alias', '别名'], albumNames: ['歌词库专辑'], ncmMusicIds: platform === 'ncm' ? ['42'] : [],
  qqMusicIds: platform === 'qq' ? ['42'] : [], appleMusicIds: [], spotifyIds: [], isrcs: [], authorIds: [], authorUsernames: [],
});
const ttml = (text: string) => `<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word"><body><div><p begin="00:00.000" end="00:20.000" itunes:key="L1" ttm:agent="v1"><span begin="00:00.000" end="00:20.000">${text}</span></p></div></body></tt>`;
async function reply(route: Route) {
  const url = new URL(route.request().url());
  const body = url.pathname.endsWith('/search')
    ? { items: [item('ncm'), item('qq')], pagination: { page: 1, pageSize: 50, total: 2, totalPages: 1, hasMore: false } }
    : { ...item(url.searchParams.has('qqMusicId') ? 'qq' : 'ncm'), format: 'ttml',
      lyrics: ttml(url.searchParams.has('qqMusicId') ? 'QQ逐字样本' : '网易逐字样本') };
  expect(route.request().headers()).not.toHaveProperty('authorization');
  expect(route.request().headers()).not.toHaveProperty('cookie');
  await route.fulfill({ json: { status: 200, data: body }, headers: { 'access-control-allow-origin': '*' } });
}
async function start(page: Page, local = false) {
  await page.addInitScript(() => { (window as any).fixtureLyricTools = true; });
  await page.goto('/mobile.html');
  if (local) {
    await page.getByRole('button', { name: '导入音乐', exact: true }).click();
    await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
  } else {
    await page.getByRole('textbox', { name: '搜索歌曲' }).fill('测试');
    await page.getByRole('button', { name: '搜索歌曲', exact: true }).click();
    await page.getByRole('button', { name: '播放 测试歌曲', exact: true }).click();
  }
  await clickPlayerTool(page, '歌词与动效');
  await page.getByLabel('歌词动画', { exact: true }).selectOption('still');
  await page.locator('.visual-settings > header').getByRole('button', { name: '关闭', exact: true }).click();
  await page.evaluate(() => (window as any).fixtureEmitPlayback({ position: 1, playing: false }));
}
async function open(page: Page) {
  await clickPlayerTool(page, '歌词');
  await page.getByRole('button', { name: '在线匹配', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '匹配歌词', exact: true });
  await dialog.getByRole('button', { name: 'AMLLDB', exact: true }).tap();
  return dialog;
}
test('AMLL preview separates equal QQ/NetEase IDs and persists the selected platform offline', async ({ page }, info) => {
  await page.route('https://api.amll.dev/**', reply);
  await start(page);
  const dialog = await open(page);
  await expect(dialog.getByText('网易逐字样本', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: /AMLL QQ候选/ }).tap();
  await expect(dialog.getByText('QQ逐字样本', { exact: true })).toBeVisible();
  await expect(dialog.getByText('网易逐字样本', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeInViewport();
  await page.screenshot({ path: '.mobile-test-results/amll-' + info.project.name + '.png' });
  await page.evaluate(() => { (window as any).fixtureLyricWriteFailure = true; });
  await dialog.getByRole('button', { name: '保存', exact: true }).tap();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await page.evaluate(() => { (window as any).fixtureLyricWriteFailure = false; });
  await dialog.getByRole('button', { name: '保存', exact: true }).tap();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.lyric-stage').getByText('QQ逐字样本', { exact: true })).toBeVisible();
  const cache = await page.evaluate(() => JSON.parse(sessionStorage.getItem('fixture-lyric-cache') || '{}'));
  expect(Object.values(cache)).toEqual(expect.arrayContaining([expect.objectContaining({ state: expect.objectContaining({
    matchedLyricsSource: 'amll', matchedSongId: 42, matchedLyricsProviderPlatform: 'qq',
  }) })]));
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
  await page.unroute('https://api.amll.dev/**');
  await page.route('https://api.amll.dev/**', route => route.abort());
  await page.addInitScript(() => { (window as any).fixtureOfflineLyrics = true; });
  await start(page);
  await expect(page.locator('.lyric-stage').getByText('QQ逐字样本', { exact: true })).toBeVisible();
});
test('local AMLL selection changes lyrics while preserving metadata and cover choices', async ({ page }) => {
  await page.route('https://api.amll.dev/**', reply);
  await page.addInitScript(() => {
    const w = window as any; w.fixtureNoServer = true;
    w.fixtureMatchDocument = { title: '已有名称', titleOrigin: 'manual-match', artistNames: ['已有歌手'],
      albumName: '已有专辑', useOnlineCover: true, onlineMetadata: { source: 'qq', songId: 9, artists: [{ name: '已有歌手' }], coverUrl: 'https://example.invalid/cover.jpg' } };
  });
  await start(page, true);
  const before = await page.evaluate(() => (window as any).fixtureMatchDocument);
  const dialog = await open(page);
  await dialog.getByRole('button', { name: 'AMLL QQ候选', exact: true }).tap();
  await expect(dialog.getByText('QQ逐字样本', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '元数据', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: '保存', exact: true }).tap();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => (window as any).fixtureMatchDocument)).toMatchObject({ ...before,
    matchedLyricsSource: 'amll', matchedLyricsSongId: 42, matchedLyricsProviderPlatform: 'qq' });
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
});
test('rate limiting stops fallback requests and leaves the existing lyrics unchanged', async ({ page }) => {
  let count = 0;
  await page.route('https://api.amll.dev/**', route => { count++; return route.fulfill({ status: 429, json: { status: 429 } }); });
  await start(page);
  const dialog = await open(page);
  await expect(dialog.getByText('未找到结果，请尝试不同的关键词。', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  expect(count).toBe(1);
  await dialog.getByRole('button', { name: '取消', exact: true }).last().tap();
  await page.getByRole('dialog', { name: '歌词', exact: true }).getByRole('button', { name: '关闭', exact: true }).tap();
  await expect(page.locator('.lyric-stage').getByText('测试歌词', { exact: true })).toBeVisible();
});
test('a late AMLL search cannot replace the newly selected music provider', async ({ page }) => {
  let pending: Route | undefined;
  await page.route('https://api.amll.dev/**', route => { pending = route; });
  await start(page);
  const dialog = await open(page);
  await expect.poll(() => Boolean(pending)).toBe(true);
  await dialog.getByRole('button', { name: 'QQ 音乐', exact: true }).tap();
  await expect(dialog.getByRole('button', { name: /QQ 匹配候选/ })).toBeVisible();
  await reply(pending!);
  await expect(dialog.getByText('合成测试', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /AMLL QQ候选/ })).toHaveCount(0);
});
