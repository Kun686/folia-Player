import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { runInNewContext } from 'node:vm';
import { inflateSync, constants } from 'node:zlib';

// server-lyrics-smoke.mjs — read-only provider diagnostic using the exact packaged native lyric adapter.
// Run inside the gateway container: node this-file.mjs /tmp/folia-lyrics.js.
// Only counts/statuses leave the process; no sessions, signed URLs, song identities or lyrics are logged.
const runtimePath = process.argv[2];
const scope = process.env.MOBILE_LYRIC_SCOPE;
if (scope && !['netease', 'qq'].includes(scope)) {
  console.error('unsupported-probe-scope'); process.exit(2);
}
if (!runtimePath || !process.env.MOBILE_ACCESS_TOKEN) {
  console.error('runtime-path-and-gateway-token-required'); process.exit(2);
}
const source = readFileSync(runtimePath, 'utf8');
const runtime = runInNewContext(source + ';FoliaLocalLyrics', {}, { timeout: 5000 });
if (runtime.protocolVersion !== 1) throw new Error('unsupported-runtime');
const deadline = AbortSignal.timeout(90_000);
const knownErrors = new Set(['invalid-identity', 'invalid-session', 'invalid-lyric-response',
  'auth-required', 'rate-limited', 'lyric-unavailable']);
class ProbeFailure extends Error { constructor(code, detail) { super(code); this.code = code; this.detail = detail; } }
const requireValue = (value, code) => { if (!value) throw new ProbeFailure(code); return value; };
let failed = false;
async function check(name, task) {
  if (scope && !name.startsWith(scope + '.')) return;
  try { console.log(JSON.stringify({ check: name, status: 'PASS', detail: await task() })); }
  catch (error) {
    failed = true;
    console.log(JSON.stringify({ check: name, status: 'FAIL', code: error instanceof ProbeFailure
      ? error.code : knownErrors.has(error?.message) ? error.message : deadline.aborted ? 'probe-timeout' : 'probe-failed',
      ...(error instanceof ProbeFailure && error.detail ? { detail: error.detail } : {}) }));
  }
}
async function request(input) {
  const response = await fetch('http://127.0.0.1:3000/mobile/request', {
    method: 'POST', headers: { authorization: 'Bearer ' + process.env.MOBILE_ACCESS_TOKEN, 'content-type': 'application/json' },
    body: JSON.stringify(input), signal: AbortSignal.any([deadline, AbortSignal.timeout(20_000)]), redirect: 'error',
  });
  requireValue(response.status === 200, 'gateway-' + response.status);
  const reply = await response.json();
  requireValue(typeof reply.body === 'string' && Buffer.byteLength(reply.body) <= 2_000_000, 'invalid-reply');
  return { status: reply.status, body: reply.body };
}
function unwrap(reply) {
  requireValue(reply.status === 200, 'upstream-' + reply.status);
  const data = JSON.parse(reply.body); return data?.body ?? data;
}
const inflate = value => inflateSync(Buffer.from(value, 'base64'), {
  maxOutputLength: 2_000_000, finishFlush: constants.Z_SYNC_FLUSH,
}).toString('utf8');
async function lyrics(song) {
  const responses = [];
  for (let index = 0; index < 3; index++) {
    const step = JSON.parse(runtime.stepJSON(JSON.stringify({ version: 1, song, session: {}, responses }), inflate));
    if (Object.hasOwn(step, 'lines')) return { lines: step.lines, requests: responses.length };
    requireValue(responses.length < 2 && step.request, 'invalid-runtime-request');
    responses.push(await request(step.request));
  }
  throw new ProbeFailure('request-limit');
}
function describe(result) {
  requireValue(Array.isArray(result.lines) && result.lines.length > 0, 'no-timed-lyrics');
  requireValue(result.lines.every(line => Number.isFinite(line.startTime) && Number.isFinite(line.endTime)
    && line.endTime >= line.startTime && typeof line.fullText === 'string'), 'invalid-timeline');
  return { requests: result.requests, lines: result.lines.length,
    nonemptyLines: result.lines.filter(line => line.fullText.trim()).length };
}
console.log(JSON.stringify({ runtimeSHA256: createHash('sha256').update(source).digest('hex'), protocol: runtime.protocolVersion }));
let netease, qq;
await check('netease.search', async () => {
  const body = unwrap(await request({ provider: 'netease', path: '/cloudsearch', query: { keywords: '稻香', type: 1, limit: 3 } }));
  const raw = requireValue(body.result?.songs?.[0], 'no-search-results');
  netease = { name: raw.name, durationMs: raw.dt, sourceRef: { kind: 'online', providerId: 'netease', mediaId: String(raw.id) } };
  return { songs: body.result.songs.length };
});
await check('netease.native-lyric-runtime', async () => describe(await lyrics(requireValue(netease, 'search-failed'))));
await check('qq.search', async () => {
  // Discovery repeats the existing server-smoke/App search parameters; all lyric requests use the packaged adapter.
  const body = unwrap(await request({ provider: 'lyrics', path: 'https://u.y.qq.com/cgi-bin/musicu.fcg', method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'tmeLoginType=-1;', 'user-agent': 'okhttp/3.14.9' },
    body: JSON.stringify({ comm: { ct: 11, cv: '1003006', v: '1003006', os_ver: '15', phonetype: '24122RKC7C',
      rom: 'Redmi/miro/miro:15/AE3A.240806.005/OS2.0.102.0.VOMCNXM:user/release-keys', tmeAppID: 'qqmusiclight', nettype: 'NETWORK_WIFI', udid: '0', uid: '0' },
    request: { method: 'DoSearchForQQMusicLite', module: 'music.search.SearchCgiService', param: {
      search_id: String(Math.floor(Math.random() * 100000000000000 + Date.now() % 86400000)),
      remoteplace: 'search.android.keyboard', query: process.env.MOBILE_LYRIC_QUERY || '稻香', search_type: 0,
      num_per_page: 50, page_num: 1, highlight: 0, nqc_flag: 0, page_id: 1, grp: 1,
    } } }),
  }));
  const raw = body.request?.data?.body?.item_song?.[0];
  if (!raw) throw new ProbeFailure('no-search-results', {
    code: typeof body.code === 'number' ? body.code : null,
    requestCode: typeof body.request?.code === 'number' ? body.request.code : null,
    songCount: Array.isArray(body.request?.data?.body?.item_song) ? body.request.data.body.item_song.length : null,
    bodyPresent: !!body.request?.data?.body,
  });
  qq = { name: raw.title, durationMs: raw.interval * 1000, album: { name: raw.album?.name },
    artists: raw.singer?.map(artist => ({ name: artist.name })), id: raw.mid,
    sourceRef: { kind: 'online', providerId: 'qq', mediaId: raw.mid, providerData: { songId: raw.id } } };
  return { songs: body.request.data.body.item_song.length };
});
let direct;
await check('qq.native-lyric-runtime', async () => {
  direct = await lyrics(requireValue(qq, 'search-failed')); return describe(direct);
});
await check('qq.legacy-queue-identity', async () => {
  const song = requireValue(qq, 'search-failed');
  const legacy = await lyrics({ ...song, sourceRef: { ...song.sourceRef, providerData: {} } });
  requireValue(direct?.lines && JSON.stringify(legacy.lines) === JSON.stringify(direct.lines), 'legacy-timeline-mismatch');
  requireValue(legacy.requests === 2, 'legacy-request-count');
  return describe(legacy);
});
console.log(JSON.stringify({ check: 'account-cloud-lyrics-and-device-background', status: 'NOT_RUN', reason: 'authenticated account and physical-device acceptance are separate' }));
process.exitCode = failed ? 1 : 0;
