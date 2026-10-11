import type { LocalSong, SongResult } from '../types';
import { cleanLocalLibraryName, splitLocalLibraryArtistNames } from '../utils/localLibraryNames';

// localSongProjection.ts — temporary original-model metadata; native mediaId remains the sole persisted song identity.
export function projectMobileLocalSongs(songs: SongResult[]): LocalSong[] {
  const seen = new Set<string>();
  return songs.flatMap(song => {
    if (song.sourceRef?.kind !== 'local' || seen.has(song.sourceRef.mediaId)) return [];
    const id = song.sourceRef.mediaId;
    seen.add(id);
    const importedName = (song as SongResult & { importedFileName?: string }).importedFileName;
    return [{ id, title: song.name, titleOrigin: 'import' as const, fileName: importedName || song.name,
      filePath: importedName || id, duration: song.durationMs, fileSize: 0, mimeType: '', addedAt: 0,
      importedMetadata: { title: song.name, titleSource: 'embedded' as const,
        artistNames: song.artists.flatMap(artist => splitLocalLibraryArtistNames(artist.name)),
        albumName: cleanLocalLibraryName(song.album.name) } }];
  });
}
