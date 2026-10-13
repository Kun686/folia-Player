import type { Page } from '@playwright/test';

// navidrome-fixture.ts — explicit native bridge fixture; never contacts a music server or saves credentials.
export async function navidromeFixture(page: Page) {
  await page.addInitScript(() => {
    const win = window as any;
    win.fixtureNoServer = true;
    const config = { enabled: false, baseURL: '', username: '', hasPassword: false, scope: 'initial', revision: 0 };
    win.fixtureNavidromeConfig = config; win.fixtureNavidromeRequests = []; win.fixtureNavidromeEdits = [];
    const starred = new Set(['收藏']); win.fixtureNavidromeMutations = [];
    const song = (id: string) => ({ id, title: '歌曲 ' + id, album: '专辑甲', artist: '艺术家甲', duration: 120, albumId: 'album', artistId: 'artist', starred: starred.has(id) ? 'timestamp' : undefined });
    const album = { id: 'album', name: '专辑甲', artist: '艺术家甲', coverArt: 'cover:album', songCount: 2, song: [song('一'), song('二')] };
    const artist = { id: 'artist', name: '艺术家甲', coverArt: 'cover:artist', albumCount: 1, album: [album] };
    const playlist = { id: 'playlist', name: '歌单甲', owner: 'user', songCount: 1, entry: [song('歌单')], coverArt: 'cover:playlist' };
    const playlists = [playlist]; win.fixtureNavidromePlaylists = playlists;
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
      if (method === 'navidromeMutation') {
        win.fixtureNavidromeMutations.push(options); const p = options.parameters;
        let payload = {};
        if (options.operation === 'star') starred.add(p.id);
        else if (options.operation === 'unstar') starred.delete(p.id);
        else if (options.operation === 'createPlaylist') {
          const created = { ...playlist, id: 'created-' + playlists.length, name: p.name, songCount: p.songId?.length ?? 0, entry: (p.songId ?? []).map(song) };
          playlists.push(created); payload = { playlist: created };
        } else {
          const id = p.playlistId ?? p.id, index = playlists.findIndex(list => list.id === id), list = playlists[index];
          if (!list) throw Error('navidrome-not-found');
          if (options.operation === 'deletePlaylist') playlists.splice(index, 1);
          else {
            if (p.name) list.name = p.name;
            list.entry = list.entry.filter((_, i) => !(p.songIndexToRemove ?? []).includes(String(i))).concat((p.songIdToAdd ?? []).map(song));
            list.songCount = list.entry.length;
          }
        }
        if (win.fixtureNavidromeWriteDelay) await new Promise(resolve => { win.fixtureNavidromeWriteRelease = resolve; });
        if (win.fixtureNavidromeWriteFailure) throw Error('navidrome-network');
        return { scope: options.scope, revision: options.revision, response: { 'subsonic-response': { status: 'ok', version: '1.16.1', ...payload } } };
      }
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
        case 'getPlaylists': payload = { playlists: { playlist: playlists } }; break;
        case 'getPlaylist': {
          const list = playlists.find(list => list.id === options.parameters.id); if (!list) throw Error('navidrome-not-found');
          payload = { playlist: list }; break;
        }
        case 'getSong': payload = { song: song(options.parameters.id) }; break;
        case 'getRandomSongs': payload = { randomSongs: { song: [song('随机')] } }; break;
        case 'getStarred2': payload = { starred2: { song: Array.from(starred).map(song) } }; break;
        case 'search3': payload = { searchResult3: { song: [song(options.parameters.query)], album: [album], artist: [artist] } }; break;
        default: throw Error('unexpected-operation');
      }
      return structuredClone({ scope: options.scope, revision: options.revision, response: { 'subsonic-response': { status: 'ok', version: '1.16.1', ...payload } } });
    };
  });
}
