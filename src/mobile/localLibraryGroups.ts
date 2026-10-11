import type { TFunction } from 'i18next';
import type { LocalSong, SongResult } from '../types';
import type { LocalLibraryAssignment, LocalLibraryEntity, LocalLibraryEntityKind } from '../types/localLibrary';
import type { MobileLocalCollection } from '../types/mobileLibrary';
import { buildLocalHomeGroups } from '../library/core/model/localHomeModel';
import { cleanLocalLibraryName, normalizeLocalLibraryName, splitLocalLibraryArtistNames } from '../utils/localLibraryNames';

// localLibraryGroups.ts — adapt native display metadata to the original read-only home grouping model.
// The native files and match document remain authoritative; never persist these LocalSong projections.
export function buildMobileLocalGroups(songs: SongResult[], t: TFunction) {
  const originals = new Map<string, SongResult>();
  const entities = new Map<string, LocalLibraryEntity>();
  const assignments: LocalLibraryAssignment[] = [];
  const local: LocalSong[] = [];
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
    const artistNames = song.artists.flatMap(artist => splitLocalLibraryArtistNames(artist.name));
    const albumName = cleanLocalLibraryName(song.album.name);
    const fileName = (song as SongResult & { importedFileName?: string }).importedFileName || song.name;
    local.push({ id, title: song.name, titleOrigin: 'import', fileName, filePath: id,
      duration: song.durationMs, fileSize: 0, mimeType: '', addedAt: 0,
      importedMetadata: { title: song.name, titleSource: 'embedded', artistNames, albumName } });
    assignments.push({ songId: id, artistEntityIds: [...new Set(artistNames.map(name => entityId('artist', name)))],
      albumEntityId: albumName ? entityId('album', albumName) : undefined,
      artistOrigin: 'import', albumOrigin: 'import', updatedAt: 0 });
  }
  const grouped = buildLocalHomeGroups(local, [], t, { entities: [...entities.values()], assignments }, () => null);
  const adapt = (groups: typeof grouped.albums): MobileLocalCollection[] => groups.map(group => ({
    id: group.id, name: group.name, type: group.type as 'album' | 'artist',
    songs: group.songs.map(song => originals.get(song.id)!),
  }));
  return { albums: adapt(grouped.albums), artists: adapt(grouped.artists) };
}

export function filterMobileLocalSongs(songs: SongResult[], query: string): SongResult[] {
  const needle = normalizeLocalLibraryName(query);
  if (!needle) return songs;
  return songs.filter(song => normalizeLocalLibraryName(
    `${song.name} ${song.artists.map(artist => artist.name).join(' ')} ${song.album.name}`,
  ).includes(needle));
}
