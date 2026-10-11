import { cacheLocalSongOnlineCover, removeCachedCover } from './coverCache';
import { applyMatchedMetadata, restoreImportedMetadata } from './localLibraryCatalogService';
import { buildLocalSongMatchPatch, type ApplyLocalSongMatchSelectionInput, type ApplyLocalSongMatchSelectionResult } from '../utils/localSongMatchSelection';
export * from '../utils/localSongMatchSelection';

// src/services/localSongMatchSelectionService.ts
// Applies GridView metadata matches and Player lyric matches through one selection contract.

export const applyLocalSongMatchSelection = async (
  input: ApplyLocalSongMatchSelectionInput,
): Promise<ApplyLocalSongMatchSelectionResult> => {
  const candidateMetadata = input.candidate ? {
    source: input.candidate.source,
    songId: input.candidate.songId,
    title: input.candidate.title,
    artists: input.candidate.artists.length > 0 ? input.candidate.artists : undefined,
    album: input.candidate.album,
    coverUrl: input.candidate.coverUrl,
  } : {};
  const songPatch = buildLocalSongMatchPatch(input);

  if (input.metadata === 'online' && input.candidate) {
    await applyMatchedMetadata(input.songId, candidateMetadata, {
      songPatch,
      assignmentOrigin: input.matchMode === 'automatic' ? 'auto-match' : 'manual-match',
      protectOrigins: input.protectOrigins,
    });
  } else if (input.metadata === 'imported') {
    await restoreImportedMetadata(input.songId, songPatch);
  } else {
    await applyMatchedMetadata(input.songId, candidateMetadata, { lyricsOnly: true, songPatch });
  }

  const coverAttempted = input.cover === 'online' && Boolean(input.candidate?.coverUrl);
  const coverCached = coverAttempted && input.candidate?.coverUrl
    ? await cacheLocalSongOnlineCover(input.songId, input.candidate.coverUrl)
    : false;
  if (input.cover === 'embedded') await removeCachedCover(`cover_local_${input.songId}`);

  return {
    coverAttempted,
    coverCached,
    lyricsApplied: input.lyrics !== 'online' || Boolean(input.onlineLyrics),
    partialLyricsFailure: Boolean(input.lyricsFailed && !input.onlineLyrics),
  };
};
