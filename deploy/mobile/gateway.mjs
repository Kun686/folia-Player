import { timingSafeEqual, createHash } from 'node:crypto';
import express from 'express';
import { authorizeTarget, fault } from './policy.mjs';
import { resolveNeteasePlayback, resolveQqPlayback, resolveKugouPlayback } from '../../shared/mobile/providerPlayback.ts';

// deploy/mobile/gateway.mjs — authenticated, bounded mobile API, no credential-bearing logs.
const hash = value => createHash('sha256').update(value).digest();
const MAX_RESPONSE = 8 * 1024 * 1024;
async function boundedText(response) {
  const chunks = []; let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > MAX_RESPONSE) throw fault('response-too-large', 502);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
export function createMobileApp({ token, bases, providers = ['netease', 'qq', 'kugou'], fetchImpl = fetch }) {
  if (typeof token !== 'string' || token.length < 32) throw new Error('MOBILE_ACCESS_TOKEN must contain at least 32 characters');
  if (!providers.length || providers.some(id => !['netease', 'qq', 'kugou'].includes(id) || !bases[id])) throw new Error('Invalid mobile providers');
  const enabled = new Set(providers);
  const app = express();
  app.disable('x-powered-by');
  app.get('/healthz', (_req, res) => res.json({ status: 'ok' }));
  app.use('/mobile', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const supplied = req.get('authorization') ?? '';
    if (!timingSafeEqual(hash(supplied), hash('Bearer ' + token))) return res.status(401).json({ code: 'gateway-auth-required' });
    next();
  });
  app.use(express.json({ limit: '256kb' }));
  let active = 0;
  app.use('/mobile', (_req, res, next) => {
    if (active >= 24) return res.status(429).json({ code: 'rate-limited' });
    active++;
    res.once('close', () => { active--; });
    next();
  });
  async function upstream(input, signal) {
    const url = authorizeTarget(input, bases);
    const provider = input.provider === 'lyrics' ? (url.hostname === 'u.y.qq.com' ? 'qq' : 'kugou') : input.provider;
    if (!enabled.has(provider)) throw fault('provider-disabled', 404);
    const headers = { accept: 'application/json' };
    // Access authorization is intentionally never copied to an upstream request.
    for (const [key, value] of Object.entries(input.headers ?? {})) {
      if (['content-type', 'x-qq-session', 'cookie', 'user-agent', 'kg-rec', 'kg-rc', 'kg-clienttimems', 'mid', 'x-router'].includes(key.toLowerCase()) &&
          typeof value === 'string' && value.length <= 24000) headers[key.toLowerCase()] = value;
    }
    const response = await fetchImpl(url, { method: input.method ?? 'GET', headers,
      body: input.method === 'POST' ? input.body : undefined, redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]) });
    return { status: response.status, body: await boundedText(response),
      headers: { 'content-type': response.headers.get('content-type') ?? 'application/json',
        ...(response.headers.has('retry-after') ? { 'retry-after': response.headers.get('retry-after') } : {}) } };
  }
  function route(handler) {
    return async (req, res) => {
      const controller = new AbortController();
      res.once('close', () => controller.abort());
      try { await handler(req, res, controller.signal); }
      catch (error) {
        if (!res.destroyed) res.status(error.status ?? 502).json({ code: error.code ?? 'upstream-unavailable' });
      }
    };
  }
  app.get('/mobile/health', (_req, res) => res.json({ protocol: 1, providers: [...enabled],
    songLikeProviders: enabled.has('netease') ? ['netease'] : [],
    playlistEditProviders: enabled.has('netease') ? ['netease'] : [],
    dailyProviders: enabled.has('netease') ? ['netease'] : [],
    catalogProviders: [...enabled].filter(provider => ['netease', 'qq'].includes(provider)) }));
  app.post('/mobile/request', route(async (req, res, signal) => {
    if (!req.body || typeof req.body !== 'object') throw fault('invalid-request');
    res.json(await upstream(req.body, signal));
  }));
  app.post('/mobile/resolve', route(async (req, res, signal) => {
    const { song, quality = 'standard', session = {} } = req.body ?? {};
    const ref = song?.sourceRef;
    if (ref?.kind !== 'online' || !['netease', 'qq', 'kugou'].includes(ref.providerId) ||
        typeof ref.mediaId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(ref.mediaId) ||
        !['standard', 'high', 'lossless', 'hires'].includes(quality) || typeof session !== 'object') throw fault('invalid-identity');
    const provider = ref.providerId;
    if (!enabled.has(provider)) throw fault('provider-disabled', 404);
    const cookie = session.cookie || (provider === 'netease' ? session.anonymous_cookie : '') || '';
    const request = async (operation, params) => {
      const query = { ...params };
      let path;
      if (provider === 'netease') { path = '/song/url/v1'; query.randomCNIP = true; query.https = true; }
      else if (provider === 'qq') { path = '/getMusicPlay/' + encodeURIComponent(query.songmid); delete query.songmid; }
      else if (operation === 'song_url') path = '/song/url';
      else throw fault('unsupported', 404);
      if (cookie) query.cookie = cookie;
      if (provider === 'kugou') {
        query.cookie = [cookie, ...['token', 'userid', 'dfid'].filter(k => session[k]).map(k => k + '=' + session[k])].filter(Boolean).join('; ');
      }
      const result = await upstream({ provider, path, query }, signal);
      let body; try { body = JSON.parse(result.body); } catch { throw fault('invalid-response', 502); }
      body = body?.body ?? body;
      if ([401, 403].includes(result.status) || [301, 401, 403].includes(body.code) ||
          Number(body?.errcode ?? body?.data?.errcode) === 152) throw fault('auth-required', 401);
      if (result.status === 429) throw fault('rate-limited', 429);
      if (result.status >= 400) throw fault('upstream-unavailable', 502);
      return body;
    };
    const resolver = { netease: resolveNeteasePlayback, qq: resolveQqPlayback, kugou: resolveKugouPlayback }[provider];
    const legacy = async hash => {
      const result = await upstream({ provider: 'lyrics', path: 'https://m.kugou.com/app/i/getSongInfo.php?cmd=playInfo&hash=' + encodeURIComponent(hash) }, signal);
      if (result.status !== 200) throw fault('upstream-unavailable', 502);
      return JSON.parse(result.body);
    };
    const source = await resolver(song, quality, request, provider === 'kugou' ? legacy : undefined);
    if (!source) throw fault('unavailable', 422);
    const url = new URL(source.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw fault('invalid-response', 502);
    url.protocol = 'https:';
    res.json({ ...source, url: url.toString() });
  }));
  app.use((error, _req, res, _next) => res.status(error.status === 413 ? 413 : 400).json({ code: 'invalid-request' }));
  return app;
}
