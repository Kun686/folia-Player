import type { LyricData, OnlineLyricsState } from '../../types';
import { parseFoliaLyricDocument, FOLIA_LYRIC_DOCUMENT_FORMAT, FOLIA_LYRIC_DOCUMENT_VERSION } from './foliaLyricDocument';
import { resolveOnlineLyrics } from '../onlineLyricsSelection';
import { plannerLinesJSON } from './nativeLocalRuntime';
import { Buffer } from 'buffer';

// nativeCacheRuntime.ts — reuse the original document validator and selection rules; never accept raw provider responses.
function invalid(): never { throw new Error('invalid-lyric-cache'); }
function lyrics(value: unknown): LyricData | null {
  if (value == null) return null;
  const text = JSON.stringify({ format: FOLIA_LYRIC_DOCUMENT_FORMAT, version: FOLIA_LYRIC_DOCUMENT_VERSION, lyrics: value });
  if (Buffer.byteLength(text, 'utf8') > 2_000_000) invalid();
  const parsed = parseFoliaLyricDocument(text);
  if (!parsed) invalid();
  plannerLinesJSON(parsed); // Retain the existing line/count/time limits of the native planner.
  const { lines, title, artist, isWordByWord, ttml } = parsed!;
  return { lines, title, artist, isWordByWord, ttml };
}
function selection(value: unknown): OnlineLyricsState | null {
  if (value == null) return null;
  const raw = value as OnlineLyricsState;
  if (typeof raw !== 'object' || !['online', 'imported'].includes(raw.lyricsSource)) invalid();
  const state: OnlineLyricsState = { lyricsSource: raw.lyricsSource };
  for (const key of ['importedLyrics', 'onlineOverrideLyrics'] as const) {
    if (key in raw) state[key] = lyrics(raw[key]);
  }
  for (const key of ['hasOnlineOverride', 'matchedIsPureMusic'] as const) {
    if (typeof raw[key] === 'boolean') state[key] = raw[key];
  }
  if (typeof raw.importedLyricsName === 'string' && raw.importedLyricsName.length <= 1024) state.importedLyricsName = raw.importedLyricsName;
  if (raw.matchedLyricsSource && ['netease', 'qq', 'kugou', 'amll'].includes(raw.matchedLyricsSource)) state.matchedLyricsSource = raw.matchedLyricsSource;
  if (raw.matchedLyricsProviderPlatform && ['ncm', 'qq'].includes(raw.matchedLyricsProviderPlatform)) state.matchedLyricsProviderPlatform = raw.matchedLyricsProviderPlatform;
  if ((typeof raw.matchedSongId === 'string' && raw.matchedSongId.length <= 128)
      || (typeof raw.matchedSongId === 'number' && Number.isSafeInteger(raw.matchedSongId))) state.matchedSongId = raw.matchedSongId;
  return state;
}
export function cacheJSON(text: string): string {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 8_000_000) invalid();
  const raw = JSON.parse(text);
  if (raw?.version !== 1 || !raw.payload || typeof raw.payload !== 'object' || Array.isArray(raw.payload)) invalid();
  const payload: { lyrics?: LyricData | null; state?: OnlineLyricsState | null } = {};
  if ('lyrics' in raw.payload) payload.lyrics = lyrics(raw.payload.lyrics);
  if ('state' in raw.payload) payload.state = selection(raw.payload.state);
  return JSON.stringify({ payload, lines: JSON.parse(plannerLinesJSON(resolveOnlineLyrics(payload.state, payload.lyrics))) });
}
export function onlineLyricResult(lyrics: LyricData | null, full: boolean): string {
  const lines = JSON.parse(plannerLinesJSON(lyrics));
  return JSON.stringify(full ? { lines, lyrics } : { lines });
}
