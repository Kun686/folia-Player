import type { Page } from '@playwright/test';
import { searchPlaybackFixture } from './search-playback-fixture';

// song-replacement-fixture.ts — original provider normalization over controlled replacement/detail responses.
export async function replacementFixture(page: Page) {
  await searchPlaybackFixture(page);
  await page.addInitScript(() => {
    const w = window as any, previous = w.fixtureOnlineRequest, bridge = w.Capacitor.nativePromise;
    Object.assign(w.fixtureHealth, { replacementProviders: ['netease'], dailyProviders: ['netease'] }); w.replacementCalls = [];
    const song = (id: number, blocked = false) => ({ id, name: (id === 900 ? '其他版本' : '歌单歌曲') + id,
      ar: [{ id: 1, name: '测试歌手' }], al: { id: 1, name: '专辑' }, dt: 180000,
      ...(blocked ? { privilege: { st: -200 }, noCopyrightRcmd: { typeDesc: '其他版本可播', ...(w.replacementLegacy ? { songId: 900 } : {}) } } : {}) });
    const reply = (body: unknown) => ({ status: 200, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
    w.fixtureOnlineRequest = async (payload: any) => {
      const url = new URL(payload.path, 'https://fixture.invalid');
      if (url.pathname === '/playlist/track/all') return reply({ code: 200, songs: [song(200, true), song(201), song(202, true)] });
      if (url.pathname === '/album') return reply({ code: 200, album: { id: 1, name: '专辑', size: 2 }, songs: [song(200, true), song(201)] });
      if (url.pathname === '/recommend/songs') return reply({ code: 200, data: { dailySongs: [song(200, true), song(201)] } });
      if (url.pathname === '/history/recommend/songs') return reply({ code: 200, data: { dates: [] } });
      if (!['/song/detail', '/song/copyright/rcmd'].includes(url.pathname)) return previous(payload);
      w.replacementCalls.push({ provider: payload.provider, path: url.pathname, id: url.searchParams.get('songid') ?? url.searchParams.get('ids') });
      if (w.replacementDelay) await new Promise<void>(resolve => { w.releaseReplacement = resolve; });
      const candidate = song(900);
      if (w.replacementLong) { candidate.name = '其他版本900' + '长曲名'.repeat(36); candidate.ar[0].name = '很长的歌手名称'.repeat(16); }
      if (url.pathname === '/song/detail') return reply({ code: 200, songs: [candidate], privileges: [{ id: 900, st: 0, pl: 320000 }] });
      return reply({ code: 200, data: w.replacementMissing ? {} : { rcmd: candidate, sp: { id: 900, st: 0, pl: 320000 },
        originSong: { noCopyrightRcmd: { typeDesc: '其他版本可播' } } } });
    };
    w.Capacitor.nativePromise = async (plugin: string, method: string, options: any) => {
      const result = await bridge(plugin, method, options);
      if (method === 'selectQueue' && w.replacementDelaySelectionReply) await new Promise<void>(resolve => { w.releaseSelectionReply = resolve; });
      return result;
    };
  });
}
