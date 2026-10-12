import type { Page } from '@playwright/test';
import { catalogFixture } from './online-catalog-fixture';

// account-library-fixture.ts — pinned transport shapes through the real Omni and collection resources.
export async function accountLibraryFixture(page: Page) {
  await catalogFixture(page);
  await page.addInitScript(() => {
    const w = window as any, previous = w.fixtureOnlineRequest;
    w.fixtureSessions = { qq: { cookie: 'qqmusic_session=fixture-account-library' }, netease: { cookie: 'fixture-account-library' } };
    Object.assign(w.fixtureHealth, { userAlbumProviders: ['netease', 'qq'], cloudProviders: ['netease'] });
    w.accountLibraryCalls = [];
    w.fixtureOnlineRequest = async (payload: any) => {
      const url = new URL(payload.path, 'https://fixture.invalid'), path = url.pathname;
      const reply = (body: unknown) => ({ status: 200, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
      if (path === '/logout') { w.accountSignedOut = true; return reply({ code: 200 }); }
      if (path === '/login/status') return reply(payload.provider === 'qq'
        ? { code: 0, data: { profile: w.accountSignedOut ? null : { uin: '77', nick: 'QQ fixture' } } }
        : { code: 200, data: { code: 200, profile: w.accountSignedOut ? null : { userId: 9, nickname: '测试用户' } } });
      if (path === '/user/account') return reply({ code: 200, profile: w.accountSignedOut ? null : { userId: 9, nickname: '测试用户' } });
      if (path === '/user/playlist') return reply(payload.provider === 'qq' ? { code: 200, playlist: [], total: 0, more: false } : { code: 200, playlist: [], more: false });
      if (!['/album/sublist', '/user/albums', '/user/cloud'].includes(path)) return previous(payload);
      const offset = Number(url.searchParams.get('offset')), limit = Number(url.searchParams.get('limit'));
      w.accountLibraryCalls.push({ provider: payload.provider, path, offset, limit });
      if (w.accountLibraryDelay && payload.provider === 'netease') await new Promise<void>(resolve => { w.accountLibraryRelease = resolve; });
      if (w.accountLibraryFail || (w.accountCloudPageFail && offset > 0)) return reply({ code: 301 });
      if (w.accountLibraryMalformed) return reply({ code: 200 });
      const length = w.accountLibraryEmpty ? 0 : Math.max(0, Math.min(limit, 51 - offset));
      if (path === '/album/sublist') return reply({ code: 200, data: Array.from({ length }, (_, i) => ({ id: offset + i + 1, name: '收藏专辑' + (offset + i + 1) })), hasMore: !!length && offset + length < 51 });
      if (path === '/user/albums') return reply({ code: 200, albums: w.accountLibraryEmpty ? [] : [{ albumid: 91, albummid: 'catalogAlbum', albumname: 'QQ专辑', songnum: 1 }], total: w.accountLibraryEmpty ? 0 : 1, more: false });
      return reply({ code: 200, count: w.accountLibraryEmpty ? 0 : 51, hasMore: !!length && offset + length < 51,
        data: Array.from({ length }, (_, i) => ({ songId: 800 + offset + i, songName: '云盘歌曲' + (offset + i + 1),
          simpleSong: { id: 800 + offset + i, name: '云盘歌曲' + (offset + i + 1), ar: [{ id: 1, name: '歌手' }], al: { id: 1, name: '专辑' }, dt: 180000 } })) });
    };
  });
}
