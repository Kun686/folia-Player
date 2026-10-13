import type { AutoMatchBestLyricResult } from './lyrics/autoMatchBestLyricTypes';
import type { OnlineLyricsState } from '../types';
import { isPureMusicLyricText } from './lyrics/pureMusic';

// onlineLyricsSelection.ts — pure original selection rules shared by browser storage and the native lyric host.
export const resolveOnlineLyrics = (
    state: OnlineLyricsState | null | undefined,
    fallbackLyrics: OnlineLyricsState['onlineOverrideLyrics'],
) => {
    if (!state) return fallbackLyrics ?? null;
    if (state.lyricsSource === 'imported' && state.importedLyrics) return state.importedLyrics;
    if (state.hasOnlineOverride) return state.onlineOverrideLyrics ?? null;
    return fallbackLyrics ?? null;
};

/**
 * Whether the stored lyrics mean "instrumental", decided the way cached playback decides it:
 * an online match that recorded a verdict is trusted as-is; anything else (an imported file, or a
 * match from before the verdict was stored) falls back to reading the lyric text.
 */
export const resolveOnlineLyricsPureMusic = (
    state: OnlineLyricsState | null | undefined,
    lyricsText: string,
): boolean => (
    state?.lyricsSource === 'online' && typeof state.matchedIsPureMusic === 'boolean'
        ? state.matchedIsPureMusic
        : isPureMusicLyricText(lyricsText)
);

/**
 * The state to store once auto-match has concluded a track simply has no lyrics.
 *
 * "Every source agrees this one is instrumental" is an ANSWER and has to be persisted like any
 * other match. Storing nothing leaves `hasOnlineOverride` false, which is the flag that decides
 * whether to auto-match at all - so the full multi-provider search runs again on every prefetch
 * pass and every play, forever, for every instrumental in the library.
 *
 * Merged onto whatever was already there rather than replacing it: an imported selection stays
 * imported, and `resolveOnlineLyrics` keeps preferring it, so a background auto-match can never
 * take the listener's own choice away.
 */
export const markOnlineLyricsPureMusic = (
    previous: OnlineLyricsState | null | undefined,
): OnlineLyricsState => ({
    ...previous,
    lyricsSource: previous?.lyricsSource ?? 'online',
    hasOnlineOverride: true,
    // The override IS "there are none". Spelled out rather than left undefined so the stored state
    // reads the same way `resolveOnlineLyrics` will read it.
    onlineOverrideLyrics: null,
    matchedIsPureMusic: true,
});

// Original automatic selection conversion, shared by online playback and the independent native job.
export function automaticOnlineLyricSelection(previous: OnlineLyricsState | null | undefined,
    ownProvider: string | null, bestMatch: AutoMatchBestLyricResult): OnlineLyricsState | null {
    if (bestMatch && 'lyrics' in bestMatch && bestMatch.source !== ownProvider) {
        return {
            lyricsSource: 'online', matchedSongId: bestMatch.id, hasOnlineOverride: true,
            onlineOverrideLyrics: bestMatch.lyrics, matchedLyricsSource: bestMatch.source,
            matchedLyricsProviderPlatform: bestMatch.matchedLyricsProviderPlatform,
        };
    }
    // Checked against `true`, not with `in`: a MATCH object also carries
    // `isPureMusic: false`, so `'isPureMusic' in bestMatch` was true for it too - and
    // a best match from the track's own provider (which fails the branch above) then
    // landed here and had its perfectly good lyrics thrown away as instrumental.
    return bestMatch?.isPureMusic ? markOnlineLyricsPureMusic(previous) : null;
}
