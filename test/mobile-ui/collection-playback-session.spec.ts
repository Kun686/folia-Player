import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { searchPlaybackFixture, seedSearchQueue } from './search-playback-fixture';

// collection-playback-session.spec.ts — real account generations and collection playback over a delayed native save.
async function collectionPlaybackFixture(page: Page) {
  await searchPlaybackFixture(page);
  await page.addInitScript(() => {
    const w = window as any, bridge = w.Capacitor.nativePromise, request = w.fixtureOnlineRequest;
    w.fixtureOnlineRequest = async (payload: any) => {
      const path = new URL(payload.path, 'https://fixture.invalid').pathname;
      if (payload.provider !== 'qq' || !['/user/playlist', '/user/playlist-detail'].includes(path)) return request(payload);
      const body = path === '/user/playlist'
        ? { code: 200, playlist: [{ tid: '8', dirId: 8, dirName: '搜索回归歌单', songNum: 2 }], total: 1, more: false }
        : { code: 200, songs: [200, 201].map(id => ({ id, mid: String(id), title: '搜索歌曲' + id,
          singer: [{ id: 1, name: '测试歌手' }], album: { id: 1, name: '专辑' }, interval: 180 })), total: 2, more: false };
      return { status: 200, headers: {}, body: JSON.stringify(body) };
    };
    w.Capacitor.nativePromise = async (plugin: string, method: string, options: any) => {
      if (method === 'saveSession' && w.delayCollectionSave) {
        w.delayCollectionSave = false;
        await new Promise<void>((resolve, reject) => { w.releaseCollectionSave = () => w.failCollectionSave ? reject(new Error('secure-storage')) : resolve(); });
      }
      return bridge(plugin, method, options);
    };
  });
}
async function delaySave(page: Page, provider: 'qq' | 'netease') {
  await page.evaluate(async provider => {
    const w = window as any;
    const module = await new Function('url', 'return import(url)')('/src/services/mobileRuntime.ts');
    w.collectionRuntime = module.getMobileRuntime();
    w.delayCollectionSave = true;
    // Persist the same synthetic credential so the pending save alone does not change the account.
    w.collectionRuntime.write(provider, 'cookie', w.collectionRuntime.read(provider, 'cookie'));
  }, provider);
  await expect.poll(() => page.evaluate(() => typeof (window as any).releaseCollectionSave)).toBe('function');
}

for (const provider of ['netease', 'qq'] as const)
for (const action of ['logout', 'switch', 'replace', 'continue', 'other-account', 'save-failure'] as const) test(`${provider} collection playback during a pending session save: ${action}`, async ({ page }) => {
  await collectionPlaybackFixture(page);
  await page.goto('/mobile.html'); await seedSearchQueue(page);
  if (provider === 'qq') await page.getByRole('button', { name: 'QQ 音乐', exact: true }).tap();
  await page.getByRole('button', { name: '搜索回归歌单', exact: true }).tap();
  await expect(page.getByRole('button', { name: '播放 搜索歌曲201', exact: true })).toBeVisible();
  const previous = await page.evaluate(() => structuredClone((window as any).fixturePlayback));
  await delaySave(page, provider);
  await page.getByRole('button', { name: '播放 搜索歌曲201', exact: true }).tap();
  if (action === 'logout') await page.getByRole('button', { name: '退出登录', exact: true }).tap();
  if (action === 'switch') await page.getByRole('button', { name: provider === 'netease' ? 'QQ 音乐' : '网易云', exact: true }).tap();
  if (action === 'replace') await page.evaluate(provider => { (window as any).collectionRuntime.write(provider, 'cookie', 'fixture-new-account'); }, provider);
  if (action === 'other-account') await page.evaluate(provider => {
    (window as any).collectionRuntime.write(provider === 'qq' ? 'netease' : 'qq', 'cookie', 'fixture-other-account');
  }, provider);
  if (action === 'save-failure') await page.evaluate(() => { (window as any).failCollectionSave = true; });
  await page.evaluate(() => { (window as any).releaseCollectionSave(); });
  const error = action === 'save-failure' ? '请求失败，请检查连接或重新登录。' : '播放队列已变化，请重新选择歌曲。';
  await expect.poll(() => page.evaluate(error => (window as any).searchPlaybackCalls.length > 0
    || document.body.textContent?.includes(error), error)).toBe(true);
  const calls = await page.evaluate(() => (window as any).searchPlaybackCalls);
  if (action === 'continue' || action === 'other-account') {
    expect(calls.map((call: any) => call.method)).toEqual(['setQueue']);
    expect(calls[0].songs.map((song: any) => song.sourceRef.mediaId)).toEqual(['200', '201']);
    expect(calls[0].songs.every((song: any) => song.sourceRef.providerId === provider)).toBe(true);
    expect(calls[0].index).toBe(1);
    await expect(page.getByRole('button', { name: '返回音乐库', exact: true })).toBeVisible();
  } else {
    expect(calls).toEqual([]);
    await expect(page.getByText(error, { exact: true })).toBeVisible();
    // This bridge does not emulate native account purging; unchanged state proves no stale playback command was sent.
    expect(await page.evaluate(() => (window as any).fixturePlayback)).toEqual(previous);
  }
});

for (const provider of ['netease', 'qq'] as const) test(`${provider} existing queue selection still waits for durable session writes`, async ({ page }) => {
  await collectionPlaybackFixture(page); await page.goto('/mobile.html'); await seedSearchQueue(page);
  await page.getByRole('button', { name: '播放队列 · 2', exact: true }).tap();
  await delaySave(page, provider);
  const play = page.getByRole('button', { name: '播放 ' + provider + '原队列歌曲', exact: true });
  await play.tap(); await expect(play).toBeDisabled();
  expect(await page.evaluate(() => (window as any).searchPlaybackCalls)).toEqual([]);
  await page.evaluate(() => { (window as any).releaseCollectionSave(); });
  await expect.poll(() => page.evaluate(() => (window as any).searchPlaybackCalls.map((call: any) => call.method))).toEqual(['selectQueue']);
  expect(await page.evaluate(() => (window as any).fixturePlayback.index)).toBe(provider === 'qq' ? 0 : 1);
  expect(await page.evaluate(() => (window as any).fixturePlayback.queue.map((song: any) => song.sourceRef.providerId))).toEqual(['qq', 'netease']);
});
