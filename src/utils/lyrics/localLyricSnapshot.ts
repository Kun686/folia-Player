import type { LocalMatchDocument } from '../../types/localSongMatch';
import type { LocalSongLyrics } from './localSongLyricsSelection';
import { resolveExplicitFileTimedLyricFormat } from './formatDetection';

// localLyricSnapshot.ts — native storage fields become the original source-selection input.
export interface LocalLyricSnapshot {
    content?: string;
    fileName?: string;
    embeddedContent?: string;
    embeddedTranslation?: string;
    lyricsSource?: 'local' | 'embedded' | 'online';
    matched?: LocalMatchDocument;
    token: string;
}
export function localLyricsFromSnapshot(snapshot: LocalLyricSnapshot): LocalSongLyrics {
    return {
        matchedLyrics: snapshot.matched?.matchedLyrics, matchedIsPureMusic: snapshot.matched?.matchedIsPureMusic,
        hasLocalLyrics: Boolean(snapshot.content), localLyricsContent: snapshot.content,
        localLyricsFormat: resolveExplicitFileTimedLyricFormat(snapshot.fileName),
        hasEmbeddedLyrics: Boolean(snapshot.embeddedContent), embeddedLyricsContent: snapshot.embeddedContent,
        embeddedTranslationLyricsContent: snapshot.embeddedTranslation,
        lyricsSource: snapshot.lyricsSource,
    };
}
