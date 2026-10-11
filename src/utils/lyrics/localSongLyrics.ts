import type { ActiveLocalLyricsSource, LocalLyricsPriority, LyricData } from '../../types';
import { LyricParserFactory } from './LyricParserFactory';
import { selectLocalSongLyricsSource, type LocalSongLyrics } from './localSongLyricsSelection';
export { selectLocalSongLyricsSource } from './localSongLyricsSelection';

// src/utils/lyrics/localSongLyrics.ts
// Resolves the lyric payload and its actual source from one local-song snapshot.

export type ResolvedLocalSongLyrics = {
    lyrics: LyricData | null;
    source: ActiveLocalLyricsSource | null;
};

/** Parses the payload selected by the explicit source or current automatic priority. */
export const resolveLocalSongLyrics = async (
    song: LocalSongLyrics,
    priority: LocalLyricsPriority,
): Promise<ResolvedLocalSongLyrics> => {
    const source = selectLocalSongLyricsSource(song, priority);
    if (source === 'online') {
        return { lyrics: song.matchedLyrics ?? null, source };
    }
    if (source === 'local') {
        const lyrics = await LyricParserFactory.parse({
            type: 'local',
            lrcContent: song.localLyricsContent!,
            tLrcContent: song.localTranslationLyricsContent,
            formatHint: song.localLyricsFormat,
        });
        return { lyrics, source };
    }
    if (source === 'embedded') {
        const lyrics = await LyricParserFactory.parse({
            type: 'embedded',
            textContent: song.embeddedLyricsContent!,
            translationContent: song.embeddedTranslationLyricsContent,
        });
        return { lyrics, source };
    }
    return { lyrics: null, source: null };
};
