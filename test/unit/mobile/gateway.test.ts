import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import { createMobileApp } from '../../../deploy/mobile/gateway.mjs';

// test/unit/mobile/gateway.test.ts — fixtures prove routing/security contracts, not provider availability.
const token = 'x'.repeat(40);
const bases = { netease: 'http://netease-api:3000', qq: 'http://qq-api:3000', kugou: 'http://kugou-api:3000' };
let server: Server;
afterEach(async () => { if (server) await new Promise<void>(resolve => server.close(() => resolve())); });
async function fixture(fetchImpl: any = vi.fn(async () => new Response('{}')), providers = ['netease', 'qq', 'kugou']) {
  server = createServer(createMobileApp({ token, bases, fetchImpl, providers }));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  const post = (path: string, body: unknown, credential = token) => fetch('http://127.0.0.1:' + address.port + path, {
    method: 'POST', headers: { authorization: 'Bearer ' + credential, 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const health = () => fetch('http://127.0.0.1:' + address.port + '/mobile/health', { headers: { authorization: 'Bearer ' + token } });
  return { post, fetchImpl, health };
}
describe('mobile gateway', () => {
  it('routes authenticated, bounded recommendations without unrelated query controls', async () => {
    const { post, fetchImpl, health } = await fixture();
    expect((await (await health()).json()).recommendedCollectionProviders).toEqual(['netease']);
    const body = { provider: 'netease', path: '/personalized', query: { limit: 35, cookie: 'fixture' }, headers: { Authorization: 'Bearer secret' } };
    expect((await post('/mobile/request', body, 'bad')).status).toBe(401); expect(fetchImpl).not.toHaveBeenCalled();
    expect((await post('/mobile/request', body)).status).toBe(200);
    const [url, init] = fetchImpl.mock.calls[0]; expect(url.origin).toBe(bases.netease); expect(url.pathname).toBe('/personalized');
    expect(url.searchParams.get('limit')).toBe('35'); expect(init.headers.authorization).toBeUndefined(); expect(init.redirect).toBe('error');
    for (const limit of [undefined, 0, -1, 101, 1.5, '35,1', {}]) {
      expect((await post('/mobile/request', { ...body, query: { limit } })).status).toBe(400);
    }
    for (const key of ['offset', 'proxy', 'url', 'id']) {
      expect((await post('/mobile/request', { ...body, query: { limit: 35, [key]: 'x' } })).status).toBe(400);
    }
    expect((await post('/mobile/request', { ...body, provider: 'qq' })).status).toBe(404);
    expect((await post('/mobile/request', { ...body, method: 'POST', body: '{}' })).status).toBe(403);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it.each(['/album/sub', '/playlist/subscribe', '/album/detail/dynamic', '/playlist/detail/dynamic'])('allows only bounded authenticated subscription requests for %s', async path => {
    const { post, fetchImpl, health } = await fixture();
    expect((await (await health()).json()).subscriptionProviders).toEqual(['netease']);
    const write = !path.endsWith('/dynamic'), query = { id: 8, ...(write ? { t: 1 } : {}), cookie: 'fixture' };
    const body = { provider: 'netease', path, query, headers: { Authorization: 'Bearer secret' } };
    expect((await post('/mobile/request', body, 'bad')).status).toBe(401); expect(fetchImpl).not.toHaveBeenCalled();
    expect((await post('/mobile/request', body)).status).toBe(200);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url.origin).toBe(bases.netease); expect(url.pathname).toBe(path);
    expect(init.headers.authorization).toBeUndefined(); expect(init.redirect).toBe('error');
    if (write) {
      expect((await post('/mobile/request', { ...body, query: { ...query, t: 2 } })).status).toBe(200);
      for (const t of [undefined, 0, 3, 'true', '1.0', '1,2', {}]) {
        expect((await post('/mobile/request', { ...body, query: { ...query, t } })).status).toBe(400);
      }
    }
    const before = fetchImpl.mock.calls.length;
    for (const id of [undefined, 0, -1, '1.5', '1,2', {}, '1'.repeat(21)]) {
      expect((await post('/mobile/request', { ...body, query: { ...query, id } })).status).toBe(400);
    }
    for (const key of ['proxy', 'checkToken', 'url', 'limit']) {
      expect((await post('/mobile/request', { ...body, query: { ...query, [key]: 'x' } })).status).toBe(400);
    }
    expect((await post('/mobile/request', { ...body, provider: 'qq' })).status).toBe(404);
    expect((await post('/mobile/request', { ...body, method: 'POST', body: '{}' })).status).toBe(403);
    expect(fetchImpl.mock.calls.length).toBe(before);
  });
  it.each([['netease', '/album/sublist'], ['netease', '/user/cloud'], ['qq', '/user/albums']])('routes %s account library %s with bounded read-only paging', async (provider, path) => {
    const { post, fetchImpl } = await fixture();
    const body = { provider, path, query: { limit: 50, offset: 50 }, headers: { Authorization: 'Bearer secret' } };
    expect((await post('/mobile/request', body, 'bad')).status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await post('/mobile/request', body)).status).toBe(200);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url.origin).toBe(bases[provider as keyof typeof bases]); expect(url.pathname).toBe(path);
    expect(url.searchParams.get('offset')).toBe('50'); expect(init.headers.authorization).toBeUndefined(); expect(init.redirect).toBe('error');
    for (const query of [{ limit: 0 }, { limit: 1001 }, { offset: -1 }, { offset: 10001 }, { offset: 1.5 }, { proxy: 'https://evil.invalid' }]) {
      expect((await post('/mobile/request', { ...body, query })).status).toBe(400);
    }
    expect((await post('/mobile/request', { ...body, method: 'POST', body: '{}' })).status).toBe(403);
    expect((await post('/mobile/request', { ...body, provider: 'kugou' })).status).toBe(404);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('serves native FM with canonical songs and no gateway credential forwarding', async () => {
    const { post, fetchImpl } = await fixture(vi.fn(async () => new Response(JSON.stringify({ code: 200, data: [
      { id: 42, name: 'Radio', artists: [{ id: 1, name: 'Artist' }], album: { id: 2, name: 'Album' }, duration: 1000 },
    ] }))));
    const body = { provider: 'netease', selection: { mode: 'SCENE_RCMD', scene: 'FOCUS' }, session: { cookie: 'fixture-platform' } };
    expect((await post('/mobile/fm', body, 'bad')).status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
    const response = await post('/mobile/fm', body);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ selection: body.selection, fallback: false, songs: [{ sourceRef: { kind: 'online', providerId: 'netease', mediaId: '42' } }] });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url.origin).toBe(bases.netease); expect(url.pathname).toBe('/personal/fm/mode');
    expect(url.searchParams.get('submode')).toBe('FOCUS'); expect(url.searchParams.get('cookie')).toBe('fixture-platform');
    expect(init.headers.authorization).toBeUndefined(); expect(init.redirect).toBe('error');
  });
  it.each([301, 401, 403, 429])('stops native FM on provider code %s without fallback', async code => {
    const { post, fetchImpl } = await fixture(vi.fn(async () => new Response(JSON.stringify({ code }))));
    const response = await post('/mobile/fm', { provider: 'netease', selection: { mode: 'EXPLORE' }, session: { cookie: 'fixture' } });
    expect(response.status).toBe(code === 429 ? 429 : 401); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('rejects native FM without a session, unknown modes and disabled providers before requests', async () => {
    const { post, fetchImpl } = await fixture(undefined, ['netease']);
    const body = { provider: 'netease', selection: { mode: 'DEFAULT' }, session: { cookie: 'fixture' } };
    expect((await post('/mobile/fm', { ...body, session: {} })).status).toBe(401);
    expect((await post('/mobile/fm', { ...body, selection: { mode: 'INVENTED' } })).status).toBe(400);
    expect((await post('/mobile/fm', { ...body, provider: 'qq' })).status).toBe(404);
    expect((await post('/mobile/request', { provider: 'netease', path: '/personal/fm/mode', query: { mode: 'SCENE_RCMD' } })).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([
    ['/recommend/songs', { afresh: false }], ['/recommend/songs', { afresh: true }],
    ['/recommend/songs/dislike', { id: 42 }], ['/history/recommend/songs', {}],
    ['/history/recommend/songs/detail', { date: '2026-10-11' }],
  ])('routes authenticated daily recommendation requests %s only to NetEase', async (path, query) => {
    const { post, fetchImpl } = await fixture();
    const body = { provider: 'netease', path, query, headers: { Authorization: 'Bearer do-not-forward' } };
    expect((await post('/mobile/request', body, 'bad')).status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await post('/mobile/request', body)).status).toBe(200);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url.origin).toBe(bases.netease); expect(url.pathname).toBe(path);
    for (const [key, value] of Object.entries(query)) expect(url.searchParams.get(key)).toBe(String(value));
    expect(init.headers.authorization).toBeUndefined();
    expect((await post('/mobile/request', { ...body, provider: 'qq' })).status).toBe(404);
    expect((await post('/mobile/request', { ...body, method: 'POST', body: '{}' })).status).toBe(403);
  });
  it.each(['add', 'del'])('permits explicit authenticated playlist %s only on NetEase', async op => {
    const { post, fetchImpl } = await fixture();
    const body = { provider: 'netease', path: '/playlist/tracks', query: { op, pid: 8, tracks: '42,43' }, headers: { Authorization: 'Bearer do-not-forward' } };
    expect((await post('/mobile/request', body, 'bad')).status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await post('/mobile/request', body)).status).toBe(200);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url.origin).toBe(bases.netease); expect(url.searchParams.get('op')).toBe(op);
    expect(url.searchParams.get('pid')).toBe('8'); expect(url.searchParams.get('tracks')).toBe('42,43');
    expect(init.headers.authorization).toBeUndefined();
    expect((await post('/mobile/request', { ...body, provider: 'qq' })).status).toBe(404);
    expect((await post('/mobile/request', { ...body, method: 'POST', body: '{}' })).status).toBe(403);
    expect((await post('/mobile/request', { ...body, query: { ...body.query, tracks: Array(101).fill(42).join(',') } })).status).toBe(400);
  });
  it.each([
    ['netease', '/album', { id: 7 }], ['netease', '/artist/detail', { id: 9 }],
    ['netease', '/artist/songs', { id: 9, limit: 10, offset: 0 }], ['netease', '/artist/album', { id: 9, limit: 50, offset: 50 }],
    ['qq', '/getAlbumInfo', { albummid: 'albumMid' }], ['qq', '/getSingerHotsong', { singermid: 'singerMid', limit: 10, page: 1 }],
    ['qq', '/getSingerAlbum', { singermid: 'singerMid', limit: 50, page: 50 }],
  ])('routes authenticated %s catalog %s to its fixed backend', async (provider, path, query) => {
    const { post, fetchImpl } = await fixture();
    const body = { provider, path, query, headers: { Authorization: 'Bearer do-not-forward' } };
    expect((await post('/mobile/request', body, 'bad')).status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await post('/mobile/request', body)).status).toBe(200);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url.origin).toBe(bases[provider as keyof typeof bases]); expect(url.pathname).toBe(path);
    for (const [key, value] of Object.entries(query)) expect(url.searchParams.get(key)).toBe(String(value));
    expect(init.headers.authorization).toBeUndefined();
    expect((await post('/mobile/request', { ...body, method: 'POST', body: '{}' })).status).toBe(403);
  });
  it('advertises no like writes for a QQ-only gateway', async () => {
    const { health } = await fixture(undefined, ['qq']);
    expect(await (await health()).json()).toEqual({ protocol: 1, providers: ['qq'], songLikeProviders: [], catalogProviders: ['qq'], playlistEditProviders: [], subscriptionProviders: [], dailyProviders: [], personalFmProviders: [], recommendedCollectionProviders: [], userAlbumProviders: ['qq'], cloudProviders: [] });
  });
  it.each([true, false])('forwards only the authorized NetEase like route with explicit like=%s', async liked => {
    const { post, fetchImpl } = await fixture(vi.fn(async () => new Response('{"code":200}')));
    const body = { provider: 'netease', path: '/like', query: { id: 42, like: liked, cookie: 'fixture-platform' },
      headers: { Authorization: 'Bearer do-not-forward' } };
    expect((await post('/mobile/request', body, 'bad')).status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled(); expect((await post('/mobile/request', body)).status).toBe(200);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url.origin).toBe(bases.netease); expect(url.pathname).toBe('/like');
    expect(url.searchParams.get('like')).toBe(String(liked)); expect(init.headers.authorization).toBeUndefined();
    expect((await post('/mobile/request', { ...body, method: 'POST', body: '{}' })).status).toBe(403);
    expect((await post('/mobile/request', { ...body, provider: 'qq' })).status).toBe(404);
  });
  it('allows authenticated read-only cloud lyrics through the fixed NetEase backend', async () => {
    const { post, fetchImpl } = await fixture(vi.fn(async () => new Response('{"code":200,"lyric":"fixture"}')));
    const response = await post('/mobile/request', { provider: 'netease', path: '/cloud/lyric/get', query: { uid: 9, sid: 42, cookie: 'fixture-session' } });
    expect(response.status).toBe(200);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url.origin).toBe('http://netease-api:3000');
    expect(url.pathname).toBe('/cloud/lyric/get');
    expect(url.searchParams.get('uid')).toBe('9');
    expect(init.headers.authorization).toBeUndefined();
    expect((await post('/mobile/request', { provider: 'netease', path: '/cloud/lyric/get', method: 'POST', body: '{}' })).status).toBe(403);
  });
  it('advertises only enabled services and rejects disabled API, lyrics and playback', async () => {
    const { post, fetchImpl, health } = await fixture(undefined, ['netease', 'qq']);
    expect(await (await health()).json()).toEqual({ protocol: 1, providers: ['netease', 'qq'], songLikeProviders: ['netease'], catalogProviders: ['netease', 'qq'], playlistEditProviders: ['netease'], subscriptionProviders: ['netease'], dailyProviders: ['netease'], personalFmProviders: ['netease'], recommendedCollectionProviders: ['netease'], userAlbumProviders: ['netease', 'qq'], cloudProviders: ['netease'] });
    for (const body of [{ provider: 'kugou', path: '/login/qr/key' },
      { provider: 'lyrics', path: 'https://lyrics.kugou.com/v1/search' }]) {
      expect((await post('/mobile/request', body)).status).toBe(404);
    }
    expect((await post('/mobile/resolve', { song: { sourceRef: { kind: 'online', providerId: 'kugou', mediaId: 'ABC' } } })).status).toBe(404);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('requires authentication before touching upstream', async () => {
    const { post, fetchImpl } = await fixture();
    expect((await post('/mobile/request', {}, 'bad')).status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([
    { provider: 'netease', path: '/recommend/songs' },
    { provider: 'netease', path: '/recommend/songs?afresh=1' },
    { provider: 'netease', path: '/recommend/songs/dislike?id=-1' },
    { provider: 'netease', path: '/history/recommend/songs/detail?date=2026-02-30' },
    { provider: 'netease', path: '/history/recommend/songs/detail?date=2026-10-11&proxy=http://localhost' },
    { provider: 'netease', path: '//169.254.169.254/latest' },
    { provider: 'netease', path: '/song/url/v1?proxy=http://127.0.0.1' },
    { provider: 'netease', path: '/song/url/v1', method: 'POST', body: '{"proxy":"http://localhost"}' },
    { provider: 'netease', path: '/playlist/tracks' },
    { provider: 'netease', path: '/playlist/tracks?op=replace&pid=8&tracks=42' },
    { provider: 'netease', path: '/playlist/tracks?op=add&pid=8&tracks=42,abc' },
    { provider: 'netease', path: '/playlist/tracks?op=del&pid=-1&tracks=42' },
    { provider: 'netease', path: '/artist/songs?id=9&limit=100000' },
    { provider: 'netease', path: '/album?id=-1' },
    { provider: 'netease', path: '/artist/album?id=9&offset=-50' },
    { provider: 'qq', path: '/getAlbumInfo/albumMid' },
    { provider: 'qq', path: '/getSingerHotsong?singermid=abc&limit=0' },
    { provider: 'qq', path: '/getSingerAlbum?singermid=abc&page=10001' },
    { provider: 'qq', path: '/getAlbumInfo?albummid=abc&proxy=http://127.0.0.1' },
    { provider: 'netease', path: '/like?id=42' },
    { provider: 'netease', path: '/like?id=42&like=undefined' },
    { provider: 'netease', path: '/like?id=-1&like=true' },
    { provider: 'netease', path: '/like?id=42&like=true&proxy=http://127.0.0.1' },
    { provider: 'lyrics', path: 'https://u.y.qq.com.evil.test/cgi-bin/musicu.fcg' },
    { provider: 'lyrics', path: 'https://u.y.qq.com/cgi-bin/musicu.fcg', method: 'POST', body: '{"request":{"method":"Delete"}}' },
    { provider: 'kugou', path: '/youth/day/vip' },
  ])('rejects SSRF and out-of-scope writes: %j', async body => {
    const { post, fetchImpl } = await fixture();
    expect((await post('/mobile/request', body)).status).toBeGreaterThanOrEqual(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('does not forward gateway Authorization and refuses redirects', async () => {
    const { post, fetchImpl } = await fixture();
    const response = await post('/mobile/request', { provider: 'qq', path: '/login/status',
      headers: { Authorization: 'Bearer secret', 'X-QQ-Session': 'platform-token' } });
    expect(response.status).toBe(200);
    const [, init] = fetchImpl.mock.calls[0];
    expect(init.headers.authorization).toBeUndefined();
    expect(init.headers['x-qq-session']).toBe('platform-token');
    expect(init.redirect).toBe('error');
  });
  it.each([
    ['netease', '42', { data: [{ url: 'http://audio.example.com/song.mp3' }] }],
    ['qq', 'abcMid', { data: { playUrl: { abcMid: { url: 'https://audio.example.com/song.mp3' } } } }],
    ['kugou', 'ABC123', { data: { play_url: 'https://audio.example.com/song.mp3' } }],
  ])('resolves %s without browser state', async (provider, mediaId, response) => {
    const upstream: any = vi.fn(async () => new Response(JSON.stringify(response)));
    const { post } = await fixture(upstream);
    const result = await post('/mobile/resolve', { song: { sourceRef: { kind: 'online', providerId: provider, mediaId } },
      session: { cookie: 'platform-session' } });
    expect(result.status).toBe(200);
    expect((await result.json()).url).toBe('https://audio.example.com/song.mp3');
    expect(String(upstream.mock.calls[0][0])).toContain('cookie=platform-session');
  });
  it('returns a structured auth error without disclosing upstream body', async () => {
    const { post } = await fixture(vi.fn(async () => new Response('{"code":301,"cookie":"secret"}')));
    const result = await post('/mobile/resolve', { song: { sourceRef: { kind: 'online', providerId: 'netease', mediaId: '42' } } });
    expect(result.status).toBe(401);
    expect(await result.json()).toEqual({ code: 'auth-required' });
  });
  it('rejects invalid identities and does not fall back to numeric IDs', async () => {
    const { post, fetchImpl } = await fixture();
    expect((await post('/mobile/resolve', { song: { id: 42 } })).status).toBe(400);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
