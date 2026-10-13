import type { LocalSong } from '../types';

// src/utils/localSongCover.ts
// Detects the canonical content-addressed local cover reference.

export const hasLocalSongCover = (song: Pick<LocalSong, 'localCoverAssetId'>): boolean => (
  Boolean(song.localCoverAssetId)
);
