import { Buffer } from 'buffer';
import { canonicalNeteaseSong, mergeSongsWithPrivileges, normalizeSongResult } from '../../../shared/mobile/neteaseSong';
import type { AutoMatchLyricPorts } from '../../utils/lyrics/autoMatchBestLyricTypes';
import { parseLyricsByFormat } from '../../utils/lyrics/parserCore';
import { prepareNeteaseLyrics, getProcessedLyricPayload, extractCloudLyricText } from '../../utils/lyrics/neteasePayload';
import { parseNeteaseChorusRanges } from '../../utils/lyrics/neteaseChorus';
import { qqLyricParams, qqLyricSong, qqRequestPayload } from '../../utils/lyrics/providers/qqLyricProtocol';
import { qqLyricSearchParams, normalizeQQLyricSearch } from '../../utils/lyrics/providers/qqLyricSearch';
import { buildAmllApiLyricsUrl } from '../../utils/lyrics/providers/amllApi';
import { normalizeMusicIds } from '../../utils/lyrics/providers/amllDbIdentity';
import { buildKugouLyricSearchQuery } from '../../utils/lyrics/searchQuery';
import { parseQqSongDetail } from './qqNormalize';
import { parseNativeQQLyrics } from './nativeQqLyrics';
import { neteaseSearchPage } from './neteaseSearchProtocol';
import { createKugouLyricLoader } from './kugouLyricProtocol';
import { listOf, normalizeKugouSearchSongs, pageOfWithRawItemCount, parseKugouChorusRanges } from './kugouNormalize';
import { kugouAnonymousSearchRequest, kugouSessionCookie } from './kugouSearchProtocol';
import { NativeLyricRequests, lyricBody, lyricQuery, type LyricIO } from './nativeLyricRequests';

// nativeLyricPorts.ts — provider adapter for the explicitly cross-source matcher, using original protocol/normalization.
// Only each platform's gateway requests receive its cookie; public lyric/AMLL requests never receive account credentials.
export function nativeLyricPorts(jobs: NativeLyricRequests, inflate: (base64: string) => string | null,
    sessions: Record<string, Record<string, string>> = {}): AutoMatchLyricPorts {
    const kugouCookie = kugouSessionCookie(sessions.kugou ?? {});
    const kugouAuthenticated = ['token', 'userid', 'dfid'].every(key => new RegExp(`(?:^|;)\\s*${key}=[^;]+`, 'i').test(kugouCookie));
    const cookieQuery = (provider: 'netease' | 'qq' | 'kugou') => {
        const session = sessions[provider] ?? {};
        const cookie = provider === 'kugou' ? kugouCookie : session.cookie || (provider === 'netease' ? session.anonymous_cookie : '') || '';
        return cookie ? { cookie } : {};
    };
    const raw = async (io: LyricIO, provider: 'netease' | 'kugou', path: string, query = {}) =>
        lyricBody(await io({ provider, path, query: { ...query, ...cookieQuery(provider) } }));
    const chorus = async (io: LyricIO, provider: 'netease' | 'kugou' | 'qq', id: number | string) => {
        try {
            if (provider === 'qq') return [];
            return provider === 'netease'
                ? parseNeteaseChorusRanges(await raw(io, provider, '/song/chorus', { id }))
                : parseKugouChorusRanges(await raw(io, provider, '/song/climax', { hash: String(id).trim().toUpperCase() }));
        } catch { return []; }
    };
    const qq = async (io: LyricIO, method: string, module: string, param: unknown) => {
        const response = lyricBody(await io({ provider: 'lyrics', path: 'https://u.y.qq.com/cgi-bin/musicu.fcg', method: 'POST',
            headers: { 'Content-Type': 'application/json', Cookie: 'tmeLoginType=-1;', 'User-Agent': 'okhttp/3.14.9' },
            body: JSON.stringify(qqRequestPayload(method, module, param)) }));
        if (response.code !== 0 || response.request?.code !== 0) throw new Error('lyric-unavailable');
        return response;
    };
    return {
        withTimeout: (promise, milliseconds, label, fallback) => jobs.withTimeout(promise, milliseconds, label, fallback),
        searchSongs: (provider, query, limit, offset) => jobs.operation(3500, async io => {
            if (provider === 'netease') {
                const response = await raw(io, provider, '/cloudsearch', { keywords: query, limit, offset });
                if (Array.isArray(response.result?.songs)) response.result.songs = mergeSongsWithPrivileges(response.result.songs,
                    response.result.privileges ?? response.privileges);
                return neteaseSearchPage(response, offset, value => canonicalNeteaseSong(normalizeSongResult(value)));
            }
            const page = Math.floor(offset / limit) + 1;
            let response;
            if (kugouAuthenticated) response = await raw(io, provider, '/search', { keywords: query, keyword: query, type: 'song', page, pagesize: limit });
            else {
                const request = kugouAnonymousSearchRequest(buildKugouLyricSearchQuery(query), page, limit);
                response = lyricBody(await io({ provider: 'lyrics', path: 'https://complexsearch.kugou.com/v2/search/song?' + lyricQuery(request.params),
                    headers: request.headers }));
                const code = Number(response.error_code);
                if (Number.isFinite(code) && code !== 0 && code !== 200) throw new Error('lyric-unavailable');
            }
            const items = listOf(response);
            return pageOfWithRawItemCount(normalizeKugouSearchSongs(items), response, limit, offset, items.length);
        }),
        getLyrics: (provider, song) => jobs.operation(5000, async io => {
            if (provider === 'kugou') return createKugouLyricLoader((operation, params) => {
                const path = { search_lyric: '/search/lyric', lyric: '/lyric' }[operation as 'search_lyric' | 'lyric'];
                if (!path) throw new Error('invalid-lyric-request');
                return raw(io, provider, path, params);
            }, id => chorus(io, provider, id))(song);
            let payload;
            if (song.sourceRef?.kind === 'online' && song.sourceRef.variant === 'cloud') {
                const account = await raw(io, provider, '/user/account');
                const uid = account.account?.id ?? account.profile?.userId;
                if (!Number.isSafeInteger(Number(uid)) || Number(uid) <= 0) throw new Error('auth-required');
                const response = await raw(io, provider, '/cloud/lyric/get', { uid, sid: song.id });
                payload = { type: 'netease' as const, lrc: { lyric: extractCloudLyricText(response) } };
            } else payload = getProcessedLyricPayload(await raw(io, provider, '/lyric/new', { id: song.id }));
            const prepared = prepareNeteaseLyrics(payload);
            const lyrics = prepared.args ? parseLyricsByFormat(...prepared.args) : null;
            if (lyrics) lyrics.isWordByWord = !!prepared.payload.yrcLrc;
            return { lyrics, mainText: prepared.payload.mainLrc, wordByWordText: prepared.payload.yrcLrc,
                translationText: prepared.payload.transLrc, romanizationText: prepared.payload.romanizationLrc,
                isPureMusic: prepared.payload.isPureMusic, chorusRanges: await chorus(io, provider, song.id) };
        }),
        getChorusRanges: (provider, song) => jobs.operation(5000, io => chorus(io, provider, song.kgHash ?? song.id)),
        searchQQ: (query, page, limit) => jobs.operation(3500, async io => {
            if (!query.trim()) return [];
            const response = await qq(io, 'DoSearchForQQMusicLite', 'music.search.SearchCgiService', qqLyricSearchParams(query.trim(), page, limit));
            return normalizeQQLyricSearch(response.request.data);
        }),
        fetchQQ: (song, options) => jobs.operation(5000, async io => {
            let identified = qqLyricSong(song);
            if (!Number.isSafeInteger(Number(identified.id)) || Number(identified.id) <= 0) {
                const detail = parseQqSongDetail(lyricBody(await io({ provider: 'qq', path: '/getSongInfo/' + identified.qqMid, query: cookieQuery('qq') })));
                if (!detail || qqLyricSong(detail).qqMid !== identified.qqMid) throw new Error('invalid-identity');
                identified = qqLyricSong(detail);
            }
            if (!identified.id || !identified.qqMid) throw new Error('invalid-identity');
            const response = await qq(io, 'GetPlayLyricInfo', 'music.musichallSong.PlayLyricInfo',
                qqLyricParams(identified, value => Buffer.from(value, 'utf8').toString('base64')));
            return parseNativeQQLyrics(response, inflate, options);
        }),
        fetchAmll: async (platform, ids) => {
            for (const id of normalizeMusicIds(ids)) {
                try {
                    const reply = await jobs.operation(5000, io => io({ provider: 'amll', path: buildAmllApiLyricsUrl(platform, id, lyricQuery) }));
                    if (reply.status !== 200) continue;
                    const body = JSON.parse(reply.body), ttml = body.status === 200 ? body.data?.lyrics : null;
                    if (typeof ttml !== 'string' || !ttml.trim() || !/<tt(?:\s|>)/i.test(ttml)) continue;
                    const lyrics = parseLyricsByFormat('ttml', ttml);
                    if (lyrics?.lines.length) return lyrics;
                } catch { /* Same per-ID failure fallback as the original AMLL provider. */ }
            }
            return null;
        },
    };
}
