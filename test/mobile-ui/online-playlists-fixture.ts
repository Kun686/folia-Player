import type { Page } from '@playwright/test';

// online-playlists-fixture.ts — pinned API envelopes and mutable provider data, never a live account.
export async function playlistFixture(page: Page) {
  await page.addInitScript(() => {
    const win = window as any;
    win.fixtureHealth = { protocol: 1, providers: ['netease', 'qq'], playlistEditProviders: ['netease'] };
    const song = { id: 42, name: '测试歌曲', ar: [{ id: 1, name: '测试歌手' }], al: { id: 1, name: '专辑' }, dt: 180000 };
    win.editTracks = { 1: [{ ...song, id: 81, name: '原有歌曲' }] };
    win.playlistWrites = [];
    win.fixtureOnlineRequest = async (payload: any) => {
      const url = new URL(payload.path, 'https://fixture.invalid');
      let body: any;
      if (url.pathname === '/user/playlist') {
        const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 100);
        body = { code: 200, playlist: Array.from({ length: 101 }, (_, i) => ({ id: i + 1, name: '我的歌单' + (i + 1),
          trackCount: (win.editTracks[i + 1] ?? []).length, creator: { userId: i === 1 ? 10 : 9, nickname: '作者' } })).slice(offset, offset + limit), more: offset + limit < 101 };
      } else if (url.pathname === '/playlist/track/all') {
        const id = url.searchParams.get('id'), offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 50);
        if (offset > 0 && win.delayPlaylistPage) await new Promise<void>(resolve => { win.releasePlaylistPage = resolve; });
        body = { code: 200, songs: (win.editTracks[id!] ?? []).slice(offset, offset + limit) };
      } else if (url.pathname === '/playlist/tracks') {
        const params = Object.fromEntries(url.searchParams); win.playlistWrites.push(params);
        if (win.delayPlaylistWrite) await new Promise<void>(resolve => { win.releasePlaylistWrite = resolve; });
        if (!win.rejectPlaylistWrite) {
          const tracks = win.editTracks[params.pid] ?? [];
          win.editTracks[params.pid] = params.op === 'del' ? tracks.filter((item: any) => String(item.id) !== params.tracks)
            : tracks.some((item: any) => String(item.id) === params.tracks) ? tracks : [...tracks, song];
        }
        body = { status: 200, body: { code: win.rejectPlaylistWrite ? 502 : 200 } };
      } else return;
      return { status: 200, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } };
    };
  });
}
