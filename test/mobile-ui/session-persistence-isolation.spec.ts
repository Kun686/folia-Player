import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { searchPlaybackFixture, seedSearchQueue } from './search-playback-fixture';
import { installLoginFixture, openLogin } from './login-fixture';

// session-persistence-isolation.spec.ts — real runtime durability checks over controlled per-platform save failures.
type Provider = 'qq' | 'netease';
const label = (provider: Provider) => provider === 'qq' ? 'QQ 音乐' : '网易云';
const other = (provider: Provider): Provider => provider === 'qq' ? 'netease' : 'qq';
async function savingFixture(page: Page) {
  await page.addInitScript(() => {
    const w = window as any, bridge = w.Capacitor.nativePromise;
    w.failedSaveProvider = '';
    w.Capacitor.nativePromise = async (plugin: string, method: string, options: any) => {
      if (method === 'saveSession' && options.provider === w.failedSaveProvider) throw new Error('controlled-secure-storage');
      return bridge(plugin, method, options);
    };
  });
}
async function persist(page: Page, provider: Provider, fail: boolean) {
  return page.evaluate(async ({ provider, fail }) => {
    const w = window as any;
    const { getMobileRuntime } = await new Function('url', 'return import(url)')('/src/services/mobileRuntime.ts');
    const { flushSessions } = await new Function('url', 'return import(url)')('/src/mobile/runtime.ts');
    const runtime = getMobileRuntime(); w.failedSaveProvider = fail ? provider : '';
    runtime.write(provider, 'cookie', runtime.read(provider, 'cookie') ?? 'synthetic-session');
    return flushSessions().then(() => 'saved', (error: Error) => error.message);
  }, { provider, fail });
}
async function catalogFixture(page: Page) {
  await searchPlaybackFixture(page); await savingFixture(page);
  await page.addInitScript(() => {
    const w = window as any, request = w.fixtureOnlineRequest;
    w.fixtureOnlineRequest = async (payload: any) => {
      const path = new URL(payload.path, 'https://fixture.invalid').pathname;
      if (payload.provider !== 'qq' || !['/user/playlist', '/user/playlist-detail'].includes(path)) return request(payload);
      const body = path === '/user/playlist'
        ? { code: 200, playlist: [{ tid: '8', dirId: 8, dirName: '搜索回归歌单', songNum: 2 }], total: 1, more: false }
        : { code: 200, songs: [200, 201].map(id => ({ id, mid: String(id), title: '搜索歌曲' + id,
          singer: [{ id: 1, name: '测试歌手' }], album: { id: 1, name: '专辑' }, interval: 180 })), total: 2, more: false };
      return { status: 200, headers: {}, body: JSON.stringify(body) };
    };
  });
}

for (const provider of ['qq', 'netease'] as const) {
  for (const entry of ['collection', 'search'] as const) test(`${provider} ${entry} works when only the other platform save failed`, async ({ page }) => {
    await catalogFixture(page); await page.goto('/mobile.html'); await seedSearchQueue(page);
    await page.getByRole('button', { name: label(other(provider)), exact: true }).tap();
    await expect(page.getByRole('button', { name: '搜索回归歌单', exact: true })).toBeVisible();
    expect(await persist(page, other(provider), true)).toBe('controlled-secure-storage');
    await page.getByRole('button', { name: label(provider), exact: true }).tap();
    await expect(page.getByRole('button', { name: '搜索回归歌单', exact: true })).toBeVisible();
    await expect(page.locator('.library-panel > [role=alert]')).toHaveCount(0);
    if (entry === 'collection') {
      await page.getByRole('button', { name: '搜索回归歌单', exact: true }).tap();
      await page.getByRole('button', { name: '播放 搜索歌曲201', exact: true }).tap();
    } else {
      await page.getByRole('textbox', { name: '搜索歌曲', exact: true }).fill('歌曲');
      await page.getByRole('button', { name: '搜索歌曲', exact: true }).tap();
      await page.getByRole('button', { name: provider === 'qq' ? '播放 QQ搜索歌曲100' : '播放 搜索歌曲100', exact: true }).tap();
    }
    await expect.poll(() => page.evaluate(() => (window as any).fixturePlayback.currentSong?.sourceRef.providerId)).toBe(provider);
    await expect(page.getByRole('button', { name: '返回音乐库', exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).fixturePlayback.playing)).toBe(true);
    // Success for this platform must not silently erase the other platform's persistence failure.
    expect(await persist(page, other(provider), true)).toBe('controlled-secure-storage');
  });

  test(`${provider} selection in a mixed queue is independent of the other platform save`, async ({ page }) => {
    await catalogFixture(page); await page.goto('/mobile.html'); await seedSearchQueue(page);
    expect(await persist(page, other(provider), true)).toBe('controlled-secure-storage');
    await page.getByRole('button', { name: '播放队列 · 2', exact: true }).tap();
    await page.getByRole('button', { name: '播放 ' + provider + '原队列歌曲', exact: true }).tap();
    await expect.poll(() => page.evaluate(() => (window as any).searchPlaybackCalls.map((call: any) => call.method))).toEqual(['selectQueue']);
    expect(await page.evaluate(() => (window as any).fixturePlayback.currentSong.sourceRef.providerId)).toBe(provider);
    expect(await page.evaluate(() => (window as any).fixturePlayback.queue.map((song: any) => song.sourceRef.providerId))).toEqual(['qq', 'netease']);
  });

  test(`${provider} failed own save still blocks selection until its save recovers`, async ({ page }) => {
    await catalogFixture(page); await page.goto('/mobile.html'); await seedSearchQueue(page);
    // Let the initial account read finish before failing persistence for the queue action under test.
    await expect(page.getByRole('button', { name: '搜索回归歌单', exact: true })).toBeVisible();
    expect(await persist(page, provider, true)).toBe('controlled-secure-storage');
    await page.getByRole('button', { name: '播放队列 · 2', exact: true }).tap();
    const play = page.getByRole('button', { name: '播放 ' + provider + '原队列歌曲', exact: true });
    await play.tap(); await expect(page.locator('.library-panel > [role=alert]')).toBeVisible();
    expect(await page.evaluate(() => (window as any).searchPlaybackCalls)).toEqual([]);
    expect(await persist(page, provider, false)).toBe('saved');
    await play.tap(); await expect(page.getByRole('button', { name: '返回音乐库', exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).fixturePlayback.currentSong.sourceRef.providerId)).toBe(provider);
  });

  test(`${provider} failed save prevents an atomic mixed-source collection replacement`, async ({ page }) => {
    await catalogFixture(page); await page.goto('/mobile.html'); await seedSearchQueue(page);
    await page.evaluate(() => {
      const w = window as any; w.fixtureCache.songs = structuredClone(w.fixturePlayback.queue); w.fixtureCache.count = 2;
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await persist(page, provider, true)).toBe('controlled-secure-storage');
    await page.getByRole('button', { name: '媒体缓存', exact: true }).tap();
    await page.getByRole('button', { name: '播放 ' + other(provider) + '原队列歌曲', exact: true }).tap();
    await expect(page.locator('.library-panel > [role=alert]')).toBeVisible();
    expect(await page.evaluate(() => (window as any).searchPlaybackCalls)).toEqual([]);
  });

  test(`${provider} login confirmation ignores another platform persistence failure`, async ({ page }) => {
    await installLoginFixture(page); await savingFixture(page); const dialog = await openLogin(page, provider);
    expect(await persist(page, other(provider), true)).toBe('controlled-secure-storage');
    await dialog.getByRole('button', { name: '重新生成二维码', exact: true }).tap();
    await expect(dialog.getByRole('img')).toBeVisible();
    await page.evaluate(() => { (window as any).loginConfirmed = true; document.dispatchEvent(new Event('visibilitychange')); });
    await expect(dialog.getByText('已登录', { exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: '关闭', exact: true }).tap();
    await expect(page.getByText('登录恢复账号', { exact: true })).toBeVisible();
  });
}
