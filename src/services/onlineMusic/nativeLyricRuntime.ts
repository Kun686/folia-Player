import { Buffer } from 'buffer';
import type { SongResult } from '../../types';
import { qqLyricParams, qqLyricSong, qqRequestPayload } from '../../utils/lyrics/providers/qqLyricProtocol';
import { parseNativeQQLyrics } from './nativeQqLyrics';
import { getProcessedLyricPayload, prepareNeteaseLyrics, extractCloudLyricText } from '../../utils/lyrics/neteasePayload';
import { parseLyricsByFormat } from '../../utils/lyrics/parserCore';
import { onlineLyricResult } from '../../utils/lyrics/nativeCacheRuntime';
import { parseQqSongDetail } from './qqNormalize';

// nativeLyricRuntime.ts — provider adapter for the independent native host. UI callers keep using Omni.
export { parseJSON, sourcesJSON, protocolVersion } from '../../utils/lyrics/nativeLocalRuntime';
export { embeddedTagsJSON } from '../../utils/lyrics/nativeEmbeddedRuntime';
export { flacTags } from '../../utils/lyrics/nativeFlacRuntime';
export { localMatchJSON } from '../../utils/lyrics/nativeLocalMatchRuntime';
export { localAutomaticInputJSON, localAutomaticResultJSON } from './nativeLocalAutomaticMatch';
export { cacheJSON } from '../../utils/lyrics/nativeCacheRuntime';
function fail(code = 'invalid-lyric-response'): never { throw new Error(code); }
type Reply = { status: number; body: string };
const readResponse = (response: Reply) => {
    if (!response || !Number.isInteger(response.status) || response.status < 100 || response.status > 599
        || typeof response.body !== 'string' || response.body.length > 2_000_000) fail();
    if ([401, 403].includes(response.status)) fail('auth-required');
    if (response.status === 429) fail('rate-limited');
    if (response.status < 200 || response.status >= 300) fail('lyric-unavailable');
    const raw = JSON.parse(response.body), data = raw?.body ?? raw;
    if (!data || typeof data !== 'object' || Array.isArray(data)) fail();
    if ([301, 401, 403].includes(data.code)) fail('auth-required');
    return data;
};
const numericID = (id: unknown) => /^\d{1,16}$/.test(String(id)) && Number.isSafeInteger(Number(id)) && Number(id) > 0;

// Two bounded requests at most: cloud account -> cloud lyric, or legacy QQ detail -> lyric.
// Secrets are request arguments only, never stored in this JavaScriptCore context or sent to the QQ lyric endpoint.
export function stepJSON(text: string, inflate: (base64: string) => string | null): string {
    if (typeof text !== 'string' || text.length > 12_100_000) fail();
    const input = JSON.parse(text), song = input?.song as SongResult;
    const ref = song?.sourceRef, session = input?.session ?? {}, responses = input?.responses ?? [];
    if (input?.version !== 1 || ref?.kind !== 'online' || !['qq', 'netease'].includes(ref.providerId)
        || typeof ref.mediaId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(ref.mediaId)
        || !Array.isArray(responses) || responses.length > 2) fail('invalid-identity');
    if (!session || typeof session !== 'object' || Array.isArray(session)) fail('invalid-session');
    const cookie = session.cookie || (ref.providerId === 'netease' ? session.anonymous_cookie : '') || '';
    if (typeof cookie !== 'string' || cookie.length > 24000) fail('invalid-session');
    const request = (provider: string, path: string, query = {}) => JSON.stringify({ request: {
        provider, path, query: { ...query, ...(cookie ? { cookie } : {}) },
    } });
    if (ref.providerId === 'netease') {
        if (!numericID(ref.mediaId)) fail('invalid-identity');
        const cloud = ref.variant === 'cloud';
        if (cloud && !responses.length) return request('netease', '/user/account');
        const offset = cloud ? 1 : 0;
        let userId: unknown;
        if (cloud) {
            const account = readResponse(responses[0]);
            userId = account.account?.id ?? account.profile?.userId;
            if (!numericID(userId)) fail('auth-required');
        }
        if (responses.length === offset) return request('netease', cloud ? '/cloud/lyric/get' : '/lyric/new',
            cloud ? { uid: userId, sid: ref.mediaId } : { id: ref.mediaId });
        if (responses.length !== offset + 1) fail();
        const raw = readResponse(responses[offset]);
        if (raw.code !== undefined && raw.code !== 200) fail('lyric-unavailable');
        const payload = cloud ? { type: 'netease' as const, lrc: { lyric: extractCloudLyricText(raw) } }
            : getProcessedLyricPayload(raw);
        const { args } = prepareNeteaseLyrics(payload);
        return onlineLyricResult(args ? parseLyricsByFormat(...args) : null, input.full === true);
    }

    let identified = qqLyricSong(song), offset = 0;
    if (!numericID(identified.id)) {
        if (!responses.length) return request('qq', '/getSongInfo/' + ref.mediaId);
        const detail = readResponse(responses[0]);
        const track = parseQqSongDetail(detail);
        if (!track) fail('lyric-unavailable');
        identified = qqLyricSong(track!);
        if (identified.qqMid !== ref.mediaId || !numericID(identified.id)) fail('invalid-identity');
        offset = 1;
    }
    if (responses.length === offset) return JSON.stringify({ request: { provider: 'lyrics',
        path: 'https://u.y.qq.com/cgi-bin/musicu.fcg', method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: 'tmeLoginType=-1;', 'User-Agent': 'okhttp/3.14.9' },
        body: JSON.stringify(qqRequestPayload('GetPlayLyricInfo', 'music.musichallSong.PlayLyricInfo',
            qqLyricParams(identified, value => Buffer.from(value, 'utf8').toString('base64')))),
    } });
    if (responses.length !== offset + 1) fail();
    const raw = readResponse(responses[offset]);
    return onlineLyricResult(parseNativeQQLyrics(raw, inflate), input.full === true);
}
