import type { NativeLibrarySnapshot } from '../types/nativeLibrary';
import type { TFunction } from 'i18next';
import type { LocalPlaylist, SongResult } from '../types';
import type { LocalLibraryAssignment, LocalLibraryEntity, LocalLibraryEntityKind } from '../types/localLibrary';
import type { MobileLocalCollection } from '../types/mobileLibrary';
import { buildLocalHomeGroups } from '../library/core/model/localHomeModel';
import { normalizeLocalLibraryName } from '../utils/localLibraryNames';
import { projectMobileLocalSongs } from './localSongProjection';

// localLibraryGroups.ts — adapt native display metadata to the original read-only home grouping model.
// The native files and match document remain authoritative; never persist these LocalSong projections.
export function buildMobileLocalGroups(songs: SongResult[], t: TFunction, playlists: LocalPlaylist[] = [], snapshot?: NativeLibrarySnapshot) {
  const originals = new Map<string, SongResult>();
  const entities = new Map<string, LocalLibraryEntity>();
  const assignments: LocalLibraryAssignment[] = [];
  const local = snapshot?.editorSongs ?? projectMobileLocalSongs(songs);
  const entityId = (kind: LocalLibraryEntityKind, name: string) => {
    const normalized = normalizeLocalLibraryName(name);
    const id = JSON.stringify(['mobile-browse', kind, normalized]);
    if (!entities.has(id)) entities.set(id, { id, kind, displayName: name, aliases: [name],
      normalizedAliases: [normalized], createdAt: 0, updatedAt: 0 });
    return id;
  };
  for (const song of songs) {
    if (song.sourceRef?.kind !== 'local' || originals.has(song.sourceRef.mediaId)) continue;
    const id = song.sourceRef.mediaId;
    originals.set(id, song);
  }
  for (const song of snapshot ? [] : local) {
    const { artistNames, albumName } = song.importedMetadata;
    assignments.push({ songId: song.id, artistEntityIds: [...new Set(artistNames.map(name => entityId('artist', name)))],
      albumEntityId: albumName ? entityId('album', albumName) : undefined,
      artistOrigin: 'import', albumOrigin: 'import', updatedAt: 0 });
  }
  const grouped = buildLocalHomeGroups(local, playlists.map(playlist => playlist.isFavorite
    ? { ...playlist, name: t('localMusic.favoritePlaylist') } : playlist), t, snapshot ?? { entities: [...entities.values()], assignments }, () => null);
  const adapt = (groups: typeof grouped.albums): MobileLocalCollection[] => groups.map(group => ({
    id: group.id, name: group.name, type: group.type as MobileLocalCollection['type'], playlistId: group.playlistId, entityId: snapshot ? group.entityId : undefined,
    songs: group.songs.map(song => originals.get(song.id)!),
  }));
  return { albums: adapt(grouped.albums), artists: adapt(grouped.artists), playlists: adapt(grouped.playlists) };
}

export function filterMobileLocalSongs(songs: SongResult[], query: string): SongResult[] {
  const needle = normalizeLocalLibraryName(query);
  if (!needle) return songs;
  return songs.filter(song => normalizeLocalLibraryName(
    `${song.name} ${song.artists.map(artist => artist.name).join(' ')} ${song.album.name}`,
  ).includes(needle));
}
