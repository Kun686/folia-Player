import type { SongResult } from '../types';
import type { OnlineLyricsStorage } from '../services/onlineLyricsStorage';
import { omni } from '../services/onlineMusic/omni';
import { native } from './bridge';
import { importOnlineLyricSelection, parseImportedOnlineLyrics, selectOnlineLyricSource } from '../utils/onlineLyricEdits';
import { readLyricFile } from '../utils/lyrics/lyricFileDecoding';
import { hasRenderableLyrics } from '../utils/lyrics/validity';

// onlineLyricEditor.ts — native persistence around the original edit semantics; audio queue/decoder are never changed.
export function scopedLyricStorage(storage: OnlineLyricsStorage, active: () => boolean): OnlineLyricsStorage {
  const isCurrent = () => active() && storage.isCurrent();
  const check = () => { if (!isCurrent()) throw new DOMException('Canceled', 'AbortError'); };
  const guarded = async <T>(work: () => Promise<T>) => { check(); const value = await work(); check(); return value; };
  return { isCurrent, readLyrics: () => guarded(() => storage.readLyrics()), readState: () => guarded(() => storage.readState()),
    writeLyrics: value => guarded(() => storage.writeLyrics(value)), writeState: value => guarded(() => storage.writeState(value)) };
}
export async function importMobileOnlineLyrics(storage: OnlineLyricsStorage, file: File) {
  if (file.size > 2_000_000 || file.name.length > 1024) throw new Error('lyrics-too-large');
  const content = await readLyricFile(file, 2_000_000);
  if (new TextEncoder().encode(content).length > 2_000_000) throw new Error('lyrics-too-large');
  const lyrics = await parseImportedOnlineLyrics(content, file.name);
  if (!hasRenderableLyrics(lyrics)) throw new Error('invalid-lyrics');
  const previous = await storage.readState();
  await storage.writeState(importOnlineLyricSelection(previous, lyrics, file.name));
}
export async function switchMobileOnlineLyrics(storage: OnlineLyricsStorage, source: 'online' | 'imported') {
  const previous = await storage.readState();
  if (source === 'imported' && !previous?.importedLyrics) throw new Error('missing-imported-lyrics');
  await storage.writeState(selectOnlineLyricSource(previous, source));
}
export async function resetMobileOnlineLyrics(storage: OnlineLyricsStorage, song: SongResult) {
  // Restore the owning provider first; if it is unavailable, retain the user's saved selections.
  await storage.readState();
  const result = song.sourceRef?.kind === 'navidrome'
    ? { lyrics: (await native.readNavidromeLyrics({ song, refresh: true })).payload.lyrics ?? null }
    : await omni.getLyrics(song);
  await storage.writeLyrics(result.lyrics);
  await storage.writeState({ lyricsSource: 'online' });
}
