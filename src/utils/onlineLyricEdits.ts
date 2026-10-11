import type { LyricData, OnlineLyricsState, LyricProviderSource, AmllDbPlatform } from '../types';
import { LyricParserFactory } from './lyrics/LyricParserFactory';
import { resolveExplicitFileTimedLyricFormat } from './lyrics/formatDetection';

// onlineLyricEdits.ts — original import, source-switch and match semantics shared by desktop and mobile controls.
export const parseImportedOnlineLyrics = (content: string, fileName: string) => fileName.toLowerCase().endsWith('.txt')
  ? LyricParserFactory.parse({ type: 'embedded', textContent: content })
  : LyricParserFactory.parse({ type: 'local', lrcContent: content, formatHint: resolveExplicitFileTimedLyricFormat(fileName) });

export const selectOnlineLyricSource = (previous: OnlineLyricsState | null, source: 'online' | 'imported'): OnlineLyricsState => ({
  lyricsSource: source,
  importedLyrics: previous?.importedLyrics ?? null,
  importedLyricsName: previous?.importedLyricsName ?? null,
  hasOnlineOverride: previous?.hasOnlineOverride ?? false,
  onlineOverrideLyrics: previous?.onlineOverrideLyrics ?? null,
  matchedSongId: previous?.matchedSongId,
  matchedIsPureMusic: previous?.matchedIsPureMusic,
  matchedLyricsSource: previous?.matchedLyricsSource,
  matchedLyricsProviderPlatform: previous?.matchedLyricsProviderPlatform,
});
export const importOnlineLyricSelection = (previous: OnlineLyricsState | null, lyrics: LyricData | null, fileName: string): OnlineLyricsState => ({
  ...selectOnlineLyricSource(previous, 'imported'), importedLyrics: lyrics, importedLyricsName: fileName,
});
export const matchOnlineLyricSelection = (previous: OnlineLyricsState | null, match: {
  lyrics: LyricData | null; isPureMusic: boolean; matchedLyricsProviderPlatform?: AmllDbPlatform;
}, id: string | number, source: LyricProviderSource): OnlineLyricsState => ({
  lyricsSource: 'online', importedLyrics: previous?.importedLyrics ?? null, importedLyricsName: previous?.importedLyricsName ?? null,
  hasOnlineOverride: true, onlineOverrideLyrics: match.lyrics, matchedSongId: id, matchedIsPureMusic: match.isPureMusic,
  matchedLyricsSource: source, matchedLyricsProviderPlatform: match.matchedLyricsProviderPlatform,
});
