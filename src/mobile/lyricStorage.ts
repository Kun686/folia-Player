import type { SongResult } from '../types';
import type { OnlineLyricsStorage } from '../services/onlineLyricsStorage';
import { native } from './bridge';

// lyricStorage.ts — immutable read snapshot plus revocable native writes for one original loader invocation.
export async function openNativeLyricsStorage(song: SongResult, isCurrent: () => boolean): Promise<OnlineLyricsStorage> {
  const snapshot = await native.readLyricCache({ song });
  const check = () => { if (!isCurrent()) throw new DOMException('Canceled', 'AbortError'); };
  check();
  if (typeof snapshot.token !== 'string' || !snapshot.payload) throw new Error('invalid-lyric-cache');
  const write: FoliaWrite = async (field, value) => {
    check();
    await native.writeLyricCache({ song, token: snapshot.token, field, value });
    check();
  };
  return {
    isCurrent,
    readLyrics: async () => { check(); return snapshot.payload.lyrics ?? null; },
    readState: async () => { check(); return snapshot.payload.state ?? null; },
    writeLyrics: value => write('lyrics', value),
    writeState: value => write('state', value),
  };
}
type FoliaWrite = (field: 'lyrics' | 'state', value: Parameters<typeof native.writeLyricCache>[0]['value']) => Promise<void>;
