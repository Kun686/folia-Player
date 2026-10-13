import type { LocalSong } from '../../types';
import type { LocalSongMatchTarget } from '../../types/localSongMatch';
import { hasLocalSongCover } from '../localSongCover';

// src/utils/lyrics/localSongMatchContext.ts
type LocalLyricMatchSong = Pick<LocalSong, 'title' | 'fileName' | 'duration' | 'onlineMetadata' | 'importedMetadata' | 'noAutoMatch' | 'hasManualLyricSelection' | 'matchedLyrics' | 'matchedIsPureMusic' | 'matchedLyricsSongId'>;

export interface LocalSongMetadataLyricCandidate {
    source: 'netease' | 'qq' | 'kugou';
    songId: number | string;
}

export interface LocalSongLyricMatchContext {
    title: string;
    artist: string;
    album: string;
    durationMs: number;
    metadataCandidate?: LocalSongMetadataLyricCandidate;
}

export interface ResolvedLocalSongLyricMetadata {
    artistNames: string[];
    albumName?: string;
}

const stripAudioExtension = (fileName: string): string => (
    fileName.replace(/\.(mp3|flac|m4a|wav|ogg|opus|aac)$/i, '')
);

// Uses the canonical title for scoring and the latest provider identity only as a lookup accelerator.
export const buildLocalSongLyricMatchContext = (
    song: LocalLyricMatchSong,
    resolvedMetadata?: ResolvedLocalSongLyricMetadata,
): LocalSongLyricMatchContext => {
    const title = song.title || stripAudioExtension(song.fileName);
    const artist = resolvedMetadata?.artistNames.join(', ')
        || song.onlineMetadata?.artists.map(item => item.name).join(', ')
        || song.importedMetadata.artistNames.join(', ');
    const album = resolvedMetadata?.albumName
        || song.onlineMetadata?.album?.name
        || song.importedMetadata.albumName
        || '';
    const source = song.onlineMetadata?.source;
    const songId = song.onlineMetadata?.songId;
    const hasSelectedIdentity = (source === 'netease' || source === 'qq' || source === 'kugou')
        && songId !== undefined
        && songId !== null
        && String(songId).trim() !== '';

    return {
        title,
        artist,
        album,
        durationMs: song.duration || 0,
        ...(hasSelectedIdentity ? {
            metadataCandidate: {
                source,
                songId,
            },
        } : {}),
    };
};

// Explicit metadata identity may accelerate lookup without bypassing the normal lyric scoring pipeline.
export const shouldRunLocalSongAutomaticMatch = (song: LocalLyricMatchSong): boolean => (
    !song.noAutoMatch || Boolean(buildLocalSongLyricMatchContext(song).metadataCandidate)
);

// Legacy automatic lyric records have no provider-scoped lyric ID and are refreshed once against the selected metadata.
export const shouldRefreshLocalSongLyricsFromMetadata = (song: LocalLyricMatchSong): boolean => (
    !song.hasManualLyricSelection
    && Boolean(buildLocalSongLyricMatchContext(song).metadataCandidate)
    && Boolean(song.matchedLyrics || song.matchedIsPureMusic)
    && song.matchedLyricsSongId === undefined
);

// Compact facts shared with the native parser; matching/scoring tables stay in the separate job.
export type LocalAutomaticSong = LocalSongMatchTarget & Pick<LocalSong, 'matchedLyricsSongId' | 'noAutoMatch' | 'hasManualLyricSelection'>;
export type LocalAutomaticSettings = { localLyricsPriority: 'local' | 'online'; autoUseBestLyric: boolean; preferredAlternativeLyricSource: LocalSong['matchedLyricsSource'] };
export interface LocalAutomaticInput {
    context: ReturnType<typeof buildLocalSongLyricMatchContext>;
    hasFileLyrics: boolean; hasLocalCover: boolean;
    pureMusic: boolean; refreshFromMetadata: boolean;
    settings: LocalAutomaticSettings;
}
export function localAutomaticInput(song: LocalAutomaticSong, metadata: ResolvedLocalSongLyricMetadata,
    settings: LocalAutomaticSettings): LocalAutomaticInput {
    return { context: buildLocalSongLyricMatchContext(song, metadata),
        hasFileLyrics: Boolean((song.hasLocalLyrics && song.localLyricsContent) || (song.hasEmbeddedLyrics && song.embeddedLyricsContent)),
        hasLocalCover: hasLocalSongCover(song), pureMusic: song.matchedIsPureMusic === true,
        refreshFromMetadata: shouldRefreshLocalSongLyricsFromMetadata(song), settings };
}
