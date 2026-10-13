import { test, expect } from './fixtures';
import { searchPlaybackFixture } from './search-playback-fixture';

// session-response-revision.spec.ts — real providers reject old account replies before publishing a collection.
for (const provider of ['qq', 'netease'] as const)
for (const change of ['replace', 'roundtrip', 'same', 'other-platform'] as const) {
  test(`${provider} pending playlist response after credential ${change}`, async ({ page }) => {
    await searchPlaybackFixture(page);
    await page.addInitScript(() => {
      const w = window as any, previous = w.fixtureOnlineRequest;
      const reply = (body: unknown) => ({ status: 200, headers: {}, body: JSON.stringify(body) });
      w.fixtureOnlineRequest = async (payload: any) => {
        const path = new URL(payload.path, 'https://fixture.invalid').pathname;
        if (payload.provider === 'qq' && path === '/user/playlist') return reply({ code: 200,
          playlist: [{ tid: '8', dirId: 8, dirName: '搜索回归歌单', songNum: 1 }], total: 1, more: false });
        if (!['/playlist/track/all', '/user/playlist-detail'].includes(path)) return previous(payload);
        const name = w.freshAccountReply ? '新请求歌曲' : '旧请求歌曲';
        if (!w.playlistRequested) {
          w.playlistRequested = true;
          await new Promise<void>(resolve => { w.releaseAccountPlaylist = resolve; });
        }
        return reply({ code: 200, total: 1, more: false, songs: [payload.provider === 'qq'
          ? { id: 200, mid: '200', title: name, singer: [{ id: 1, name: '测试歌手' }], album: { id: 1, name: '专辑' }, interval: 180 }
          : { id: 200, name, ar: [{ id: 1, name: '测试歌手' }], al: { id: 1, name: '专辑' }, dt: 180000 }] });
      };
    });
    await page.goto('/mobile.html');
    if (provider === 'qq') await page.getByRole('button', { name: 'QQ 音乐', exact: true }).tap();
    await page.getByRole('button', { name: '搜索回归歌单', exact: true }).tap();
    await expect.poll(() => page.evaluate(() => typeof (window as any).releaseAccountPlaylist)).toBe('function');
    await page.evaluate(async ({ provider, change }) => {
      const w = window as any;
      const module = await new Function('url', 'return import(url)')('/src/services/mobileRuntime.ts');
      const runtime = module.getMobileRuntime(), cookie = runtime.read(provider, 'cookie');
      const next = provider === 'qq' ? 'qqmusic_session=new-account' : 'new-account';
      if (change === 'same') runtime.write(provider, 'cookie', cookie);
      else if (change === 'other-platform') runtime.write(provider === 'qq' ? 'netease' : 'qq', 'cookie', 'other-account');
      else { runtime.write(provider, 'cookie', next); if (change === 'roundtrip') runtime.write(provider, 'cookie', cookie); }
      w.freshAccountReply = true; w.releaseAccountPlaylist();
    }, { provider, change });
    const rejected = change === 'replace' || change === 'roundtrip';
    const retry = page.getByRole('button', { name: '重试歌曲加载', exact: true });
    if (rejected) {
      await expect(retry).toBeVisible();
      await expect(page.getByRole('button', { name: '播放 旧请求歌曲', exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => (window as any).searchPlaybackCalls)).toEqual([]);
      await retry.tap();
      await expect(page.getByRole('button', { name: '播放 新请求歌曲', exact: true })).toBeVisible();
      await expect(retry).toHaveCount(0);
    } else {
      await expect(page.getByRole('button', { name: '播放 旧请求歌曲', exact: true })).toBeVisible();
      await expect(retry).toHaveCount(0);
    }
    await page.getByRole('button', { name: '播放 ' + (rejected ? '新请求歌曲' : '旧请求歌曲'), exact: true }).tap();
    await expect.poll(() => page.evaluate(() => (window as any).searchPlaybackCalls.map((call: any) => call.method))).toEqual(['setQueue']);
    expect(await page.evaluate(() => (window as any).fixturePlayback.currentSong.sourceRef.providerId)).toBe(provider);
  });
}
