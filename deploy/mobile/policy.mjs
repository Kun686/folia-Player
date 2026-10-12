// deploy/mobile/policy.mjs — fixed upstream capabilities, never an arbitrary proxy.
export const routes = {
  netease: new Set(['/register/anonimous', '/login/qr/key', '/login/qr/create', '/login/qr/check',
    '/login/status', '/logout', '/user/account', '/user/detail', '/user/playlist', '/playlist/detail',
    '/playlist/track/all', '/song/detail', '/song/url/v1', '/cloudsearch', '/search', '/lyric', '/lyric/new', '/cloud/lyric/get', '/song/chorus', '/likelist', '/like',
    '/album', '/artist/detail', '/artist/songs', '/artist/album']),
  qq: new Set(['/login/qr/key', '/login/qr/create', '/login/qr/check', '/login/qr/cancel',
    '/login/status', '/login/channels', '/logout', '/user/detail', '/user/playlist', '/user/playlist-detail',
    '/user/liked-songs', '/getAlbumInfo', '/getSingerHotsong', '/getSingerAlbum']),
  kugou: new Set(['/register/dev', '/login/qr/key', '/login/qr/create', '/login/qr/check', '/logout',
    '/user/detail', '/user/vip/detail', '/user/playlist', '/search', '/audio', '/krm/audio', '/song/url',
    '/search/lyric', '/lyric', '/song/climax', '/playlist/track/all', '/playlist/detail']),
};
const lyricRoutes = new Set([
  'u.y.qq.com/cgi-bin/musicu.fcg', 'complexsearch.kugou.com/v2/search/song',
  'mobiles.kugou.com/api/v3/search/song', 'lyrics.kugou.com/v1/search',
  'lyrics.kugou.com/download', 'm.kugou.com/app/i/getSongInfo.php',
]);
export function fault(code, status = 400) { return Object.assign(new Error(code), { code, status }); }
export function authorizeTarget(input, bases) {
  const { provider, path, method = 'GET' } = input;
  if (!['GET', 'POST'].includes(method) || typeof path !== 'string' || path.length > 32000) throw fault('invalid-request');
  const parsed = new URL(path, 'https://mobile.invalid');
  if (provider === 'lyrics') {
    if (!lyricRoutes.has(parsed.hostname + parsed.pathname) || parsed.username || parsed.password ||
        !['http:', 'https:'].includes(parsed.protocol) || parsed.port || parsed.hash) throw fault('forbidden', 403);
    if (parsed.hostname === 'u.y.qq.com') {
      let payload;
      try { payload = JSON.parse(input.body); } catch { throw fault('invalid-request'); }
      if (method !== 'POST' || Object.keys(payload).some(k => !['comm', 'request'].includes(k)) ||
          !['music.search.SearchCgiService/DoSearchForQQMusicLite', 'music.musichallSong.PlayLyricInfo/GetPlayLyricInfo']
            .includes(payload.request?.module + '/' + payload.request?.method)) throw fault('forbidden', 403);
    } else if (method !== 'GET') throw fault('forbidden', 403);
    parsed.protocol = 'https:';
    return parsed;
  }
  if (method !== 'GET' || input.body) throw fault('forbidden', 403);
  if (!Object.hasOwn(routes, provider) || !path.startsWith('/') || parsed.origin !== 'https://mobile.invalid') throw fault('forbidden', 403);
  const qqRead = provider === 'qq' && /^\/(?:getMusicPlay|getSongListDetail|getSongInfo)\/[A-Za-z0-9_-]+(?:\/\d+)?$/.test(parsed.pathname);
  if (!routes[provider].has(parsed.pathname) && !qqRead) throw fault('unsupported', 404);
  const params = { ...Object.fromEntries(parsed.searchParams), ...(input.query ?? {}) };
  const catalogId = provider === 'netease' && ['/album', '/artist/detail', '/artist/songs', '/artist/album'].includes(parsed.pathname) ? 'id'
    : provider === 'qq' && parsed.pathname === '/getAlbumInfo' ? 'albummid'
    : provider === 'qq' && ['/getSingerHotsong', '/getSingerAlbum'].includes(parsed.pathname) ? 'singermid' : null;
  if (catalogId) {
    if (!(provider === 'netease' ? /^[1-9][0-9]{0,19}$/ : /^[A-Za-z0-9_-]{1,128}$/).test(String(params[catalogId] ?? ''))) throw fault('invalid-request');
    for (const key of ['limit', 'offset', 'page']) {
      if (params[key] !== undefined && (!/^\d+$/.test(String(params[key])) || Number(params[key]) > (key === 'limit' ? 1000 : 10000)
          || (key === 'limit' && Number(params[key]) < 1))) throw fault('invalid-request');
    }
  }
  if (provider === 'netease' && parsed.pathname === '/like' &&
      (!/^[1-9][0-9]{0,19}$/.test(String(params.id)) || !['true', 'false'].includes(String(params.like)))) throw fault('invalid-request');
  for (const [key, value] of Object.entries(params)) {
    if (!/^[a-zA-Z0-9_]+$/.test(key) || /^(proxy|realIP|ip|url|host|baseURL)$/i.test(key) ||
      !['string', 'number', 'boolean'].includes(typeof value) || String(value).length > 24000) throw fault('invalid-request');
  }
  const url = new URL(parsed.pathname, bases[provider]);
  url.search = new URLSearchParams(params).toString();
  return url;
}
