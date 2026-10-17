// qqSearchRoute.cjs — fixed authenticated mobile song search, using the installed QQ session service.
const credentialCodes = new Set([1000, 104400, 104401]);
function createQqSearchRoute({ service, getAuthToken, ProtocolError }) {
  let active = 0;
  return async ctx => {
    ctx.set('Cache-Control', 'no-store');
    const { key, page = '1', limit = '20' } = ctx.query;
    if (typeof key !== 'string' || !key.trim() || key.length > 60 ||
        typeof page !== 'string' || typeof limit !== 'string' ||
        !/^[1-9]\d*$/.test(String(page)) || Number(page) > 10000 ||
        !/^[1-9]\d*$/.test(String(limit)) || Number(limit) > 100 ||
        Object.keys(ctx.query).some(k => !['key', 'page', 'limit', 'timestamp'].includes(k))) {
      ctx.status = 400; ctx.body = { code: 400, message: 'Invalid search parameters' }; return;
    }
    const token = getAuthToken(ctx);
    if (!token || token.length > 24000) {
      ctx.status = 401; ctx.body = { code: 401, message: 'Login required' }; return;
    }
    if (active >= 12) {
      ctx.set('Retry-After', '1'); ctx.status = 429; ctx.body = { code: 429, message: 'Search busy' }; return;
    }
    const controller = new AbortController(), abort = () => controller.abort();
    ctx.req.once('aborted', abort); ctx.res.once('close', abort); active++;
    try {
      const data = await service.mobileSearchSongs(token, {
        search_id: String(Math.floor(Math.random() * 100000000000000 + Date.now() % 86400000)),
        remoteplace: 'search.android.keyboard', query: key.trim(), search_type: 0,
        num_per_page: Number(limit), page_num: Number(page), highlight: 0, nqc_flag: 0, page_id: 1, grp: 1,
      }, AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]));
      if (!data) { ctx.status = 401; ctx.body = { code: 401, message: 'Login required' }; return; }
      // The RPC envelope can succeed while the search itself fails. These are business errors,
      // not credential rejection; never turn their empty item_song into a successful empty page.
      if (data.code !== 0 || data.meta?.ret !== 0) {
        ctx.status = 502; ctx.body = { code: 502, errorKey: 'unavailable' }; return;
      }
      const songs = data.body?.item_song;
      if (!Array.isArray(songs)) {
        ctx.status = 502; ctx.body = { code: 502, errorKey: 'invalid-response' }; return;
      }
      // Preserve only observed numeric page metadata so an empty response can be diagnosed.
      // Never forward arbitrary upstream metadata (URLs, identifiers or credential-bearing text).
      const meta = Object.fromEntries(['ret', 'sum', 'curpage', 'nextpage']
        .filter(key => Number.isSafeInteger(data.meta[key])).map(key => [key, data.meta[key]]));
      ctx.status = 200; ctx.body = { code: 200, data: { code: data.code, meta, body: { item_song: songs } } };
    } catch (error) {
      // A gateway/business failure is not a rejected credential; never expose the request or raw error.
      if (error instanceof ProtocolError && error.globalCode === 0 && credentialCodes.has(error.upstreamCode)) {
        ctx.status = 401; ctx.body = { code: 401, message: 'Login required' };
      } else if (error?.response?.status === 429) {
        ctx.status = 429; ctx.body = { code: 429, message: 'Search busy' };
      } else {
        ctx.status = 502; ctx.body = { code: 502, errorKey: 'unavailable' };
      }
    } finally {
      active--; ctx.req.removeListener('aborted', abort); ctx.res.removeListener('close', abort);
    }
  };
}
module.exports = { createQqSearchRoute };
