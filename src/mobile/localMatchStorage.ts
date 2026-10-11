import type { LocalMatchSnapshot, LocalSongMatchStorage } from '../types/localSongMatch';
import { buildLocalMatchDocument } from '../utils/localMatchDocument';
import { native } from './bridge';

// localMatchStorage.ts — guarded native commit of the original multi-field selection; cache failure stays a partial success.
export function localMatchStorage(snapshot: LocalMatchSnapshot, active: () => boolean): LocalSongMatchStorage {
  const check = () => { if (!active()) throw new DOMException('Canceled', 'AbortError'); };
  return {
    isCurrent: active,
    // Original modal uses this assignment to confirm replacing manually organized artists/albums.
    assignment: async () => { check(); return snapshot.assignment; },
    apply: async input => {
      check();
      const next = buildLocalMatchDocument(snapshot, input);
      const coverAttempted = input.cover === 'online' && Boolean(input.candidate?.coverUrl);
      const result = await native.writeLocalMatch({ id: input.songId, token: snapshot.lyrics.token, ...next, cacheCover: coverAttempted,
        libraryRevision: snapshot.libraryRevision, metadata: input.metadata, updateArtists: Boolean(input.candidate?.artists.length),
        updateAlbum: Boolean(input.candidate?.album?.name?.trim()), protectOrigins: input.protectOrigins });
      check();
      return { coverAttempted, coverCached: result.coverCached, lyricsApplied: input.lyrics !== 'online' || Boolean(input.onlineLyrics),
        partialLyricsFailure: Boolean(input.lyricsFailed && !input.onlineLyrics) };
    },
  };
}
