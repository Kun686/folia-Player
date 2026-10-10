// dev/mobile/server-smoke.mjs — run inside the gateway container; print outcomes, never sessions or URLs.
const base = 'http://127.0.0.1:3000';
const token = process.env.MOBILE_ACCESS_TOKEN;
if (!token) throw new Error('MOBILE_ACCESS_TOKEN is required');
let failed = false;
async function gateway(path, body, authenticated = true) {
  const response = await fetch(base + path, { method: body ? 'POST' : 'GET',
    headers: { ...(authenticated ? { authorization: 'Bearer ' + token } : {}), 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20000) });
  return { status: response.status, body: await response.json() };
}
async function request(input) {
  const result = await gateway('/mobile/request', input);
  if (result.status !== 200) throw new Error('gateway-' + result.status + '-' + result.body.code);
  if (result.body.status >= 400) throw new Error('upstream-' + result.body.status);
  let body;
  try { body = JSON.parse(result.body.body); } catch { throw new Error('invalid-upstream-response'); }
  return body.body ?? body;
}
async function check(name, run) {
  const scope = process.env.MOBILE_SMOKE_SCOPE;
  if (scope && !name.startsWith(scope + '.') && !name.startsWith('gateway.')) return;
  try { console.log(JSON.stringify({ check: name, status: 'PASS', detail: await run() })); }
  catch (error) { failed = true; console.log(JSON.stringify({ check: name, status: 'FAIL', code: String(error.message).slice(0, 100) })); }
}
const api = (provider, path, query = {}) => request({ provider, path, query });
const requireValue = (value, code) => { if (!value) throw new Error(code); return value; };
const qq = (method, module, param) => request({ provider: 'lyrics',
  path: 'https://u.y.qq.com/cgi-bin/musicu.fcg', method: 'POST',
  headers: { 'content-type': 'application/json', cookie: 'tmeLoginType=-1;', 'user-agent': 'okhttp/3.14.9' },
  body: JSON.stringify({ comm: { ct: 11, cv: '1003006', v: '1003006', os_ver: '15', phonetype: '24122RKC7C',
    rom: 'Redmi/miro/miro:15/AE3A.240806.005/OS2.0.102.0.VOMCNXM:user/release-keys', tmeAppID: 'qqmusiclight', nettype: 'NETWORK_WIFI', udid: '0', uid: '0' },
  request: { method, module, param } }) });
await check('gateway.no-token', async () => requireValue((await gateway('/mobile/health', undefined, false)).status === 401, 'auth-bypass'));
await check('gateway.capabilities', async () => (await gateway('/mobile/health')).body);
await check('gateway.disabled-provider', async () => requireValue((await gateway('/mobile/request', { provider: 'kugou', path: '/login/qr/key' })).status === 404, 'provider-enabled'));
let neteaseCookie = '', neteaseSong, qqSong;
await check('netease.anonymous', async () => {
  const body = await api('netease', '/register/anonimous');
  neteaseCookie = requireValue(body.cookie, 'no-anonymous-cookie');
  return { code: body.code, cookiePresent: true };
});
await check('netease.search', async () => {
  const body = await api('netease', '/cloudsearch', { keywords: '稻香', type: 1, limit: 3, cookie: neteaseCookie });
  neteaseSong = requireValue(body.result?.songs?.[0], 'no-songs');
  return { code: body.code, songs: body.result.songs.length };
});
await check('netease.lyrics', async () => {
  const body = await api('netease', '/lyric/new', { id: requireValue(neteaseSong?.id, 'search-failed'), cookie: neteaseCookie });
  return { code: body.code, characters: requireValue(body.lrc?.lyric?.length, 'no-lyrics') };
});
await check('netease.resolve', async () => {
  const result = await gateway('/mobile/resolve', { song: { sourceRef: { kind: 'online', providerId: 'netease', mediaId: String(requireValue(neteaseSong?.id, 'search-failed')) } }, session: { anonymous_cookie: neteaseCookie } });
  requireValue(result.status === 200 && result.body.url, 'resolve-' + result.status);
  return { status: result.status, https: result.body.url.startsWith('https:') };
});
await check('netease.qr-ready', async () => {
  const key = requireValue((await api('netease', '/login/qr/key', { type: 1 })).data?.unikey, 'no-qr-key');
  const body = await api('netease', '/login/qr/create', { key, qrimg: true });
  return { imagePresent: !!requireValue(body.data?.qrimg, 'no-qr-image') };
});
await check('qq.channels', async () => {
  try {
    const body = await api('qq', '/login/channels');
    return { code: body.code, channels: body.data?.channels ?? body.channels };
  } catch (error) {
    // Installed Node 3.1.4 omits this optional endpoint; the adapter's existing QQ default applies.
    if (error.message === 'upstream-404') return { optionalEndpoint: false, fallback: 'qq' };
    throw error;
  }
});
await check('qq.search', async () => {
  const body = await qq('DoSearchForQQMusicLite', 'music.search.SearchCgiService', {
    search_id: String(Math.floor(Math.random() * 100000000000000 + Date.now() % 86400000)), remoteplace: 'search.android.keyboard', query: '稻香', search_type: 0,
    num_per_page: 50, page_num: 1, highlight: 0, nqc_flag: 0, page_id: 1, grp: 1 });
  qqSong = requireValue(body.request?.data?.body?.item_song?.[0], 'no-songs');
  return { code: body.code, songs: body.request.data.body.item_song.length };
});
await check('qq.lyrics', async () => {
  const song = requireValue(qqSong, 'search-failed');
  const b64 = value => Buffer.from(value || '').toString('base64');
  const body = await qq('GetPlayLyricInfo', 'music.musichallSong.PlayLyricInfo', {
    albumName: b64(song.album?.name), crypt: 1, ct: 19, cv: 2111, interval: song.interval,
    lrc_t: 0, qrc: 1, qrc_t: 0, roma: 1, roma_t: 0, singerName: b64(song.singer?.map(s => s.name).join(', ')),
    songID: song.id, songName: b64(song.title), trans: 1, trans_t: 0, type: 0 });
  return { characters: requireValue(body.request?.data?.lyric?.length, 'no-lyrics') };
});
await check('qq.resolve-anonymous', async () => {
  const mid = requireValue(qqSong?.mid, 'search-failed');
  const result = await gateway('/mobile/resolve', { song: { sourceRef: { kind: 'online', providerId: 'qq', mediaId: mid } } });
  requireValue(result.status === 200 && result.body.url, 'resolve-' + result.status);
  return { status: result.status, https: result.body.url.startsWith('https:') };
});
await check('qq.qr-ready', async () => {
  const key = requireValue((await api('qq', '/login/qr/key', { channel: 'qq' })).data?.unikey, 'no-qr-key');
  try { return { imagePresent: !!requireValue((await api('qq', '/login/qr/create', { key })).data?.qrimg, 'no-qr-image') }; }
  finally { await api('qq', '/login/qr/cancel', { key }); }
});
console.log(JSON.stringify({ check: 'account-login-playlists-and-device-playback', status: 'NOT_RUN', reason: 'human QR confirmation and devices required' }));
process.exitCode = failed ? 1 : 0;
