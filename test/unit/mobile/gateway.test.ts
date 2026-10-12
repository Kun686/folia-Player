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
  it('advertises no like writes for a QQ-only gateway', async () => {
    const { health } = await fixture(undefined, ['qq']);
    expect(await (await health()).json()).toEqual({ protocol: 1, providers: ['qq'], songLikeProviders: [] });
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
    expect(await (await health()).json()).toEqual({ protocol: 1, providers: ['netease', 'qq'], songLikeProviders: ['netease'] });
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
    { provider: 'netease', path: '//169.254.169.254/latest' },
    { provider: 'netease', path: '/song/url/v1?proxy=http://127.0.0.1' },
    { provider: 'netease', path: '/song/url/v1', method: 'POST', body: '{"proxy":"http://localhost"}' },
    { provider: 'netease', path: '/playlist/tracks' },
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
