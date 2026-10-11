import type { LyricData, OnlineLyricsState } from '../types';

// onlineLyricsStorage.ts — the original lyric loader can use a host-owned store without changing provider routing.
export interface OnlineLyricsStorage {
  readLyrics(): Promise<LyricData | null>;
  readState(): Promise<OnlineLyricsState | null>;
  writeLyrics(lyrics: LyricData | null): Promise<void>;
  writeState(state: OnlineLyricsState): Promise<void>;
  isCurrent(): boolean;
}
