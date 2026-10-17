import { describe, expect, it, vi } from 'vitest';
import { createRequire } from 'node:module';
import Module from 'node:module';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { dirname, join } from 'node:path';
import { patchQqSearch } from '../../../deploy/mobile/patch-qq-search.mjs';
import { authorizeTarget } from '../../../deploy/mobile/policy.mjs';
import { normalizeQQLyricSearch } from '../../../src/utils/lyrics/providers/qqLyricSearch';

// qqAuthenticatedSearch.test.ts — scoped route, actual pinned-library patch, cancellation and credential failure semantics.
const require = createRequire(import.meta.url);
const { createQqSearchRoute } = require('../../../deploy/mobile/qqSearchRoute.cjs');
const file = join(dirname(require.resolve('@yakult-green-tea/qq-music-api/package.json')), 'dist/src/services/auth/qrLogin.js');
const patched = new Module(file) as any;
patched.filename = file;
patched.paths = (Module as any)._nodeModulePaths(file.slice(0, file.lastIndexOf('/')));
patched._compile(patchQqSearch(readFileSync(file, 'utf8')), file);
const { createQrLoginService, QqProtocolError } = patched.exports;
const song = { id: 5211338, mid: '000BO3xy4fd8BJ', title: '我怀念的', interval: 289,
  singer: [{ id: 109, name: '孙燕姿' }], album: { id: 15902, mid: '000P3l050Olt27', name: '逆光' } };
const context = (query: Record<string, unknown> = { key: '我怀念的', page: '1', limit: '5' }) => ({
  query, req: new EventEmitter(), res: new EventEmitter(), set: vi.fn(), status: 0, body: null as any,
});
function route(reply: unknown = { code: 0, meta: { ret: 0 }, body: { item_song: [song] } }, token: string | undefined = 'opaque-test-session') {
  const mobileSearchSongs = vi.fn(async () => { if (reply instanceof Error) throw reply; return reply; });
  return { mobileSearchSongs, handler: createQqSearchRoute({ service: { mobileSearchSongs }, getAuthToken: () => token, ProtocolError: QqProtocolError }) };
}
describe('authenticated mobile QQ search route', () => {
  it('passes an opaque session to the library and preserves existing song fields', async () => {
    const { handler, mobileSearchSongs } = route(), ctx = context(); await handler(ctx);
    expect(ctx.status).toBe(200); expect(ctx.body.data.body.item_song).toEqual([song]);
    expect(mobileSearchSongs).toHaveBeenCalledExactlyOnceWith('opaque-test-session', expect.objectContaining({
      query: '我怀念的', search_type: 0, page_num: 1, num_per_page: 5,
    }), expect.any(AbortSignal));
    expect(ctx.req.listenerCount('aborted')).toBe(0); expect(ctx.res.listenerCount('close')).toBe(0);
  });
  it.each([{ key: '' }, { key: 'x'.repeat(61) }, { key: 'x', page: 0 }, { key: 'x', page: '1.2' },
    { key: 'x', limit: 101 }, { key: 'x', page: ['1'] }, { key: 'x', limit: ['5'] },
    { key: 'x', cookie: 'private' }, { key: 'x', module: 'arbitrary-rpc' }])('rejects invalid query %j', async query => {
    const { handler, mobileSearchSongs } = route(), ctx = context(query); await handler(ctx);
    expect(ctx.status).toBe(400); expect(mobileSearchSongs).not.toHaveBeenCalled();
    expect(() => authorizeTarget({ provider: 'qq', path: '/mobile/search', query }, { qq: 'http://qq-api:3000' })).toThrow();
  });
  it('rejects a missing session before requesting QQ', async () => {
    const { handler, mobileSearchSongs } = route(undefined, ''), ctx = context(); await handler(ctx);
    expect(ctx.status).toBe(401); expect(mobileSearchSongs).not.toHaveBeenCalled();
  });
  it('maps an expired backend session to 401', async () => {
    const { handler } = route(null), ctx = context(); await handler(ctx); expect(ctx.status).toBe(401);
  });
  it('preserves an explicit empty search page', async () => {
    const { handler } = route({ code: 0, meta: { ret: 0, sum: 0 }, body: { item_song: [] } }), ctx = context(); await handler(ctx);
    expect(ctx.status).toBe(200); expect(ctx.body.data.body.item_song).toEqual([]);
  });
  it.each([{ songs: [] }, { songs: [song] }])('preserves numeric upstream page evidence without changing song parsing: %j', async ({ songs }) => {
    const reply = { code: 0, meta: { ret: 0, sum: 994, curpage: 1, nextpage: 2 }, body: { item_song: songs } };
    const { handler, mobileSearchSongs } = route(reply), ctx = context(); await handler(ctx);
    expect(ctx.status).toBe(200);
    expect(ctx.body.data).toEqual(reply);
    expect(normalizeQQLyricSearch(ctx.body.data)).toEqual(normalizeQQLyricSearch(reply));
    // A positive total alone is not proof of an upstream failure; retain evidence without retrying.
    expect(mobileSearchSongs).toHaveBeenCalledOnce();
  });
  it('does not leak unapproved metadata or coerce text into numeric evidence', async () => {
    const { handler } = route({ code: 0, meta: {
      ret: 0, sum: 'private-token', curpage: Infinity, nextpage: 1.5,
      feedbackURL: 'https://example.invalid/?cookie=private-token', cookie: 'private-token',
    }, feedbackURL: 'private-token', body: { item_song: [] } });
    const ctx = context(); await handler(ctx);
    expect(ctx.status).toBe(200); expect(ctx.body.data).toEqual({ code: 0, meta: { ret: 0 }, body: { item_song: [] } });
    expect(JSON.stringify(ctx.body)).not.toContain('private-token');
  });
  it('keeps zero counts and signed end markers exactly as returned', async () => {
    const { handler } = route({ code: 0, meta: { ret: 0, sum: 0, curpage: 1, nextpage: -1 }, body: { item_song: [] } });
    const ctx = context(); await handler(ctx);
    expect(ctx.body.data.meta).toEqual({ ret: 0, sum: 0, curpage: 1, nextpage: -1 });
  });
  it.each([
    { code: 2001, meta: { ret: 0 } },
    { code: 0, meta: { ret: 2001 } },
    { code: 1000, meta: { ret: 0 } },
    { code: 0, meta: { ret: 1000 } },
    { code: 0 }, { meta: { ret: 0 } }, {},
    { code: null, meta: { ret: 0 } }, { code: 0, meta: { ret: null } },
  ])('rejects failed or missing nested status without logging out %j', async status => {
    const { handler, mobileSearchSongs } = route({ ...status, body: { item_song: [] } }), ctx = context();
    await handler(ctx);
    expect(ctx.status).toBe(502); expect(ctx.body).toEqual({ code: 502, errorKey: 'unavailable' });
    expect(mobileSearchSongs).toHaveBeenCalledOnce();
    expect(ctx.req.listenerCount('aborted')).toBe(0); expect(ctx.res.listenerCount('close')).toBe(0);
  });
  it('rejects malformed results instead of returning an empty success', async () => {
    const { handler } = route({ code: 0, meta: { ret: 0 } }), ctx = context(); await handler(ctx);
    expect(ctx.status).toBe(502); expect(ctx.body.errorKey).toBe('invalid-response');
  });
  it.each([[2001, 0, 502], [1000, 0, 401], [104400, 0, 401], [104401, 0, 401], [1000, 2001, 502]])(
    'classifies inner %i / global %i as HTTP %i', async (inner, global, status) => {
      const { handler } = route(new QqProtocolError('mobile-search-songs', inner, global, 200)), ctx = context();
      await handler(ctx); expect(ctx.status).toBe(status);
    });
  it('does not expose an exception containing credentials', async () => {
    const { handler } = route(Object.assign(new Error('Cookie=secret'), { config: { headers: { Cookie: 'secret' } } })), ctx = context();
    await handler(ctx); expect(ctx.status).toBe(502); expect(JSON.stringify(ctx.body)).not.toContain('secret');
  });
  it('passes disconnection to the library and releases listeners', async () => {
    const mobileSearchSongs = vi.fn((_token, _param, signal: AbortSignal) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
    }));
    const handler = createQqSearchRoute({ service: { mobileSearchSongs }, getAuthToken: () => 'opaque', ProtocolError: QqProtocolError });
    const ctx = context(), pending = handler(ctx); ctx.res.emit('close'); await pending;
    expect(mobileSearchSongs.mock.calls[0][2].aborted).toBe(true); expect(ctx.res.listenerCount('close')).toBe(0);
  });
  it('bounds concurrency and releases every slot after a failed search', async () => {
    const release: (() => void)[] = [];
    const mobileSearchSongs = vi.fn(() => new Promise((_resolve, reject) => release.push(() => reject(new Error('failed')))));
    const handler = createQqSearchRoute({ service: { mobileSearchSongs }, getAuthToken: () => 'opaque', ProtocolError: QqProtocolError });
    const pending = Array.from({ length: 12 }, () => handler(context()));
    const busy = context(); await handler(busy); expect(busy.status).toBe(429);
    expect(mobileSearchSongs).toHaveBeenCalledTimes(12);
    release.forEach(done => done()); await Promise.all(pending);
    const next = context(), task = handler(next); expect(mobileSearchSongs).toHaveBeenCalledTimes(13);
    release.at(-1)!(); await task; expect(next.status).toBe(502);
  });
});
describe('pinned QQ library extension', () => {
  it('reuses the installed Android comm, credential cookies and fixed Lite RPC', async () => {
    const auth = { credential: { musicid: 123, musickey: 'unit-only-key', loginType: 2 }, device: { osRelease: '13' } };
    const post = vi.fn(async () => ({ status: 200, data: { code: 0, req_0: { code: 0, data: { body: { item_song: [song] } } } } }));
    const createSessionHttp = vi.fn(() => ({ post }));
    const sharedPost = vi.fn();
    const resolve = vi.fn(async () => auth), service = createQrLoginService({ http: { post: sharedPost }, createSessionHttp, sessionResolver: { resolve } });
    const signal = new AbortController().signal;
    expect(await service.mobileSearchSongs('opaque', { query: '我怀念的' }, signal)).toEqual({ body: { item_song: [song] } });
    expect(resolve).toHaveBeenCalledWith('opaque');
    expect(createSessionHttp).toHaveBeenCalledOnce(); expect(sharedPost).not.toHaveBeenCalled();
    const [url, data, options] = post.mock.calls[0] as any;
    expect(url).toBe('https://u.y.qq.com/cgi-bin/musicu.fcg');
    expect(data.req_0).toMatchObject({ module: 'music.search.SearchCgiService', method: 'DoSearchForQQMusicLite' });
    expect(options.headers.Cookie).toContain('qm_keyst=unit-only-key');
    expect(options.headers.Authorization).toBeUndefined(); expect(options.headers['x-qq-session']).toBeUndefined();
    expect(options).toMatchObject({ signal, timeout: 12000, maxContentLength: 8388608 });
  });
  it('does not call upstream without a resolved session', async () => {
    const post = vi.fn(), service = createQrLoginService({ http: { post }, sessionResolver: { resolve: async () => null } });
    expect(await service.mobileSearchSongs('expired', {}, new AbortController().signal)).toBeNull(); expect(post).not.toHaveBeenCalled();
  });
  it('fails closed on source drift or a duplicate application', () => {
    expect(() => patchQqSearch('changed source')).toThrow();
    expect(() => patchQqSearch(patchQqSearch(readFileSync(file, 'utf8')))).toThrow();
  });
});
