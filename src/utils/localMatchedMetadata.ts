import type { LocalSong } from '../types';
import type { LocalLibraryAssignmentOrigin, LocalSongMetadataSource } from '../types/localLibrary';
import { cleanLocalLibraryName } from './localLibraryNames';

// localMatchedMetadata.ts — original canonical song updates, shared by Dexie and native persistence.
export interface MatchedLocalMetadata {
  source?: LocalSongMetadataSource;
  title?: string;
  artists?: Array<{ id?: number | string; name: string }>;
  album?: { id?: number | string; name: string };
  songId?: number | string;
  coverUrl?: string;
}
export function applyMatchedSongFields<T extends Pick<LocalSong, 'title' | 'titleOrigin' | 'onlineMetadata'>>(
  song: T, metadata: MatchedLocalMetadata, lyricsOnly = false,
  origin: Extract<LocalLibraryAssignmentOrigin, 'auto-match' | 'manual-match'> = 'auto-match', now = Date.now(),
): T {
  const result = { ...song };
  if (metadata.source) result.onlineMetadata = {
    source: metadata.source, songId: metadata.songId, albumId: metadata.album?.id,
    title: cleanLocalLibraryName(metadata.title),
    artists: metadata.artists?.filter(artist => cleanLocalLibraryName(artist.name)) || [],
    album: cleanLocalLibraryName(metadata.album?.name)
      ? { id: metadata.album?.id, name: cleanLocalLibraryName(metadata.album?.name)! } : undefined,
    coverUrl: metadata.coverUrl, matchMode: origin === 'manual-match' ? 'manual' : 'auto', matchedAt: now,
  };
  if (!lyricsOnly && metadata.title?.trim()) {
    result.title = metadata.title.trim(); result.titleOrigin = origin;
  }
  return result;
}
