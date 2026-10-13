import type { UnifiedSong } from '../../types';
import type { ChorusRange, JsonValue, MediaId, ProviderCatalogRef, ProviderPage } from '../../types/onlineMusic';
import { getSizedCoverUrl } from '../../utils/coverUrl';
import { getPlaybackSongKey } from '../../utils/appPlaybackGuards';
import { normalizeSongTitleForLyricSearch } from '../../utils/lyrics/searchQuery';

// kugouNormalize.ts — original provider normalization shared with the independent lyric host.

export const valueOf = (raw: any, ...keys: string[]) => {
    for (const key of keys) {
        if (raw?.[key] !== undefined && raw?.[key] !== null) return raw[key];
    }
    return undefined;
};

const KUGOU_CANONICAL_COVER_SIZE = 1024;

// Selects one playable URL without coercing KuGou's candidate URL arrays into a comma-joined path.

export const dataOf = (raw: any): any => raw?.data ?? raw?.body?.data ?? raw?.body ?? raw;

// Unwrap the nested envelopes used by the different KuGou recommendation endpoints.
export const listOf = (raw: any): any[] => {
    const queue: any[] = [dataOf(raw)];
    const listKeys = [
        'lists', 'list', 'info', 'songs', 'song_list', 'songlist', 'songList', 'audios', 'albums', 'items', 'records',
        'special', 'specials', 'special_list', 'playlist', 'playlists',
        'recommend_list', 'recommendations', 'data', 'result', 'response',
    ];
    const visited = new Set<object>();

    while (queue.length > 0) {
        const current = queue.shift();
        if (Array.isArray(current)) return current;
        if (!current || typeof current !== 'object' || visited.has(current)) continue;
        visited.add(current);

        for (const key of listKeys) {
            const value = current[key];
            if (Array.isArray(value)) return value;
            if (value && typeof value === 'object') queue.push(value);
        }
    }

    return [];
};

export const coverOf = (raw: any): string | undefined => {
    // Youth card songs carry the album art in album_info/audio_info; user_pic is only the uploader avatar.
    const value = valueOf(raw?.album_info, 'sizable_cover', 'cover')
        ?? valueOf(raw?.albumInfo, 'sizable_cover', 'cover')
        ?? valueOf(raw?.audio_info?.trans_param, 'union_cover')
        ?? valueOf(raw?.audioInfo?.transParam, 'union_cover')
        ?? valueOf(raw?.trans_param, 'union_cover')
        ?? valueOf(raw, 'sizable_cover', 'Image', 'image', 'img', 'pic', 'picUrl', 'cover', 'coverUrl', 'sizable_avatar');
    if (!value) return undefined;
    const cover = String(value).trim().replace('{size}', String(KUGOU_CANONICAL_COVER_SIZE));
    if (/^\d{8,}\.(?:jpe?g|png|webp)$/i.test(cover)) {
        return `https://c1.kgimg.com/stdmusic/${KUGOU_CANONICAL_COVER_SIZE}/${cover.slice(0, 8)}/${cover}`;
    }
    const secureCover = cover.startsWith('//') ? `https:${cover}` : cover.replace(/^http:/i, 'https:');
    return getSizedCoverUrl(secureCover, KUGOU_CANONICAL_COVER_SIZE);
};

export const hashOf = (raw: any): string => String(
    valueOf(raw, 'FileHash', 'fileHash', 'hash', 'Hash', 'audio_hash', 'audioHash', 'kgHash')
    ?? valueOf(raw?.audio_info, 'hash', 'hash_128')
    ?? '',
).toUpperCase();

const isKugouSongPayload = (raw: any): boolean => Boolean(
    valueOf(raw, 'FileHash', 'fileHash', 'hash', 'Hash', 'songid', 'songId', 'SongName', 'songname', 'songName', 'ori_audio_name', 'audio_name')
    ?? valueOf(raw?.base, 'songid', 'songId', 'songname', 'songName')
);

// Finds song arrays even when KuGou wraps recommendations in several data/card envelopes.
export const songListOf = (raw: any): any[] => {
    const queue: any[] = [dataOf(raw)];
    const listKeys = [
        'song_list', 'songlist', 'songList', 'songs', 'audios', 'list', 'lists', 'info', 'items',
        'records', 'song_info', 'songInfo', 'data', 'result', 'response',
    ];
    const visited = new Set<object>();

    while (queue.length > 0) {
        const current = queue.shift();
        if (Array.isArray(current)) {
            if (current.some(isKugouSongPayload)) return current;
            current.forEach(item => {
                if (item && typeof item === 'object') queue.push(item);
            });
            continue;
        }
        if (!current || typeof current !== 'object' || visited.has(current)) continue;
        visited.add(current);
        if (isKugouSongPayload(current)) return [current];

        for (const key of listKeys) {
            const value = current[key];
            if (Array.isArray(value)) queue.push(value);
            else if (value && typeof value === 'object') queue.push(value);
        }
    }

    return [];
};

export const jsonData = (entries: Array<[string, unknown]>): Record<string, JsonValue> => Object.fromEntries(
    entries.filter((entry): entry is [string, JsonValue] => (
        entry[1] === null || ['string', 'number', 'boolean'].includes(typeof entry[1])
    )),
);

export const catalogRef = (
    kind: ProviderCatalogRef['kind'],
    id: unknown,
): ProviderCatalogRef | undefined => (
    id !== undefined && id !== null && String(id) !== ''
        ? { providerId: 'kugou', kind, id: id as MediaId }
        : undefined
);

export const normalizeArtists = (raw: any) => {
    const singers = valueOf(raw, 'Singers', 'singers', 'singerinfo', 'authors', 'artists');
    const usesSingerInfo = singers === raw?.singerinfo;
    if (Array.isArray(singers)) {
        return singers.map((artist: any, index: number) => {
            const base = artist?.base ?? artist;
            const authorId = valueOf(base, 'author_id', 'authorId')
                ?? (usesSingerInfo ? valueOf(base, 'id') : undefined);
            return {
                id: authorId ?? `kugou-artist-${index}`,
                name: String(valueOf(base, 'name', 'author_name', 'singername') || ''),
                ...(catalogRef('artist', authorId) ? { catalogRef: catalogRef('artist', authorId) } : {}),
            };
        }).filter(artist => artist.name);
    }
    const names = String(valueOf(raw, 'SingerName', 'singername', 'author_name', 'Singer') || '')
        .split(/[、,&/]/).map(name => name.trim()).filter(Boolean);
    return names.map((name, index) => ({ id: `kugou-artist-${index}-${name}`, name }));
};

export const normalizeTimestamp = (value: unknown): number | undefined => {
    if (value === undefined || value === null || value === '') return undefined;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
        if (numeric > 0 && numeric < 10000) return Date.UTC(Math.round(numeric), 0, 1);
        return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : undefined;
};

// Some KuGou collection endpoints only expose "artist - title" through audio_name.
const normalizeKugouTitleAndArtists = (rawTitle: string, rawArtists: ReturnType<typeof normalizeArtists>) => {
    if (rawArtists.length > 0) {
        return {
            title: normalizeSongTitleForLyricSearch(rawTitle, rawArtists.map(artist => artist.name).join(', ')),
            artists: rawArtists,
        };
    }

    const combined = rawTitle.match(/^(.+?)\s+-\s+(.+)$/u);
    if (!combined) {
        return { title: rawTitle.trim(), artists: rawArtists };
    }

    const artistNames = combined[1]
        .split(/[、,&/]|\s+(?:feat\.?|ft\.?|featuring)\s+/iu)
        .map(name => name.trim())
        .filter(Boolean);
    if (artistNames.length === 0) {
        return { title: rawTitle.trim(), artists: rawArtists };
    }

    return {
        title: combined[2].trim(),
        artists: artistNames.map((name, index) => ({ id: `kugou-artist-${index}-${name}`, name })),
    };
};

export const normalizeKugouSong = (raw: unknown): UnifiedSong => {
    const item = raw as any;
    const base = item?.base ?? {};
    const audioInfo = item?.audio_info ?? item?.audioInfo ?? {};
    const hash = hashOf(item);
    const rawArtists = normalizeArtists(item);
    const nestedAlbum = valueOf(item, 'album_info', 'albumInfo', 'albuminfo', 'album') ?? {};
    const albumId = valueOf(item, 'AlbumID', 'album_id', 'albumId')
        ?? valueOf(nestedAlbum, 'album_id', 'albumId')
        ?? valueOf(base, 'album_id', 'albumId')
        ?? '';
    const albumCatalogRef = catalogRef('album', albumId);
    const albumName = String(
        valueOf(item, 'AlbumName', 'album_name', 'albumName', 'albumname')
        ?? valueOf(nestedAlbum, 'name', 'album_name', 'albumName')
        ?? valueOf(base, 'album_name', 'albumName')
        ?? ''
    );
    const durationValue = Number(
        valueOf(item, 'Duration', 'duration', 'timelen', 'timeLength', 'timelength', 'time_length')
        ?? valueOf(audioInfo, 'duration', 'timelength', 'duration_128')
        ?? 0,
    );
    const duration = durationValue > 0 && durationValue < 10000 ? durationValue * 1000 : durationValue;
    const mixSongId = valueOf(item, 'MixSongID', 'mixsongid', 'mixSongId')
        ?? valueOf(base, 'MixSongID', 'mixsongid', 'mixSongId');
    const albumAudioId = valueOf(item, 'album_audio_id', 'albumAudioId')
        ?? valueOf(base, 'album_audio_id', 'albumAudioId');
    const providerData = jsonData([
        ['hash', hash],
        ['mixSongId', mixSongId],
        ['albumAudioId', albumAudioId],
        ['catalogLookupId', albumAudioId ?? mixSongId],
        ['albumId', albumId],
        ['fileId', valueOf(item, 'FileID', 'fileid', 'file_id')],
    ]);
    const rawTitle = String(valueOf(
        item,
        'SongName', 'songname', 'songName',
        'ori_audio_name', 'oriAudioName',
        'OriSongName', 'ori_song_name', 'oriSongName',
        'FileName', 'filename', 'fileName',
        'name', 'audio_name',
    ) ?? valueOf(audioInfo, 'ori_audio_name', 'oriAudioName', 'audio_name', 'audioName')
        ?? valueOf(base, 'SongName', 'songname', 'songName', 'audio_name', 'audioName') ?? '');
    const { title, artists } = normalizeKugouTitleAndArtists(rawTitle, rawArtists);

    const album = {
        id: albumId,
        name: albumName,
        coverUrl: coverOf(item),
        ...(albumCatalogRef ? { catalogRef: albumCatalogRef } : {}),
    };

    return {
        id: hash,
        name: title,
        artists,
        album,
        durationMs: duration,
        kgHash: hash,
        sourceRef: { kind: 'online', providerId: 'kugou', mediaId: hash, providerData },
    };
};


// Advances mixed user-library pagination with the raw response count, not the filtered item count.
export const pageOfWithRawItemCount = <T>(
    items: T[],
    response: any,
    limit: number,
    offset: number,
    rawItemCount: number,
): ProviderPage<T> => {
    const data = dataOf(response);
    const totalCandidate = [data?.total, data?.list_count, data?.total_count, data?.count]
        .map(value => Number(value))
        .find(value => Number.isFinite(value) && value >= 0);
    const nextOffset = offset + rawItemCount;
    return {
        items,
        ...(totalCandidate !== undefined ? { total: totalCandidate } : {}),
        hasMore: totalCandidate !== undefined ? nextOffset < totalCandidate : rawItemCount === limit,
        nextOffset,
    };
};

// Keeps one result per provider-aware playback identity while preserving search ranking order.
export const normalizeKugouSearchSongs = (rawItems: any[]): UnifiedSong[] => {
    const seenSongKeys = new Set<string>();
    return rawItems
        .map(normalizeKugouSong)
        .filter(song => {
            if (!song.id) return false;
            const songKey = getPlaybackSongKey(song);
            if (seenSongKeys.has(songKey)) return false;
            seenSongKeys.add(songKey);
            return true;
        });
};

// Converts KuGou's millisecond climax payload into the shared second-based range model.
export const parseKugouChorusRanges = (response: unknown): ChorusRange[] => {
    const ranges = (response as any)?.data;
    if (!Array.isArray(ranges)) return [];

    return ranges
        .map((range: any) => ({
            startTime: Number(range?.start_time) / 1000,
            endTime: Number(range?.end_time) / 1000,
        }))
        .filter(range => Number.isFinite(range.startTime) && Number.isFinite(range.endTime) && range.endTime > range.startTime);
};
