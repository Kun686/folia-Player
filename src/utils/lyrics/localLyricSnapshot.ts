import type { LocalSongLyrics } from './localSongLyricsSelection';
import { resolveExplicitFileTimedLyricFormat } from './formatDetection';

// localLyricSnapshot.ts — native storage fields become the original source-selection input.
export interface LocalLyricSnapshot {
    content?: string;
    fileName?: string;
    embeddedContent?: string;
    lyricsSource?: 'local' | 'embedded';
    token: string;
}
export function localLyricsFromSnapshot(snapshot: LocalLyricSnapshot): LocalSongLyrics {
    return {
        hasLocalLyrics: Boolean(snapshot.content), localLyricsContent: snapshot.content,
        localLyricsFormat: resolveExplicitFileTimedLyricFormat(snapshot.fileName),
        hasEmbeddedLyrics: Boolean(snapshot.embeddedContent), embeddedLyricsContent: snapshot.embeddedContent,
        lyricsSource: snapshot.lyricsSource,
    };
}
