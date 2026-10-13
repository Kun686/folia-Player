import type { LyricProviderSource, SongResult } from '../types';
import type { LocalSongMetadataSource } from '../types/localLibrary';
import type { ProviderSongMetadata } from '../types/onlineMusic';
import { createProviderSongMetadata } from './songMetadata';
import { calculateMatchScoreDetails } from './lyrics/matchScore';

// onlineMetadataCandidate.ts — original pure candidate normalization shared with the independent native matcher.
export type OnlineMetadataSource = LocalSongMetadataSource;
export type MatchMetadataResolver = (song: SongResult, source?: OnlineMetadataSource) => ProviderSongMetadata;

export interface OnlineMetadataSearchTarget {
    title: string;
    artist: string;
    album?: string;
    durationMs: number;
}

export interface OnlineMetadataCandidate {
    source: OnlineMetadataSource;
    songId: number | string;
    title: string;
    artists: Array<{ id?: number | string; name: string }>;
    album?: { id?: number | string; name: string };
    coverUrl?: string;
    durationMs: number;
    score: number;
    titleMatched: boolean;
    durationMatched: boolean | null;
    raw: SongResult;
}

export const normalizeOnlineMetadataCandidate = (
    source: OnlineMetadataSource,
    result: SongResult,
    target: OnlineMetadataSearchTarget,
    metadata: MatchMetadataResolver = createProviderSongMetadata,
): OnlineMetadataCandidate => {
    const details = calculateMatchScoreDetails(target, result);
    const inferred = metadata(result), explicit = metadata(result, source);
    const albumName = inferred.album?.name?.trim() || '';
    const albumId = inferred.album?.id;
    return {
        source,
        songId: source === 'qq' && result.qqMid
            ? result.qqMid
            : source === 'kugou' && result.kgHash
                ? result.kgHash
                : result.id,
        title: result.name || '',
        artists: inferred.artists,
        album: albumName ? { id: albumId, name: albumName } : undefined,
        coverUrl: explicit.coverUrl?.replace('http:', 'https:') || undefined,
        durationMs: explicit.durationMs,
        score: details.score,
        titleMatched: details.titleMatched,
        durationMatched: details.durationMatched,
        raw: result,
    };
};

export const normalizeLyricMatchMetadataCandidate = (
    lyricSource: LyricProviderSource,
    result: SongResult,
    target: OnlineMetadataSearchTarget,
    metadata: MatchMetadataResolver = createProviderSongMetadata,
): OnlineMetadataCandidate => {
    const source: OnlineMetadataSource = lyricSource === 'amll'
        ? result.amllDbPlatform === 'qq' ? 'qq' : 'netease'
        : lyricSource;
    return normalizeOnlineMetadataCandidate(source, result, target, metadata);
};

