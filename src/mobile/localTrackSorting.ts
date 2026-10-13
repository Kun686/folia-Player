import type { LocalSong, SongResult } from '../types';
import { buildLocalAlbumGroupResolver } from '../library/core/model/collectionView';
import { compareLocalFolderSongs, type LocalSongFolderSortDirection, type LocalSongFolderSortField } from '../utils/localSongSorting';
import { projectMobileLocalSongs } from './localSongProjection';

// localTrackSorting.ts — original entity-aware folder ordering, retaining the exact native song objects for playback.
export function sortMobileLocalTracks(songs: SongResult[], metadata: LocalSong[] | undefined,
  field: LocalSongFolderSortField, direction: LocalSongFolderSortDirection): SongResult[] {
  const local = new Map((metadata ?? projectMobileLocalSongs(songs)).map(song => [song.id, song]));
  const resolveAlbum = buildLocalAlbumGroupResolver(songs.map(song => song.sourceRef?.kind === 'local'
    ? { ...song, localRef: { songId: song.sourceRef.mediaId } } : song));
  const original = (song: SongResult) => song.sourceRef?.kind === 'local' ? local.get(song.sourceRef.mediaId) : undefined;
  return [...songs].sort((left, right) => {
    const a = original(left), b = original(right);
    return a && b ? compareLocalFolderSongs(a, b, field, direction, resolveAlbum) : 0;
  });
}
