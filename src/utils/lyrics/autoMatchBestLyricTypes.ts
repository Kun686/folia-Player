import type { LyricData, LyricProviderSource, SongResult } from '../../types';
import type { ProviderLyricsResult } from '../../types/onlineMusic';
import type { NeteaseChorusRange } from './chorusEffects';

// autoMatchBestLyricTypes.ts — shared original matcher inputs, outputs and injectable I/O boundary.
export interface AutoMatchProviderCandidate {
    providerId: 'netease' | 'kugou' | 'qq';
    song: SongResult;
    lyricsResult: ProviderLyricsResult;
}

export interface AutoMatchBestLyricOptions {
    album?: string;
    preferredSource?: LyricProviderSource;
    metadataCandidate?: {
        source: 'netease' | 'qq' | 'kugou';
        songId: number | string;
    };
    exactMatchOnly?: boolean;
    providerCandidate?: AutoMatchProviderCandidate;
    /** @deprecated Use providerCandidate so the baseline follows the song's provider. */
    neteaseCandidate?: {
        id: number | string;
        lyrics: LyricData | null;
        isPureMusic?: boolean;
        chorusRanges?: NeteaseChorusRange[];
    };
}

export type AutoMatchBestLyricMatch = {
    lyrics: LyricData;
    source: LyricProviderSource;
    id: number | string;
    qqMid?: string;
    kgHash?: string;
    song: SongResult;
    matchedLyricsProviderPlatform?: 'ncm' | 'qq';
    isPureMusic?: false;
};

export type AutoMatchBestLyricPureMusic = {
    isPureMusic: true;
    source?: LyricProviderSource;
    id?: number | string;
};

export type AutoMatchBestLyricResult = AutoMatchBestLyricMatch | AutoMatchBestLyricPureMusic | null;

export interface AutoMatchLyricPorts {
    searchSongs(providerId: 'netease' | 'kugou', query: string, limit: number, offset: number): Promise<{ items: SongResult[]; hasMore: boolean; nextOffset: number }>;
    getLyrics(providerId: 'netease' | 'kugou', song: SongResult): Promise<ProviderLyricsResult | null>;
    getChorusRanges(providerId: 'netease' | 'kugou' | 'qq', song: SongResult): Promise<NeteaseChorusRange[]>;
    searchQQ(query: string, page: number, limit: number): Promise<SongResult[]>;
    fetchQQ(song: SongResult, options: { chorusRanges?: NeteaseChorusRange[] }): Promise<LyricData | null>;
    fetchAmll(platform: 'ncm' | 'qq', ids: readonly string[]): Promise<LyricData | null>;
    withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string, fallback: T): Promise<T>;
}
