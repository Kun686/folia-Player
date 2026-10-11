import type { LocalMatchSnapshot, LocalSongMatchStorage } from '../types/localSongMatch';
import { buildLocalMatchDocument } from '../utils/localMatchDocument';
import { native } from './bridge';

// localMatchStorage.ts — guarded native commit of the original multi-field selection; cache failure stays a partial success.
export function localMatchStorage(snapshot: LocalMatchSnapshot, active: () => boolean): LocalSongMatchStorage {
  const check = () => { if (!active()) throw new DOMException('Canceled', 'AbortError'); };
  return {
    isCurrent: active,
    // Native single-song storage has no manually split artist/album entities; no fabricated assignment IDs.
    assignment: async () => { check(); return undefined; },
    apply: async input => {
      check();
      const next = buildLocalMatchDocument(snapshot, input);
      const coverAttempted = input.cover === 'online' && Boolean(input.candidate?.coverUrl);
      const result = await native.writeLocalMatch({ id: input.songId, token: snapshot.lyrics.token, ...next, cacheCover: coverAttempted });
      check();
      return { coverAttempted, coverCached: result.coverCached, lyricsApplied: input.lyrics !== 'online' || Boolean(input.onlineLyrics),
        partialLyricsFailure: Boolean(input.lyricsFailed && !input.onlineLyrics) };
    },
  };
}
