import type { ActiveLocalLyricsSource, LocalLyricsPriority, LocalSong } from '../../types';

// localSongLyricsSelection.ts — original source priority, shared with the independent native lyric host.
export type LocalSongLyrics = Pick<LocalSong,
    'lyricsSource' | 'matchedLyrics' | 'matchedIsPureMusic' | 'hasLocalLyrics' | 'localLyricsContent' | 'localTranslationLyricsContent' | 'localLyricsFormat' | 'hasEmbeddedLyrics' | 'embeddedLyricsContent' | 'embeddedTranslationLyricsContent'>;

export const selectLocalSongLyricsSource = (
    song: LocalSongLyrics,
    priority: LocalLyricsPriority,
): ActiveLocalLyricsSource | null => {
    if (song.lyricsSource) {
        if (song.lyricsSource === 'online' && (song.matchedLyrics || song.matchedIsPureMusic)) return 'online';
        if (song.lyricsSource === 'local' && song.localLyricsContent) return 'local';
        if (song.lyricsSource === 'embedded' && song.embeddedLyricsContent) return 'embedded';
        return null;
    }

    if (priority === 'online' && song.matchedLyrics) return 'online';
    if (song.hasLocalLyrics && song.localLyricsContent) return 'local';
    if (song.hasEmbeddedLyrics && song.embeddedLyricsContent) return 'embedded';
    if (song.matchedLyrics) return 'online';
    return null;
};
