import type { Page } from '@playwright/test';

// online-catalog-fixture.ts — controlled upstream shapes; the actual transport, Omni and resources run unchanged.
export async function catalogFixture(page: Page) {
  await page.addInitScript(() => {
    const win = window as any;
    win.fixtureHealth = { protocol: 1, providers: ['netease', 'qq'], catalogProviders: ['netease', 'qq'] };
    win.catalogRequests = [];
    win.fixtureLyricTools = true;
    win.catalogAlbumFailure = false;
    const song = { id: 81, name: '目录歌曲', ar: [{ id: 1, name: '测试歌手' }], al: { id: 1, name: '专辑' }, dt: 180000 };
    const qq = { id: 81, mid: 'catalogSong', title: 'QQ目录歌曲', interval: 180,
      album: { id: 91, mid: 'catalogAlbum', name: 'QQ专辑' }, singer: [{ id: 93, mid: 'catalogArtist', name: 'QQ歌手' }] };
    win.fixtureOnlineRequest = async (payload: any) => {
      const url = new URL(payload.path, 'https://fixture.invalid');
      if (!['/album', '/artist/detail', '/artist/songs', '/artist/album', '/getAlbumInfo', '/getSingerHotsong', '/getSingerAlbum', '/getSongInfo/catalogSong'].includes(url.pathname)) return;
      win.catalogRequests.push({ provider: payload.provider, path: url.pathname, query: Object.fromEntries(url.searchParams) });
      let body: any;
      if (url.pathname === '/album') {
        const id = Number(url.searchParams.get('id'));
        if (win.catalogDelay) await new Promise<void>(resolve => { (win.catalogPending ??= []).push(resolve); });
        body = win.catalogFailure ? { code: 301 } : { code: 200, album: { id, name: '专辑', size: 1 }, songs: win.catalogEmpty ? [] : [{ ...song, id: id + 80 }] };
      }
      if (url.pathname === '/artist/detail') body = { code: 200, data: { artist: { id: 1, name: '测试歌手', musicSize: 1, albumSize: 51 } } };
      if (url.pathname === '/artist/songs') body = { code: 200, songs: [song], more: false };
      if (url.pathname === '/artist/album') {
        const offset = Number(url.searchParams.get('offset'));
        body = win.catalogAlbumFailure && offset > 0 ? { code: 502 } : { code: 200,
          hotAlbums: Array.from({ length: offset ? 1 : 50 }, (_, i) => ({ id: offset + i + 1, name: '作品专辑' + (offset + i + 1) })), more: offset === 0 };
      }
      if (url.pathname === '/getSongInfo/catalogSong') {
        if (win.catalogResolveDelay) await new Promise<void>(resolve => { win.releaseCatalogResolve = resolve; });
        body = { response: { songinfo: { data: { track_info: qq } } } };
      }
      if (url.pathname === '/getAlbumInfo') body = { response: { code: 0, data: { mid: 'catalogAlbum', name: 'QQ专辑', list: [qq], total_song_num: 1 } } };
      if (url.pathname === '/getSingerHotsong') body = { response: { code: 0, singer: { code: 0, data: {
        songlist: [qq], singer_info: { mid: 'catalogArtist', name: 'QQ歌手' }, total_song: 1, total_album: 1 } } } };
      if (url.pathname === '/getSingerAlbum') body = { response: { code: 0, singer: { code: 0, data: {
        albumList: [{ albumMID: 'catalogAlbum', albumName: 'QQ专辑' }], total: 1 } } } };
      return { status: 200, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } };
    };
  });
}

export async function queueQqSong(page: Page) {
  await page.evaluate(() => {
    const win = window as any;
    const song = { id: 81, name: 'QQ目录歌曲', album: { id: 91, name: 'QQ专辑' }, artists: [{ id: 93, name: 'QQ歌手' }], durationMs: 180000,
      sourceRef: { kind: 'online', providerId: 'qq', mediaId: 'catalogSong' } };
    win.fixtureEmitPlayback({ queue: [song], index: 0, currentSong: song });
  });
}
