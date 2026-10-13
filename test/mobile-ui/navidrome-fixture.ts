import type { Page } from '@playwright/test';

// navidrome-fixture.ts — explicit native bridge fixture; never contacts a music server or saves credentials.
export async function navidromeFixture(page: Page) {
  await page.addInitScript(() => {
    const win = window as any;
    win.fixtureNoServer = true;
    const config = { enabled: false, baseURL: '', username: '', hasPassword: false, scope: 'initial', revision: 0 };
    win.fixtureNavidromeConfig = config; win.fixtureNavidromeRequests = []; win.fixtureNavidromeEdits = [];
    const song = (id: string) => ({ id, title: '歌曲 ' + id, album: '专辑甲', artist: '艺术家甲', duration: 120, albumId: 'album', artistId: 'artist' });
    const album = { id: 'album', name: '专辑甲', artist: '艺术家甲', coverArt: 'cover:album', songCount: 2, song: [song('一'), song('二')] };
    const artist = { id: 'artist', name: '艺术家甲', coverArt: 'cover:artist', albumCount: 1, album: [album] };
    const playlist = { id: 'playlist', name: '歌单甲', owner: 'user', songCount: 1, entry: [song('歌单')], coverArt: 'cover:playlist' };
    win.fixtureNavidromeBridge = async (method: string, options: any) => {
      if (method === 'getNavidromeSettings') return structuredClone(config);
      if (method === 'setNavidromeSettings') {
        if (win.fixtureNavidromeSaveFailure) throw Error('secure-storage');
        if (options.revision !== config.revision || options.scope !== config.scope) throw Error('navidrome-settings-changed');
        const { password, ...edit } = options.settings;
        win.fixtureNavidromeEdits.push({ ...edit, passwordSupplied: password !== undefined });
        if (password !== undefined) config.hasPassword = !!password;
        Object.assign(config, edit, { scope: config.scope + '-next', revision: config.revision + 1 });
        return structuredClone(config);
      }
      if (method === 'cancelNavidromeRequest') { (win.fixtureNavidromeCancelled ||= []).push(options.id); return {}; }
      if (method === 'navidromeArtwork') return { url: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' };
      win.fixtureNavidromeRequests.push(options);
      if (win.fixtureNavidromeError) throw Error(win.fixtureNavidromeError);
      if (options.operation === 'search3' && win.fixtureNavidromeDelay) await new Promise(resolve => { win.fixtureNavidromeRelease = resolve; });
      let payload: Record<string, unknown>;
      switch (options.operation) {
        case 'ping': payload = {}; break;
        case 'getAlbumList2': payload = { albumList2: { album: [album] } }; break;
        case 'getAlbum': payload = { album }; break;
        case 'getArtists': payload = { artists: { index: [{ name: 'A', artist: [artist] }] } }; break;
        case 'getArtist': payload = { artist }; break;
        case 'getPlaylists': payload = { playlists: { playlist: [playlist] } }; break;
        case 'getPlaylist': payload = { playlist }; break;
        case 'getRandomSongs': payload = { randomSongs: { song: [song('随机')] } }; break;
        case 'getStarred2': payload = { starred2: { song: [song('收藏')] } }; break;
        case 'search3': payload = { searchResult3: { song: [song(options.parameters.query)], album: [album], artist: [artist] } }; break;
        default: throw Error('unexpected-operation');
      }
      return { scope: options.scope, revision: options.revision, response: { 'subsonic-response': { status: 'ok', version: '1.16.1', ...payload } } };
    };
  });
}
