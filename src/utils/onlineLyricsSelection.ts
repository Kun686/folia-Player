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
